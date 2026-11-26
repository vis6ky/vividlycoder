from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator
from typing import Any

from ..config import Settings
from .base import (
    AIProvider,
    ChatMessageInput,
    ChatOptions,
    ChatStreamEvent,
    ModelDescriptor,
    ProviderError,
    ProviderHealth,
)

try:
    import httpx
except ImportError:  # Allows stdlib unit tests in environments without httpx
    httpx = None  # type: ignore[assignment]


def clamp_num_ctx(requested: int | None, settings: Settings) -> int:
    """Keep context window within 16 GB M2 unified memory budget (default 8K, max 16K)."""
    if requested is None:
        return settings.default_num_ctx
    return max(settings.min_num_ctx, min(settings.max_num_ctx, int(requested)))


def estimate_model_memory_gb(size_bytes: int | None, num_ctx: int = 8192) -> float | None:
    """Estimate unified memory footprint (weights + KV cache overhead) in GB."""
    if not size_bytes or size_bytes <= 0:
        return None
    weights_gb = size_bytes / (1024**3)
    kv_overhead_gb = 0.8 if num_ctx <= 8192 else 1.6
    return round(weights_gb + kv_overhead_gb, 2)


def classify_ollama_error(
    status_code: int | None,
    raw_body: str,
    model: str,
) -> ProviderError:
    """Map Ollama HTTP/runtime failures into actionable local-Mac diagnostics."""
    lower = raw_body.lower()

    if status_code == 404 or "not found" in lower or "pull" in lower and "model" in lower:
        return ProviderError(
            code="MODEL_NOT_FOUND",
            message=(
                f"Model '{model}' is not installed in local Ollama. "
                f"Pull it in Terminal with: ollama pull {model}"
            ),
            status_code=404,
        )

    memory_markers = (
        "out of memory",
        "oom",
        "not enough memory",
        "insufficient memory",
        "requires more system memory",
        "unable to allocate",
        "metal",
    )
    if any(marker in lower for marker in memory_markers):
        return ProviderError(
            code="INSUFFICIENT_MEMORY",
            message=(
                f"Insufficient unified memory to run '{model}' on 16 GB MacBook Pro M2. "
                "Close memory-heavy apps, switch to qwen3.5:4b, or lower context window to 8192."
            ),
            status_code=507,
        )

    detail = raw_body.strip() or f"HTTP {status_code}"
    return ProviderError(
        code="PROVIDER_ERROR",
        message=f"Ollama runtime error for '{model}': {detail}",
        status_code=status_code or 502,
    )


def parse_ollama_models(
    tags_payload: dict[str, Any],
    loaded_names: set[str],
    settings: Settings,
) -> list[ModelDescriptor]:
    """Normalize Ollama /api/tags payload with role & 16 GB memory metadata."""
    descriptors: list[ModelDescriptor] = []
    for item in tags_payload.get("models", []):
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        details = item.get("details") or {}
        size_bytes = item.get("size")
        mem_est = estimate_model_memory_gb(size_bytes, settings.default_num_ctx)
        fits_in_16gb = True if mem_est is None else mem_est <= 11.5

        if name == settings.default_model or name.startswith(f"{settings.default_model}-"):
            role = "default"
        elif name == settings.evaluation_model or name.startswith(f"{settings.evaluation_model}-"):
            role = "evaluation"
        else:
            role = "available"

        descriptors.append(
            ModelDescriptor(
                name=name,
                size_bytes=size_bytes if isinstance(size_bytes, int) else None,
                parameter_size=details.get("parameter_size"),
                quantization=details.get("quantization_level"),
                family=details.get("family"),
                modified_at=item.get("modified_at"),
                role=role,
                is_loaded=name in loaded_names,
                memory_estimate_gb=mem_est,
                fits_in_16gb=fits_in_16gb,
            )
        )

    # Sort default model first, then evaluation candidate, then loaded/other
    priority = {"default": 0, "evaluation": 1, "available": 2}
    descriptors.sort(key=lambda d: (priority[d.role], d.name))
    return descriptors


def parse_chat_ndjson_line(
    line: str,
    started_monotonic: float,
    running_token_count: int,
) -> tuple[ChatStreamEvent | None, int]:
    """Parse one NDJSON chunk from Ollama /api/chat into a ChatStreamEvent."""
    stripped = line.strip()
    if not stripped:
        return None, running_token_count

    chunk = json.loads(stripped)
    if isinstance(chunk, dict) and chunk.get("error"):
        raise ProviderError(
            code="PROVIDER_ERROR",
            message=str(chunk["error"]),
            status_code=502,
        )

    message_obj = chunk.get("message") or {}
    delta = message_obj.get("content") or ""
    if delta:
        running_token_count += 1
        return ChatStreamEvent(kind="delta", token=str(delta)), running_token_count

    if chunk.get("done"):
        elapsed_ms = int((time.monotonic() - started_monotonic) * 1000)
        eval_count = chunk.get("eval_count")
        final_count = int(eval_count) if isinstance(eval_count, int) else running_token_count
        return (
            ChatStreamEvent(
                kind="done",
                token_count=final_count,
                duration_ms=elapsed_ms,
            ),
            running_token_count,
        )

    return None, running_token_count


class OllamaProvider(AIProvider):
    """Local Ollama AI provider tuned for Apple Silicon 16 GB unified memory."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._base_url = settings.ollama_base_url.rstrip("/")

    @property
    def provider_name(self) -> str:
        return "ollama"

    def _require_httpx(self) -> Any:
        if httpx is None:
            raise RuntimeError(
                "httpx is required to communicate with Ollama. Install backend/requirements.txt."
            )
        return httpx

    async def _get_loaded_model_names(self, client: Any) -> list[str]:
        try:
            resp = await client.get(f"{self._base_url}/api/ps", timeout=2.0)
            if resp.status_code != 200:
                return []
            payload = resp.json()
            return [
                str(m.get("name"))
                for m in payload.get("models", [])
                if m.get("name")
            ]
        except Exception:
            return []

    async def _enforce_single_loaded_model(self, client: Any, target_model: str) -> None:
        """Unload other models before loading target_model to protect 16 GB unified memory."""
        if self._settings.max_loaded_models != 1:
            return
        loaded = await self._get_loaded_model_names(client)
        for active in loaded:
            if active != target_model:
                try:
                    await client.post(
                        f"{self._base_url}/api/chat",
                        json={"model": active, "messages": [], "keep_alive": 0},
                        timeout=3.0,
                    )
                except Exception:
                    # Best-effort unload; do not block chat start if Ollama already evicted it
                    pass

    async def health_check(self) -> ProviderHealth:
        hx = self._require_httpx()
        try:
            async with hx.AsyncClient(timeout=2.5) as client:
                ver_resp = await client.get(f"{self._base_url}/api/version")
                if ver_resp.status_code != 200:
                    return ProviderHealth(
                        provider=self.provider_name,
                        status="error",
                        error=f"Ollama /api/version returned HTTP {ver_resp.status_code}",
                    )
                version = ver_resp.json().get("version")
                loaded = await self._get_loaded_model_names(client)
                return ProviderHealth(
                    provider=self.provider_name,
                    status="connected",
                    version=str(version) if version else None,
                    loaded_models=loaded,
                )
        except Exception as exc:
            return ProviderHealth(
                provider=self.provider_name,
                status="offline",
                error=(
                    f"Ollama is unreachable at {self._base_url}. "
                    f"Start it on macOS with 'ollama serve' ({exc})."
                ),
            )

    async def list_models(self) -> list[ModelDescriptor]:
        hx = self._require_httpx()
        try:
            async with hx.AsyncClient(timeout=4.0) as client:
                resp = await client.get(f"{self._base_url}/api/tags")
                if resp.status_code != 200:
                    raise ProviderError(
                        code="PROVIDER_ERROR",
                        message=f"Ollama /api/tags returned HTTP {resp.status_code}: {resp.text.strip() or 'request failed'}",
                        status_code=resp.status_code,
                    )
                loaded = set(await self._get_loaded_model_names(client))
                return parse_ollama_models(resp.json(), loaded, self._settings)
        except ProviderError:
            raise
        except Exception as exc:
            raise ProviderError(
                code="RUNTIME_OFFLINE",
                message=f"Ollama is unreachable at {self._base_url}: {exc}",
                status_code=503,
            ) from exc

    async def stream_chat(
        self,
        model: str,
        messages: list[ChatMessageInput],
        options: ChatOptions,
        cancel_event: asyncio.Event | None = None,
    ) -> AsyncIterator[ChatStreamEvent]:
        hx = self._require_httpx()
        target_model = (model or self._settings.default_model).strip()
        num_ctx = clamp_num_ctx(options.num_ctx, self._settings)
        temperature = max(0.0, min(2.0, float(options.temperature)))
        started = time.monotonic()
        token_count = 0

        if cancel_event and cancel_event.is_set():
            yield ChatStreamEvent(kind="stopped")
            return

        payload = {
            "model": target_model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "stream": True,
            "keep_alive": self._settings.keep_alive,
            "options": {
                "temperature": temperature,
                "num_ctx": num_ctx,
            },
        }

        try:
            async with hx.AsyncClient(timeout=hx.Timeout(connect=5.0, read=None, write=10.0, pool=5.0)) as client:
                await self._enforce_single_loaded_model(client, target_model)

                if cancel_event and cancel_event.is_set():
                    yield ChatStreamEvent(kind="stopped")
                    return

                async with client.stream(
                    "POST",
                    f"{self._base_url}/api/chat",
                    json=payload,
                ) as resp:
                    if resp.status_code != 200:
                        raw_err = (await resp.aread()).decode("utf-8", errors="replace")
                        raise classify_ollama_error(resp.status_code, raw_err, target_model)

                    watcher_task: asyncio.Task[None] | None = None
                    if cancel_event is not None:
                        async def _watch_cancel() -> None:
                            await cancel_event.wait()
                            await resp.aclose()

                        watcher_task = asyncio.create_task(_watch_cancel())

                    try:
                        async for line in resp.aiter_lines():
                            if cancel_event and cancel_event.is_set():
                                yield ChatStreamEvent(kind="stopped")
                                return
                            try:
                                event, token_count = parse_chat_ndjson_line(
                                    line, started, token_count
                                )
                            except ProviderError as err:
                                raise classify_ollama_error(500, err.message, target_model) from err

                            if event is not None:
                                yield event
                                if event.kind in ("done", "stopped"):
                                    return
                    except Exception:
                        if cancel_event and cancel_event.is_set():
                            yield ChatStreamEvent(kind="stopped")
                            return
                        raise
                    finally:
                        if watcher_task is not None and not watcher_task.done():
                            watcher_task.cancel()
                            try:
                                await watcher_task
                            except asyncio.CancelledError:
                                pass

                    if cancel_event and cancel_event.is_set():
                        yield ChatStreamEvent(kind="stopped")
                        return
        except ProviderError:
            raise
        except hx.ConnectError as exc:
            raise ProviderError(
                code="RUNTIME_OFFLINE",
                message=(
                    f"Cannot connect to local Ollama at {self._base_url}. "
                    "Ensure 'ollama serve' is running on your Mac."
                ),
                status_code=503,
            ) from exc
        except hx.TimeoutException as exc:
            raise ProviderError(
                code="TIMEOUT",
                message=f"Ollama request timed out while waiting for '{target_model}'.",
                status_code=504,
            ) from exc
        except Exception as exc:
            raise ProviderError(
                code="PROVIDER_ERROR",
                message=f"Unexpected Ollama streaming failure: {exc}",
                status_code=502,
            ) from exc

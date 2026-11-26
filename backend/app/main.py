from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from .config import Settings
from .db.repository import SQLiteRepository
from .providers.base import (
    AIProvider,
    ChatMessageInput,
    ChatOptions,
    ProviderError,
)
from .providers.ollama import OllamaProvider, clamp_num_ctx
from .schemas import (
    ConversationCreateRequest,
    ProjectCreateRequest,
    RestChatRequest,
    WsChatStartFrame,
    WsChatStopFrame,
)
from .ws_security import (
    is_ws_origin_allowed,
    sanitize_chat_history,
    validate_ws_frame_bytes,
)


def _derive_title(prompt: str) -> str:
    cleaned = " ".join(prompt.strip().split())
    if not cleaned:
        return "Untitled Thread"
    return f"{cleaned[:48]}..." if len(cleaned) > 48 else cleaned


def create_app(
    settings: Settings | None = None,
    provider: AIProvider | None = None,
    repository: SQLiteRepository | None = None,
) -> FastAPI:
    cfg = settings or Settings.from_env()
    ai_provider = provider or OllamaProvider(cfg)
    repo = repository or SQLiteRepository(cfg.db_path)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        await repo.init_db()
        try:
            yield
        finally:
            await repo.close()

    app = FastAPI(
        title="VividCoder Local Backend",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=cfg.allowed_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type"],
    )

    @app.get("/api/health")
    async def health() -> dict[str, Any]:
        provider_health, sqlite_ok = await asyncio.gather(
            ai_provider.health_check(),
            repo.check_health(),
        )
        return {
            "backendStatus": "ok" if sqlite_ok else "degraded",
            "provider": provider_health.provider,
            "ollamaStatus": provider_health.status,
            "ollamaVersion": provider_health.version,
            "ollamaError": provider_health.error,
            "sqliteStatus": "ok" if sqlite_ok else "error",
            "activeModel": provider_health.loaded_models[0]
            if provider_health.loaded_models
            else None,
            "loadedModels": provider_health.loaded_models,
            "defaultModel": cfg.default_model,
            "evaluationModel": cfg.evaluation_model,
            "hardwareProfile": {
                "machine": "MacBook Pro M2",
                "memoryGb": 16,
                "storageGb": 256,
                "maxLoadedModels": cfg.max_loaded_models,
                "recommendedContextWindow": f"{cfg.default_num_ctx // 1024}K-{cfg.max_num_ctx // 1024}K",
            },
        }

    @app.get("/api/models")
    async def list_models() -> dict[str, Any]:
        try:
            models = await ai_provider.list_models()
        except ProviderError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

        return {
            "models": [
                {
                    "name": m.name,
                    "sizeBytes": m.size_bytes,
                    "parameterSize": m.parameter_size,
                    "quantization": m.quantization,
                    "family": m.family,
                    "modifiedAt": m.modified_at,
                    "role": m.role,
                    "isLoaded": m.is_loaded,
                    "memoryEstimateGb": m.memory_estimate_gb,
                    "fitsIn16Gb": m.fits_in_16gb,
                }
                for m in models
            ]
        }

    @app.get("/api/projects")
    async def list_projects() -> dict[str, Any]:
        projects = await repo.list_projects()
        return {"projects": projects}

    @app.post("/api/projects", status_code=201)
    async def create_project(payload: ProjectCreateRequest) -> dict[str, Any]:
        return await repo.create_project(
            name=payload.name.strip(),
            path=payload.path.strip(),
            language=payload.language.strip() if payload.language else None,
        )

    @app.get("/api/conversations")
    async def list_conversations(
        project_id: str | None = Query(default=None),
    ) -> dict[str, Any]:
        conversations = await repo.list_conversations(project_id=project_id)
        return {"conversations": conversations}

    @app.post("/api/conversations", status_code=201)
    async def create_conversation(payload: ConversationCreateRequest) -> dict[str, Any]:
        return await repo.create_conversation(
            title=(payload.title or "New Conversation").strip(),
            model=payload.model.strip(),
            project_id=payload.projectId,
        )

    @app.get("/api/conversations/{conversation_id}/messages")
    async def get_conversation_messages(conversation_id: str) -> dict[str, Any]:
        messages = await repo.list_messages(conversation_id)
        return {"messages": messages}

    @app.delete("/api/conversations/{conversation_id}", status_code=204)
    async def delete_conversation(conversation_id: str) -> Response:
        deleted = await repo.delete_conversation(conversation_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return Response(status_code=204)

    @app.post("/api/chat")
    async def rest_chat(payload: RestChatRequest) -> dict[str, Any]:
        model_name = (payload.model or cfg.default_model).strip()
        conv = (
            await repo.ensure_conversation(
                conversation_id=payload.conversationId,
                title=_derive_title(payload.prompt),
                model=model_name,
                project_id=payload.projectId,
            )
            if payload.conversationId
            else await repo.create_conversation(
                title=_derive_title(payload.prompt),
                model=model_name,
                project_id=payload.projectId,
            )
        )
        conv_id = conv["id"]

        await repo.add_message(
            conversation_id=conv_id,
            role="user",
            content=payload.prompt,
            status="complete",
        )

        history = [
            ChatMessageInput(role=m.role, content=m.content)
            for m in payload.messages
            if m.content.strip()
        ]
        if not history or history[-1].role != "user" or history[-1].content != payload.prompt:
            history.append(ChatMessageInput(role="user", content=payload.prompt))

        options = ChatOptions(
            temperature=payload.options.temperature,
            num_ctx=clamp_num_ctx(payload.options.num_ctx, cfg),
        )

        try:
            result = await ai_provider.chat(
                model=model_name,
                messages=history,
                options=options,
            )
        except ProviderError as exc:
            await repo.add_message(
                conversation_id=conv_id,
                role="assistant",
                content="",
                status="error",
                model=model_name,
                error_message=exc.message,
            )
            raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

        assistant_msg = await repo.add_message(
            conversation_id=conv_id,
            role="assistant",
            content=result.content,
            status="complete",
            model=model_name,
            token_count=result.token_count,
            duration_ms=result.duration_ms,
        )
        return {"conversationId": conv_id, "message": assistant_msg}

    @app.websocket("/ws/chat")
    async def ws_chat(ws: WebSocket) -> None:
        origin = ws.headers.get("origin")
        if not is_ws_origin_allowed(origin, cfg.allowed_origins):
            await ws.close(code=1008)
            return

        await ws.accept()
        cancel_event = asyncio.Event()
        active_task: asyncio.Task[None] | None = None

        async def safe_send(payload: dict[str, Any]) -> bool:
            try:
                await ws.send_json(payload)
                return True
            except Exception:
                return False

        async def run_stream(start_frame: WsChatStartFrame) -> None:
            conv_id = start_frame.conversationId
            prompt = start_frame.prompt
            model_name = (start_frame.model or cfg.default_model).strip()
            project_id = start_frame.projectId

            history = sanitize_chat_history(
                [{"role": m.role, "content": m.content} for m in start_frame.messages],
                prompt=prompt,
                max_history=cfg.ws_max_history_messages,
            )
            options = ChatOptions(
                temperature=max(0.0, min(2.0, float(start_frame.options.temperature))),
                num_ctx=clamp_num_ctx(start_frame.options.num_ctx, cfg),
            )

            await repo.ensure_conversation(
                conversation_id=conv_id,
                title=_derive_title(prompt),
                model=model_name,
                project_id=project_id,
            )
            await repo.add_message(
                conversation_id=conv_id,
                role="user",
                content=prompt,
                status="complete",
            )
            assistant_record = await repo.add_message(
                conversation_id=conv_id,
                role="assistant",
                content="",
                status="streaming",
                model=model_name,
            )
            assistant_id: str = assistant_record["id"]
            chunks: list[str] = []
            finalized = False

            async def finalize_assistant(
                status: str,
                error_message: str | None = None,
                token_count: int | None = None,
                duration_ms: int | None = None,
            ) -> None:
                nonlocal finalized
                if finalized:
                    return
                finalized = True
                await asyncio.shield(
                    repo.update_message(
                        message_id=assistant_id,
                        content="".join(chunks),
                        status=status,
                        error_message=error_message,
                        token_count=token_count,
                        duration_ms=duration_ms,
                    )
                )

            try:
                if cancel_event.is_set():
                    await finalize_assistant("stopped")
                    await safe_send({"type": "chat.stopped", "messageId": assistant_id})
                    return

                started_ok = await safe_send(
                    {
                        "type": "chat.started",
                        "conversationId": conv_id,
                        "messageId": assistant_id,
                    }
                )
                if not started_ok:
                    cancel_event.set()
                    await finalize_assistant("stopped")
                    return

                async for event in ai_provider.stream_chat(
                    model=model_name,
                    messages=history,
                    options=options,
                    cancel_event=cancel_event,
                ):
                    if event.kind == "delta":
                        chunks.append(event.token)
                        sent = await safe_send(
                            {
                                "type": "chat.delta",
                                "token": event.token,
                                "messageId": assistant_id,
                            }
                        )
                        if not sent:
                            cancel_event.set()
                            break
                    elif event.kind == "stopped":
                        await finalize_assistant("stopped")
                        await safe_send(
                            {
                                "type": "chat.stopped",
                                "messageId": assistant_id,
                            }
                        )
                        return
                    elif event.kind == "done":
                        await finalize_assistant(
                            "complete",
                            token_count=event.token_count,
                            duration_ms=event.duration_ms,
                        )
                        await safe_send(
                            {
                                "type": "chat.done",
                                "messageId": assistant_id,
                                "tokenCount": event.token_count,
                                "durationMs": event.duration_ms,
                            }
                        )
                        return

                if cancel_event.is_set():
                    await finalize_assistant("stopped")
                    await safe_send({"type": "chat.stopped", "messageId": assistant_id})
                else:
                    await finalize_assistant("complete")
                    await safe_send({"type": "chat.done", "messageId": assistant_id})
            except asyncio.CancelledError:
                await finalize_assistant("stopped", error_message="Generation cancelled.")
                raise
            except ProviderError as exc:
                await finalize_assistant("error", error_message=exc.message)
                await safe_send(
                    {
                        "type": "chat.error",
                        "code": exc.code,
                        "message": exc.message,
                    }
                )
            except Exception:
                msg = "Unexpected backend streaming error."
                await finalize_assistant("error", error_message=msg)
                await safe_send(
                    {
                        "type": "chat.error",
                        "code": "INTERNAL_ERROR",
                        "message": msg,
                    }
                )
            finally:
                if not finalized:
                    await finalize_assistant("stopped")

        try:
            while True:
                raw = await ws.receive_text()
                within_limit, byte_size = validate_ws_frame_bytes(raw, cfg.ws_max_frame_bytes)
                if not within_limit:
                    await safe_send(
                        {
                            "type": "chat.error",
                            "code": "FRAME_TOO_LARGE",
                            "message": (
                                f"WebSocket frame ({byte_size} bytes) exceeds maximum "
                                f"limit ({cfg.ws_max_frame_bytes} bytes)."
                            ),
                        }
                    )
                    await ws.close(code=1009)
                    break

                try:
                    frame = json.loads(raw)
                except json.JSONDecodeError:
                    await safe_send(
                        {
                            "type": "chat.error",
                            "code": "INVALID_JSON",
                            "message": "WebSocket frame must be valid JSON.",
                        }
                    )
                    continue

                if not isinstance(frame, dict):
                    await safe_send(
                        {
                            "type": "chat.error",
                            "code": "INVALID_REQUEST",
                            "message": "WebSocket frame must be a JSON object.",
                        }
                    )
                    continue

                ftype = frame.get("type")
                if ftype == "chat.start":
                    raw_messages = frame.get("messages")
                    if isinstance(raw_messages, list) and len(raw_messages) > cfg.ws_max_history_messages:
                        await safe_send(
                            {
                                "type": "chat.error",
                                "code": "INVALID_REQUEST",
                                "message": f"History exceeds maximum of {cfg.ws_max_history_messages} messages.",
                            }
                        )
                        continue
                    try:
                        parsed_start = WsChatStartFrame.model_validate(frame)
                    except ValidationError as exc:
                        first_err = exc.errors()[0].get("msg", "Invalid chat.start payload") if exc.errors() else "Invalid chat.start payload"
                        await safe_send(
                            {
                                "type": "chat.error",
                                "code": "INVALID_REQUEST",
                                "message": str(first_err),
                            }
                        )
                        continue

                    if active_task and not active_task.done():
                        cancel_event.set()
                        try:
                            await asyncio.wait_for(asyncio.shield(active_task), timeout=1.5)
                        except (asyncio.TimeoutError, asyncio.CancelledError, Exception):
                            if not active_task.done():
                                active_task.cancel()
                                try:
                                    await active_task
                                except (asyncio.CancelledError, Exception):
                                    pass
                    cancel_event.clear()
                    active_task = asyncio.create_task(run_stream(parsed_start))
                elif ftype == "chat.stop":
                    try:
                        WsChatStopFrame.model_validate(frame)
                    except ValidationError as exc:
                        first_err = exc.errors()[0].get("msg", "Invalid chat.stop payload") if exc.errors() else "Invalid chat.stop payload"
                        await safe_send(
                            {
                                "type": "chat.error",
                                "code": "INVALID_REQUEST",
                                "message": str(first_err),
                            }
                        )
                        continue
                    cancel_event.set()
                    if active_task and not active_task.done():
                        try:
                            await asyncio.wait_for(asyncio.shield(active_task), timeout=1.5)
                        except (asyncio.TimeoutError, asyncio.CancelledError, Exception):
                            if not active_task.done():
                                active_task.cancel()
                                try:
                                    await active_task
                                except (asyncio.CancelledError, Exception):
                                    pass
                else:
                    await safe_send(
                        {
                            "type": "chat.error",
                            "code": "INVALID_FRAME_TYPE",
                            "message": "Unsupported WebSocket frame type.",
                        }
                    )
        except WebSocketDisconnect:
            cancel_event.set()
            if active_task and not active_task.done():
                try:
                    await asyncio.wait_for(asyncio.shield(active_task), timeout=1.5)
                except (asyncio.TimeoutError, asyncio.CancelledError, Exception):
                    if not active_task.done():
                        active_task.cancel()
                        try:
                            await active_task
                        except (asyncio.CancelledError, Exception):
                            pass
        finally:
            cancel_event.set()
            if active_task and not active_task.done():
                active_task.cancel()
                try:
                    await active_task
                except (asyncio.CancelledError, Exception):
                    pass

    return app


app = create_app()

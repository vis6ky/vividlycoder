from __future__ import annotations

import asyncio
import time
import unittest
from collections.abc import AsyncIterator

from app.config import Settings
from app.providers.base import (
    AIProvider,
    ChatMessageInput,
    ChatOptions,
    ChatStreamEvent,
    ModelDescriptor,
    ProviderError,
    ProviderHealth,
)
from app.providers.ollama import (
    clamp_num_ctx,
    classify_ollama_error,
    estimate_model_memory_gb,
    parse_chat_ndjson_line,
    parse_ollama_models,
)


class _DummyProvider(AIProvider):
    @property
    def provider_name(self) -> str:
        return "dummy"

    async def health_check(self) -> ProviderHealth:
        return ProviderHealth(provider="dummy", status="connected", version="1.0")

    async def list_models(self) -> list[ModelDescriptor]:
        return [ModelDescriptor(name="qwen3.5:4b", role="default")]

    async def stream_chat(
        self,
        model: str,
        messages: list[ChatMessageInput],
        options: ChatOptions,
        cancel_event: asyncio.Event | None = None,
    ) -> AsyncIterator[ChatStreamEvent]:
        yield ChatStreamEvent(kind="delta", token="Hello ")
        yield ChatStreamEvent(kind="delta", token="world")
        yield ChatStreamEvent(kind="done", token_count=2, duration_ms=15)


class ProviderAbstractionTests(unittest.IsolatedAsyncioTestCase):
    def test_defaults_match_finalized_architecture(self) -> None:
        settings = Settings()
        self.assertEqual(settings.host, "127.0.0.1")
        self.assertEqual(settings.default_model, "qwen3.5:4b")
        self.assertEqual(settings.evaluation_model, "qwen3.5:9b")
        self.assertEqual(settings.default_num_ctx, 8192)
        self.assertEqual(settings.max_num_ctx, 16384)
        self.assertEqual(settings.max_loaded_models, 1)

    def test_clamp_num_ctx_enforces_8k_to_16k_budget(self) -> None:
        settings = Settings()
        self.assertEqual(clamp_num_ctx(None, settings), 8192)
        self.assertEqual(clamp_num_ctx(1024, settings), 4096)
        self.assertEqual(clamp_num_ctx(8192, settings), 8192)
        self.assertEqual(clamp_num_ctx(16384, settings), 16384)
        self.assertEqual(clamp_num_ctx(65536, settings), 16384)

    def test_parse_ollama_models_tags_qwen35_roles_and_memory(self) -> None:
        settings = Settings()
        payload = {
            "models": [
                {
                    "name": "qwen3.5:9b",
                    "size": int(5.8 * 1024**3),
                    "details": {"parameter_size": "9B", "quantization_level": "Q4_K_M"},
                },
                {
                    "name": "qwen3.5:4b",
                    "size": int(2.7 * 1024**3),
                    "details": {"parameter_size": "4B", "quantization_level": "Q4_K_M"},
                },
                {
                    "name": "llama3.1:70b",
                    "size": int(40.0 * 1024**3),
                    "details": {"parameter_size": "70B", "quantization_level": "Q4_0"},
                },
            ]
        }
        models = parse_ollama_models(payload, loaded_names={"qwen3.5:4b"}, settings=settings)
        self.assertEqual([m.name for m in models], ["qwen3.5:4b", "qwen3.5:9b", "llama3.1:70b"])
        self.assertEqual(models[0].role, "default")
        self.assertTrue(models[0].is_loaded)
        self.assertTrue(models[0].fits_in_16gb)
        self.assertEqual(models[1].role, "evaluation")
        self.assertTrue(models[1].fits_in_16gb)
        self.assertEqual(models[2].role, "available")
        self.assertFalse(models[2].fits_in_16gb)
        self.assertIsNotNone(estimate_model_memory_gb(models[0].size_bytes, 8192))

    def test_error_classification_provides_actionable_diagnostics(self) -> None:
        missing = classify_ollama_error(404, '{"error":"model \'qwen3.5:4b\' not found"}', "qwen3.5:4b")
        self.assertEqual(missing.code, "MODEL_NOT_FOUND")
        self.assertIn("ollama pull qwen3.5:4b", missing.message)

        oom = classify_ollama_error(
            500,
            '{"error":"model requires more system memory (14.2 GiB) than is available"}',
            "qwen3.5:9b",
        )
        self.assertEqual(oom.code, "INSUFFICIENT_MEMORY")
        self.assertIn("16 GB MacBook Pro M2", oom.message)

    def test_parse_chat_ndjson_line(self) -> None:
        started = time.monotonic() - 0.05
        ev1, count1 = parse_chat_ndjson_line(
            '{"message":{"role":"assistant","content":"def add"},"done":false}',
            started,
            0,
        )
        self.assertIsNotNone(ev1)
        assert ev1 is not None
        self.assertEqual(ev1.kind, "delta")
        self.assertEqual(ev1.token, "def add")
        self.assertEqual(count1, 1)

        ev2, count2 = parse_chat_ndjson_line(
            '{"done":true,"eval_count":12}',
            started,
            count1,
        )
        self.assertIsNotNone(ev2)
        assert ev2 is not None
        self.assertEqual(ev2.kind, "done")
        self.assertEqual(ev2.token_count, 12)
        self.assertEqual(count2, 1)

        with self.assertRaises(ProviderError):
            parse_chat_ndjson_line('{"error":"model not found"}', started, 0)

    async def test_base_provider_chat_aggregates_stream(self) -> None:
        provider = _DummyProvider()
        result = await provider.chat(
            model="qwen3.5:4b",
            messages=[ChatMessageInput(role="user", content="Hi")],
            options=ChatOptions(temperature=0.2, num_ctx=8192),
        )
        self.assertEqual(result.content, "Hello world")
        self.assertEqual(result.token_count, 2)


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import asyncio
import os
import tempfile
import unittest
from collections.abc import AsyncIterator

try:
    from fastapi.testclient import TestClient

    HAS_FASTAPI = True
except ImportError:
    HAS_FASTAPI = False

from app.config import Settings
from app.db.repository import SQLiteRepository
from app.providers.base import (
    AIProvider,
    ChatMessageInput,
    ChatOptions,
    ChatStreamEvent,
    ModelDescriptor,
    ProviderError,
    ProviderHealth,
)


class _StubLocalRuntimeProvider(AIProvider):
    """Test double simulating Ollama transport behavior for FastAPI route tests."""

    def __init__(self, fail_chat: bool = False, slow_tokens: bool = False) -> None:
        self.fail_chat = fail_chat
        self.slow_tokens = slow_tokens

    @property
    def provider_name(self) -> str:
        return "ollama"

    async def health_check(self) -> ProviderHealth:
        return ProviderHealth(
            provider="ollama",
            status="connected",
            version="0.6.0",
            loaded_models=["qwen3.5:4b"],
        )

    async def list_models(self) -> list[ModelDescriptor]:
        return [
            ModelDescriptor(
                name="qwen3.5:4b",
                parameter_size="4B",
                quantization="Q4_K_M",
                role="default",
                is_loaded=True,
                memory_estimate_gb=3.5,
                fits_in_16gb=True,
            ),
            ModelDescriptor(
                name="qwen3.5:9b",
                parameter_size="9B",
                quantization="Q4_K_M",
                role="evaluation",
                is_loaded=False,
                memory_estimate_gb=6.6,
                fits_in_16gb=True,
            ),
        ]

    async def stream_chat(
        self,
        model: str,
        messages: list[ChatMessageInput],
        options: ChatOptions,
        cancel_event: asyncio.Event | None = None,
    ) -> AsyncIterator[ChatStreamEvent]:
        if self.fail_chat:
            raise ProviderError("MODEL_NOT_FOUND", "Run: ollama pull qwen3.5:4b", 404)
        for idx, token in enumerate(["print(", "'vividcoder'", ")"]):
            if cancel_event and cancel_event.is_set():
                yield ChatStreamEvent(kind="stopped")
                return
            yield ChatStreamEvent(kind="delta", token=token)
            if self.slow_tokens and idx == 0:
                await asyncio.sleep(0.25)
        yield ChatStreamEvent(kind="done", token_count=3, duration_ms=25)


@unittest.skipUnless(HAS_FASTAPI, "FastAPI not installed in current container; run inside backend/.venv")
class FastAPIRouteTests(unittest.TestCase):
    LOCAL_WS_HEADERS = {"Origin": "http://127.0.0.1:3000"}

    def setUp(self) -> None:
        from app.main import create_app

        self._tmpdir = tempfile.TemporaryDirectory()
        db_path = os.path.join(self._tmpdir.name, "routes_test.db")
        self.repo = SQLiteRepository(db_path)
        self.provider = _StubLocalRuntimeProvider()
        self.app = create_app(
            settings=Settings(db_path=db_path, ws_max_frame_bytes=2048),
            provider=self.provider,
            repository=self.repo,
        )
        self.client = TestClient(self.app)
        self.client.__enter__()

    def tearDown(self) -> None:
        self.client.__exit__(None, None, None)
        self._tmpdir.cleanup()

    def test_health_and_models_endpoints(self) -> None:
        health = self.client.get("/api/health")
        self.assertEqual(health.status_code, 200)
        body = health.json()
        self.assertEqual(body["backendStatus"], "ok")
        self.assertEqual(body["ollamaStatus"], "connected")
        self.assertEqual(body["defaultModel"], "qwen3.5:4b")
        self.assertEqual(body["evaluationModel"], "qwen3.5:9b")

        models = self.client.get("/api/models")
        self.assertEqual(models.status_code, 200)
        names = [m["name"] for m in models.json()["models"]]
        self.assertEqual(names, ["qwen3.5:4b", "qwen3.5:9b"])

    def test_projects_and_websocket_streaming_persistence(self) -> None:
        proj_res = self.client.post(
            "/api/projects",
            json={"name": "sample", "path": "/Users/dev/sample", "language": "Python"},
        )
        self.assertEqual(proj_res.status_code, 201)
        project_id = proj_res.json()["id"]

        with self.client.websocket_connect("/ws/chat", headers=self.LOCAL_WS_HEADERS) as ws:
            ws.send_json(
                {
                    "type": "chat.start",
                    "conversationId": "conv_ws_1",
                    "projectId": project_id,
                    "model": "qwen3.5:4b",
                    "prompt": "Print vividcoder",
                    "messages": [{"role": "user", "content": "Print vividcoder"}],
                    "options": {"temperature": 0.2, "num_ctx": 8192},
                }
            )
            frames = []
            while True:
                frame = ws.receive_json()
                frames.append(frame)
                if frame["type"] in ("chat.done", "chat.error", "chat.stopped"):
                    break

        tokens = "".join(f["token"] for f in frames if f["type"] == "chat.delta")
        self.assertEqual(tokens, "print('vividcoder')")

        msgs = self.client.get("/api/conversations/conv_ws_1/messages").json()["messages"]
        self.assertEqual(len(msgs), 2)
        self.assertEqual(msgs[0]["role"], "user")
        self.assertEqual(msgs[1]["content"], "print('vividcoder')")
        self.assertEqual(msgs[1]["status"], "complete")

    def test_ws_origin_rejection_and_oversized_frame(self) -> None:
        with self.assertRaises(Exception):
            with self.client.websocket_connect("/ws/chat", headers={"Origin": "https://evil.example"}):
                pass

        with self.assertRaises(Exception):
            with self.client.websocket_connect("/ws/chat"):
                pass

        with self.client.websocket_connect("/ws/chat", headers=self.LOCAL_WS_HEADERS) as ws:
            ws.send_text('{"type":"chat.start","prompt":"' + ("a" * 3000) + '"}')
            err = ws.receive_json()
            self.assertEqual(err["type"], "chat.error")
            self.assertEqual(err["code"], "FRAME_TOO_LARGE")

    def test_ws_cancellation_disconnect_and_provider_error_finalize_sqlite(self) -> None:
        self.provider.slow_tokens = True

        # 1. Explicit chat.stop cancellation
        with self.client.websocket_connect("/ws/chat", headers=self.LOCAL_WS_HEADERS) as ws:
            ws.send_json(
                {
                    "type": "chat.start",
                    "conversationId": "conv_cancel_1",
                    "model": "qwen3.5:4b",
                    "prompt": "Cancel me",
                    "messages": [{"role": "user", "content": "Cancel me"}],
                }
            )
            started = ws.receive_json()
            self.assertEqual(started["type"], "chat.started")
            delta = ws.receive_json()
            self.assertEqual(delta["type"], "chat.delta")
            ws.send_json({"type": "chat.stop", "conversationId": "conv_cancel_1"})
            final = ws.receive_json()
            self.assertEqual(final["type"], "chat.stopped")

        msgs_cancel = self.client.get("/api/conversations/conv_cancel_1/messages").json()["messages"]
        self.assertEqual(len(msgs_cancel), 2)
        self.assertEqual(msgs_cancel[1]["status"], "stopped")

        # 2. Unexpected WebSocket disconnect mid-stream
        with self.client.websocket_connect("/ws/chat", headers=self.LOCAL_WS_HEADERS) as ws:
            ws.send_json(
                {
                    "type": "chat.start",
                    "conversationId": "conv_disc_1",
                    "model": "qwen3.5:4b",
                    "prompt": "Disconnect mid-stream",
                    "messages": [{"role": "user", "content": "Disconnect mid-stream"}],
                }
            )
            ws.receive_json()  # chat.started
            ws.receive_json()  # first chat.delta

        msgs_disc = self.client.get("/api/conversations/conv_disc_1/messages").json()["messages"]
        self.assertEqual(len(msgs_disc), 2)
        self.assertEqual(msgs_disc[1]["status"], "stopped")

        # 3. Ollama ProviderError during streaming
        self.provider.slow_tokens = False
        self.provider.fail_chat = True
        with self.client.websocket_connect("/ws/chat", headers=self.LOCAL_WS_HEADERS) as ws:
            ws.send_json(
                {
                    "type": "chat.start",
                    "conversationId": "conv_err_1",
                    "model": "qwen3.5:4b",
                    "prompt": "Trigger error",
                    "messages": [{"role": "user", "content": "Trigger error"}],
                }
            )
            frames = []
            while True:
                frame = ws.receive_json()
                frames.append(frame)
                if frame["type"] == "chat.error":
                    break

        msgs_err = self.client.get("/api/conversations/conv_err_1/messages").json()["messages"]
        self.assertEqual(len(msgs_err), 2)
        self.assertEqual(msgs_err[1]["status"], "error")
        self.assertIn("ollama pull qwen3.5:4b", msgs_err[1]["errorMessage"])


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from app.config import BACKEND_ROOT, Settings, parse_dotenv_file
from app.ws_security import (
    is_ws_origin_allowed,
    sanitize_chat_history,
    validate_ws_frame_bytes,
)


class WebSocketSecurityAndConfigTests(unittest.TestCase):
    def test_ws_origin_validation_accepts_local_and_rejects_untrusted(self) -> None:
        allowed = ["http://127.0.0.1:3000", "http://localhost:3000"]
        self.assertTrue(is_ws_origin_allowed("http://127.0.0.1:3000", allowed))
        self.assertTrue(is_ws_origin_allowed("http://localhost:3000/", allowed))
        self.assertTrue(is_ws_origin_allowed("HTTP://LOCALHOST:3000", allowed))

        self.assertFalse(is_ws_origin_allowed(None, allowed))
        self.assertFalse(is_ws_origin_allowed("", allowed))
        self.assertFalse(is_ws_origin_allowed("https://evil.example", allowed))
        self.assertFalse(is_ws_origin_allowed("http://127.0.0.1:3000/subpath", allowed))
        self.assertFalse(is_ws_origin_allowed("http://localhost:8080", allowed))
        self.assertFalse(is_ws_origin_allowed("https://evil.example", ["*"]))

    def test_ws_frame_size_limit(self) -> None:
        ok_small, size_small = validate_ws_frame_bytes('{"type":"chat.stop"}', 1024)
        self.assertTrue(ok_small)
        self.assertLess(size_small, 1024)

        oversized_payload = "x" * 2048
        ok_big, size_big = validate_ws_frame_bytes(oversized_payload, 1024)
        self.assertFalse(ok_big)
        self.assertEqual(size_big, 2048)

    def test_history_sanitization_filters_empty_and_duplicate_trailing_prompt(self) -> None:
        raw = [
            {"role": "user", "content": "first question"},
            {"role": "assistant", "content": "first answer"},
            {"role": "user", "content": "failed prompt"},
            {"role": "assistant", "content": ""},
            {"role": "assistant", "content": "   "},
            {"role": "user", "content": "next prompt"},
        ]
        cleaned = sanitize_chat_history(raw, prompt="next prompt", max_history=50)
        self.assertEqual(
            [(m.role, m.content) for m in cleaned],
            [
                ("user", "first question"),
                ("assistant", "first answer"),
                ("user", "failed prompt"),
                ("user", "next prompt"),
            ],
        )

        with self.assertRaises(ValueError):
            sanitize_chat_history([{"role": "system", "content": "ok"}] * 5, prompt="hi", max_history=3)

        with self.assertRaises(ValueError):
            sanitize_chat_history([{"role": "tool", "content": "x"}], prompt="hi")

    def test_dotenv_loading_and_precedence(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            env_file = Path(tmpdir) / ".env"
            env_file.write_text(
                "\n".join(
                    [
                        "# Sample local config",
                        "VIVIDCODER_PORT=8123 # inline comment",
                        'VIVIDCODER_DEFAULT_MODEL="qwen3.5:9b"',
                        "VIVIDCODER_DB_PATH=local_test.db",
                        "VIVIDCODER_WS_MAX_FRAME_BYTES=32768",
                        "export VIVIDCODER_ALLOWED_ORIGINS=http://127.0.0.1:3000,http://localhost:3000,*",
                    ]
                ),
                encoding="utf-8",
            )

            parsed = parse_dotenv_file(env_file)
            self.assertEqual(parsed["VIVIDCODER_PORT"], "8123")
            self.assertEqual(parsed["VIVIDCODER_DEFAULT_MODEL"], "qwen3.5:9b")

            # OS environment overrides .env
            prev_port = os.environ.get("VIVIDCODER_PORT")
            prev_model = os.environ.pop("VIVIDCODER_DEFAULT_MODEL", None)
            os.environ["VIVIDCODER_PORT"] = "8999"
            try:
                cfg = Settings.from_env(env_file=env_file)
                self.assertEqual(cfg.port, 8999)
                self.assertEqual(cfg.default_model, "qwen3.5:9b")
                self.assertEqual(cfg.ws_max_frame_bytes, 32768)
                self.assertEqual(
                    cfg.allowed_origins,
                    ["http://127.0.0.1:3000", "http://localhost:3000"],
                )
                self.assertEqual(cfg.db_path, str((BACKEND_ROOT / "local_test.db").resolve()))
            finally:
                if prev_port is None:
                    os.environ.pop("VIVIDCODER_PORT", None)
                else:
                    os.environ["VIVIDCODER_PORT"] = prev_port
                if prev_model is not None:
                    os.environ["VIVIDCODER_DEFAULT_MODEL"] = prev_model


if __name__ == "__main__":
    unittest.main()

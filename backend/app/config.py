from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

BACKEND_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_ALLOWED_ORIGINS = ("http://127.0.0.1:3000", "http://localhost:3000")


def parse_dotenv_file(env_path: Path) -> dict[str, str]:
    """Parse a .env file using Python stdlib only (no external dependency required)."""
    if not env_path.is_file():
        return {}

    parsed: dict[str, str] = {}
    try:
        content = env_path.read_text(encoding="utf-8")
    except OSError:
        return {}

    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue

        key, raw_val = line.split("=", 1)
        key = key.strip()
        if not key or not all(ch.isalnum() or ch == "_" for ch in key):
            continue

        val = raw_val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in ('"', "'"):
            quote = val[0]
            inner = val[1:-1]
            if quote == '"':
                inner = (
                    inner.replace("\\n", "\n")
                    .replace("\\r", "\r")
                    .replace("\\t", "\t")
                    .replace('\\"', '"')
                )
            val = inner
        else:
            # Strip trailing inline comments on unquoted values (e.g., VAL=8000 # comment)
            for idx, ch in enumerate(val):
                if ch == "#" and (idx == 0 or val[idx - 1].isspace()):
                    val = val[:idx].strip()
                    break

        parsed[key] = val

    return parsed


def _get_env_value(
    env_name: str,
    dotenv_values: dict[str, str],
    default: str | None = None,
) -> str | None:
    """Configuration precedence: OS environment > backend/.env > built-in default."""
    if env_name in os.environ:
        return os.environ[env_name]
    if env_name in dotenv_values:
        return dotenv_values[env_name]
    return default


def _parse_int(
    env_name: str,
    dotenv_values: dict[str, str],
    default: int,
    minimum: int,
    maximum: int,
) -> int:
    raw = _get_env_value(env_name, dotenv_values)
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw.strip())
    except ValueError:
        return default
    return max(minimum, min(maximum, value))


def _parse_origins(raw: str | None) -> list[str]:
    if not raw or not raw.strip():
        return list(DEFAULT_ALLOWED_ORIGINS)
    origins: list[str] = []
    for item in raw.split(","):
        cleaned = item.strip().rstrip("/")
        if not cleaned or cleaned == "*":
            continue
        parsed = urlparse(cleaned)
        if parsed.scheme in ("http", "https") and parsed.netloc:
            normalized = f"{parsed.scheme}://{parsed.netloc}"
            if normalized not in origins:
                origins.append(normalized)
    return origins or list(DEFAULT_ALLOWED_ORIGINS)


def _validate_http_url(url: str, fallback: str) -> str:
    cleaned = url.strip().rstrip("/")
    parsed = urlparse(cleaned)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return fallback
    return cleaned


def _resolve_db_path(raw_path: str) -> str:
    cleaned = raw_path.strip() or "vividcoder.db"
    if cleaned == ":memory:":
        return cleaned
    candidate = Path(cleaned)
    if candidate.is_absolute():
        return str(candidate)
    return str((BACKEND_ROOT / candidate).resolve())


@dataclass(frozen=True)
class Settings:
    host: str = "127.0.0.1"
    port: int = 8000
    ollama_base_url: str = "http://127.0.0.1:11434"
    default_model: str = "qwen3.5:4b"
    evaluation_model: str = "qwen3.5:9b"
    min_num_ctx: int = 4096
    default_num_ctx: int = 8192
    max_num_ctx: int = 16384
    max_loaded_models: int = 1
    keep_alive: str = "5m"
    db_path: str = "vividcoder.db"
    ws_max_frame_bytes: int = 262144
    ws_max_history_messages: int = 100
    allowed_origins: list[str] = field(
        default_factory=lambda: list(DEFAULT_ALLOWED_ORIGINS)
    )

    @classmethod
    def from_env(cls, env_file: str | Path | None = None) -> Settings:
        env_path = Path(env_file) if env_file is not None else (BACKEND_ROOT / ".env")
        dotenv_values = parse_dotenv_file(env_path)

        host = (_get_env_value("VIVIDCODER_HOST", dotenv_values, "127.0.0.1") or "127.0.0.1").strip() or "127.0.0.1"
        port = _parse_int("VIVIDCODER_PORT", dotenv_values, 8000, 1024, 65535)
        ollama_url = _validate_http_url(
            _get_env_value("VIVIDCODER_OLLAMA_URL", dotenv_values, "http://127.0.0.1:11434")
            or "http://127.0.0.1:11434",
            "http://127.0.0.1:11434",
        )
        default_model = (
            _get_env_value("VIVIDCODER_DEFAULT_MODEL", dotenv_values, "qwen3.5:4b") or "qwen3.5:4b"
        ).strip() or "qwen3.5:4b"
        eval_model = (
            _get_env_value("VIVIDCODER_EVALUATION_MODEL", dotenv_values, "qwen3.5:9b") or "qwen3.5:9b"
        ).strip() or "qwen3.5:9b"
        default_ctx = _parse_int("VIVIDCODER_DEFAULT_NUM_CTX", dotenv_values, 8192, 4096, 16384)
        max_ctx = _parse_int("VIVIDCODER_MAX_NUM_CTX", dotenv_values, 16384, 8192, 16384)
        keep_alive = (
            _get_env_value("VIVIDCODER_KEEP_ALIVE", dotenv_values, "5m") or "5m"
        ).strip() or "5m"
        raw_db_path = (
            _get_env_value("VIVIDCODER_DB_PATH", dotenv_values, "vividcoder.db") or "vividcoder.db"
        )
        db_path = _resolve_db_path(raw_db_path)
        ws_max_frame_bytes = _parse_int(
            "VIVIDCODER_WS_MAX_FRAME_BYTES", dotenv_values, 262144, 16384, 1048576
        )
        ws_max_history_messages = _parse_int(
            "VIVIDCODER_WS_MAX_HISTORY_MESSAGES", dotenv_values, 100, 1, 500
        )
        allowed_origins = _parse_origins(
            _get_env_value("VIVIDCODER_ALLOWED_ORIGINS", dotenv_values)
        )

        return cls(
            host=host,
            port=port,
            ollama_base_url=ollama_url,
            default_model=default_model,
            evaluation_model=eval_model,
            default_num_ctx=min(default_ctx, max_ctx),
            max_num_ctx=max_ctx,
            keep_alive=keep_alive,
            db_path=db_path,
            ws_max_frame_bytes=ws_max_frame_bytes,
            ws_max_history_messages=ws_max_history_messages,
            allowed_origins=allowed_origins,
        )

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

from .providers.base import ChatMessageInput

SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,120}$")
SAFE_MODEL_RE = re.compile(r"^[A-Za-z0-9_.:/-]{1,120}$")


def normalize_origin(raw_origin: str | None) -> str | None:
    if not raw_origin:
        return None
    cleaned = raw_origin.strip().rstrip("/")
    if not cleaned:
        return None
    parsed = urlparse(cleaned)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return None
    # Reject origins containing paths, queries, fragments, or userinfo
    if parsed.path not in ("", "/") or parsed.query or parsed.fragment or parsed.username or parsed.password:
        return None
    return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"


def is_ws_origin_allowed(raw_origin: str | None, allowed_origins: list[str]) -> bool:
    """Strictly validate WebSocket Origin header against explicitly configured local origins."""
    normalized = normalize_origin(raw_origin)
    if normalized is None:
        return False
    allowed_set = {
        norm
        for item in allowed_origins
        if item.strip() != "*"
        for norm in [normalize_origin(item)]
        if norm is not None
    }
    return normalized in allowed_set


def validate_ws_frame_bytes(raw_text: str, max_bytes: int) -> tuple[bool, int]:
    """Verify UTF-8 byte length of incoming WebSocket text frame."""
    size = len(raw_text.encode("utf-8", errors="replace"))
    return size <= max_bytes, size


def validate_safe_identifier(value: Any, field_name: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{field_name} must be a string")
    cleaned = value.strip()
    if not cleaned:
        return None
    if not SAFE_ID_RE.match(cleaned):
        raise ValueError(f"{field_name} contains unsupported characters")
    return cleaned


def validate_model_name(value: Any, default_model: str) -> str:
    if value is None:
        return default_model
    if not isinstance(value, str):
        raise ValueError("model must be a string")
    cleaned = value.strip()
    if not cleaned:
        return default_model
    if not SAFE_MODEL_RE.match(cleaned):
        raise ValueError("model contains unsupported characters")
    return cleaned


def sanitize_chat_history(
    raw_messages: Any,
    prompt: str,
    max_history: int = 100,
    max_message_chars: int = 100000,
) -> list[ChatMessageInput]:
    """Filter empty/invalid messages, preserve legitimate turns, and prevent duplicate trailing prompts."""
    if raw_messages is None:
        raw_list: list[Any] = []
    elif isinstance(raw_messages, list):
        raw_list = raw_messages
    else:
        raise ValueError("messages must be a list")

    if len(raw_list) > max_history:
        raise ValueError(f"messages exceeds maximum of {max_history} items")

    cleaned_history: list[ChatMessageInput] = []
    for item in raw_list:
        if not isinstance(item, dict):
            raise ValueError("each message item must be an object")
        role = item.get("role")
        if role not in ("user", "assistant", "system"):
            raise ValueError("message role must be user, assistant, or system")
        raw_content = item.get("content")
        if not isinstance(raw_content, str):
            raise ValueError("message content must be a string")
        if len(raw_content) > max_message_chars:
            raise ValueError(f"message content exceeds {max_message_chars} characters")
        if not raw_content.strip():
            # Skip empty assistant/error remnants so failed turns never poison model context
            continue
        cleaned_history.append(ChatMessageInput(role=role, content=raw_content))

    if not cleaned_history or cleaned_history[-1].role != "user" or cleaned_history[-1].content != prompt:
        cleaned_history.append(ChatMessageInput(role="user", content=prompt))

    return cleaned_history

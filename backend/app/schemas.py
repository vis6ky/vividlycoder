from __future__ import annotations

import re
from typing import Literal
from pydantic import BaseModel, Field, field_validator

SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,120}$")
SAFE_MODEL_RE = re.compile(r"^[A-Za-z0-9_.:/-]{1,120}$")


def _validate_non_blank(value: str, field_name: str) -> str:
    if not value.strip():
        raise ValueError(f"{field_name} must not be blank")
    return value


def _validate_safe_id(value: str | None, field_name: str) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    if not SAFE_ID_RE.match(cleaned):
        raise ValueError(f"{field_name} contains unsupported characters")
    return cleaned


class ProjectCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    path: str = Field(..., min_length=1, max_length=1024)
    language: str | None = Field(default=None, max_length=64)

    @field_validator("name", "path")
    @classmethod
    def check_non_blank(cls, v: str, info: object) -> str:
        field_name = getattr(info, "field_name", "field")
        return _validate_non_blank(v, field_name).strip()


class ConversationCreateRequest(BaseModel):
    title: str | None = Field(default="New Conversation", max_length=200)
    projectId: str | None = Field(default=None, max_length=120)
    model: str = Field(default="qwen3.5:4b", min_length=1, max_length=120)

    @field_validator("projectId")
    @classmethod
    def check_project_id(cls, v: str | None) -> str | None:
        return _validate_safe_id(v, "projectId")

    @field_validator("model")
    @classmethod
    def check_model(cls, v: str) -> str:
        cleaned = v.strip()
        if not SAFE_MODEL_RE.match(cleaned):
            raise ValueError("model contains unsupported characters")
        return cleaned


class ChatMessagePayload(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str = Field(..., min_length=1, max_length=100000)

    @field_validator("content")
    @classmethod
    def check_content_non_blank(cls, v: str) -> str:
        return _validate_non_blank(v, "content")


class ChatOptionsPayload(BaseModel):
    temperature: float = Field(default=0.2, ge=0.0, le=2.0)
    num_ctx: int = Field(default=8192, ge=4096, le=16384)


class RestChatRequest(BaseModel):
    conversationId: str | None = Field(default=None, max_length=120)
    projectId: str | None = Field(default=None, max_length=120)
    model: str = Field(default="qwen3.5:4b", min_length=1, max_length=120)
    prompt: str = Field(..., min_length=1, max_length=100000)
    messages: list[ChatMessagePayload] = Field(default_factory=list, max_length=100)
    options: ChatOptionsPayload = Field(default_factory=ChatOptionsPayload)

    @field_validator("conversationId", "projectId")
    @classmethod
    def check_ids(cls, v: str | None, info: object) -> str | None:
        field_name = getattr(info, "field_name", "id")
        return _validate_safe_id(v, field_name)

    @field_validator("model")
    @classmethod
    def check_model(cls, v: str) -> str:
        cleaned = v.strip()
        if not SAFE_MODEL_RE.match(cleaned):
            raise ValueError("model contains unsupported characters")
        return cleaned

    @field_validator("prompt")
    @classmethod
    def check_prompt(cls, v: str) -> str:
        return _validate_non_blank(v, "prompt")


class WsChatStartFrame(BaseModel):
    type: Literal["chat.start"]
    conversationId: str = Field(..., min_length=1, max_length=120)
    projectId: str | None = Field(default=None, max_length=120)
    model: str | None = Field(default=None, max_length=120)
    prompt: str = Field(..., min_length=1, max_length=100000)
    messages: list[ChatMessagePayload] = Field(default_factory=list, max_length=100)
    options: ChatOptionsPayload = Field(default_factory=ChatOptionsPayload)

    @field_validator("conversationId")
    @classmethod
    def check_conv_id(cls, v: str) -> str:
        cleaned = _validate_safe_id(v, "conversationId")
        if not cleaned:
            raise ValueError("conversationId is required")
        return cleaned

    @field_validator("projectId")
    @classmethod
    def check_proj_id(cls, v: str | None) -> str | None:
        return _validate_safe_id(v, "projectId")

    @field_validator("model")
    @classmethod
    def check_model(cls, v: str | None) -> str | None:
        if v is None:
            return None
        cleaned = v.strip()
        if not cleaned:
            return None
        if not SAFE_MODEL_RE.match(cleaned):
            raise ValueError("model contains unsupported characters")
        return cleaned

    @field_validator("prompt")
    @classmethod
    def check_prompt(cls, v: str) -> str:
        return _validate_non_blank(v, "prompt")


class WsChatStopFrame(BaseModel):
    type: Literal["chat.stop"]
    conversationId: str | None = Field(default=None, max_length=120)

    @field_validator("conversationId")
    @classmethod
    def check_conv_id(cls, v: str | None) -> str | None:
        return _validate_safe_id(v, "conversationId")

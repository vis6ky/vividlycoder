from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Literal

ProviderErrorCode = Literal[
    "RUNTIME_OFFLINE",
    "MODEL_NOT_FOUND",
    "INSUFFICIENT_MEMORY",
    "TIMEOUT",
    "PROVIDER_ERROR",
]


class ProviderError(Exception):
    """Structured error raised by any AI provider implementation."""

    def __init__(self, code: ProviderErrorCode, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.code: ProviderErrorCode = code
        self.message: str = message
        self.status_code: int = status_code


@dataclass(frozen=True)
class ProviderHealth:
    provider: str
    status: Literal["connected", "offline", "error"]
    version: str | None = None
    loaded_models: list[str] = field(default_factory=list)
    error: str | None = None


@dataclass(frozen=True)
class ModelDescriptor:
    name: str
    size_bytes: int | None = None
    parameter_size: str | None = None
    quantization: str | None = None
    family: str | None = None
    modified_at: str | None = None
    role: Literal["default", "evaluation", "available"] = "available"
    is_loaded: bool = False
    memory_estimate_gb: float | None = None
    fits_in_16gb: bool = True


@dataclass(frozen=True)
class ChatMessageInput:
    role: Literal["user", "assistant", "system"]
    content: str


@dataclass(frozen=True)
class ChatOptions:
    temperature: float = 0.2
    num_ctx: int = 8192


@dataclass(frozen=True)
class ChatStreamEvent:
    kind: Literal["delta", "done", "stopped"]
    token: str = ""
    token_count: int | None = None
    duration_ms: int | None = None


@dataclass(frozen=True)
class ChatCompletionResult:
    content: str
    model: str
    token_count: int | None = None
    duration_ms: int | None = None


class AIProvider(ABC):
    """Model-independent AI provider abstraction for VividCoder."""

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Identifier of the concrete provider (e.g. 'ollama')."""

    @abstractmethod
    async def health_check(self) -> ProviderHealth:
        """Check local runtime connectivity and loaded models."""

    @abstractmethod
    async def list_models(self) -> list[ModelDescriptor]:
        """Discover models available from the provider runtime."""

    @abstractmethod
    def stream_chat(
        self,
        model: str,
        messages: list[ChatMessageInput],
        options: ChatOptions,
        cancel_event: asyncio.Event | None = None,
    ) -> AsyncIterator[ChatStreamEvent]:
        """Stream incremental tokens from the model."""

    async def chat(
        self,
        model: str,
        messages: list[ChatMessageInput],
        options: ChatOptions,
    ) -> ChatCompletionResult:
        """Convenience non-streaming chat built on top of stream_chat."""
        chunks: list[str] = []
        token_count: int | None = None
        duration_ms: int | None = None
        async for event in self.stream_chat(model=model, messages=messages, options=options):
            if event.kind == "delta":
                chunks.append(event.token)
            elif event.kind == "done":
                token_count = event.token_count
                duration_ms = event.duration_ms
        return ChatCompletionResult(
            content="".join(chunks),
            model=model,
            token_count=token_count,
            duration_ms=duration_ms,
        )

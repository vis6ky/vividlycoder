from __future__ import annotations

import asyncio
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class SQLiteRepository:
    """Thread-safe parameterized SQLite persistence for projects, conversations, and messages."""

    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        self._lock = threading.Lock()
        self._conn: sqlite3.Connection | None = None

    def _get_connection(self) -> sqlite3.Connection:
        if self._conn is None:
            if self._db_path != ":memory:":
                Path(self._db_path).parent.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(self._db_path, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys = ON;")
            if self._db_path != ":memory:":
                conn.execute("PRAGMA journal_mode = WAL;")
            self._conn = conn
        return self._conn

    def init_db_sync(self) -> None:
        with self._lock:
            conn = self._get_connection()
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    path TEXT NOT NULL,
                    language TEXT,
                    last_opened_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS conversations (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
                    model TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
                    content TEXT NOT NULL,
                    model TEXT,
                    created_at TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('complete', 'streaming', 'stopped', 'error')),
                    error_message TEXT,
                    token_count INTEGER,
                    duration_ms INTEGER
                );

                CREATE INDEX IF NOT EXISTS idx_conversations_updated
                    ON conversations(updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
                    ON messages(conversation_id, created_at ASC);
                """
            )
            conn.execute(
                """
                UPDATE messages
                SET status = 'stopped',
                    error_message = COALESCE(error_message, 'Generation interrupted before completion.')
                WHERE status = 'streaming'
                """
            )
            conn.commit()

    def close_sync(self) -> None:
        with self._lock:
            if self._conn is not None:
                self._conn.close()
                self._conn = None

    def check_health_sync(self) -> bool:
        try:
            with self._lock:
                conn = self._get_connection()
                conn.execute("SELECT 1;").fetchone()
            return True
        except Exception:
            return False

    # --- Projects ---

    def list_projects_sync(self) -> list[dict[str, Any]]:
        with self._lock:
            conn = self._get_connection()
            rows = conn.execute(
                "SELECT id, name, path, language, last_opened_at FROM projects ORDER BY last_opened_at DESC"
            ).fetchall()
            return [
                {
                    "id": r["id"],
                    "name": r["name"],
                    "path": r["path"],
                    "language": r["language"],
                    "lastOpenedAt": r["last_opened_at"],
                }
                for r in rows
            ]

    def create_project_sync(self, name: str, path: str, language: str | None = None) -> dict[str, Any]:
        pid = f"proj_{uuid.uuid4().hex[:12]}"
        now = utc_now_iso()
        with self._lock:
            conn = self._get_connection()
            conn.execute(
                "INSERT INTO projects (id, name, path, language, last_opened_at) VALUES (?, ?, ?, ?, ?)",
                (pid, name, path, language, now),
            )
            conn.commit()
        return {
            "id": pid,
            "name": name,
            "path": path,
            "language": language,
            "lastOpenedAt": now,
        }

    def get_project_sync(self, project_id: str) -> dict[str, Any] | None:
        with self._lock:
            conn = self._get_connection()
            row = conn.execute(
                "SELECT id, name, path, language, last_opened_at FROM projects WHERE id = ?",
                (project_id,),
            ).fetchone()
            if not row:
                return None
            return {
                "id": row["id"],
                "name": row["name"],
                "path": row["path"],
                "language": row["language"],
                "lastOpenedAt": row["last_opened_at"],
            }

    # --- Conversations ---

    def list_conversations_sync(self, project_id: str | None = None) -> list[dict[str, Any]]:
        with self._lock:
            conn = self._get_connection()
            if project_id:
                rows = conn.execute(
                    """
                    SELECT c.id, c.title, c.project_id, c.model, c.created_at, c.updated_at,
                           COUNT(m.id) AS message_count
                    FROM conversations c
                    LEFT JOIN messages m ON m.conversation_id = c.id
                    WHERE c.project_id = ?
                    GROUP BY c.id
                    ORDER BY c.updated_at DESC
                    """,
                    (project_id,),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT c.id, c.title, c.project_id, c.model, c.created_at, c.updated_at,
                           COUNT(m.id) AS message_count
                    FROM conversations c
                    LEFT JOIN messages m ON m.conversation_id = c.id
                    GROUP BY c.id
                    ORDER BY c.updated_at DESC
                    """
                ).fetchall()
            return [
                {
                    "id": r["id"],
                    "title": r["title"],
                    "projectId": r["project_id"],
                    "model": r["model"],
                    "createdAt": r["created_at"],
                    "updatedAt": r["updated_at"],
                    "messageCount": r["message_count"],
                }
                for r in rows
            ]

    def create_conversation_sync(
        self,
        title: str,
        model: str,
        project_id: str | None = None,
        conversation_id: str | None = None,
    ) -> dict[str, Any]:
        cid = conversation_id or f"conv_{uuid.uuid4().hex[:12]}"
        now = utc_now_iso()
        with self._lock:
            conn = self._get_connection()
            valid_project_id = project_id
            if project_id:
                proj = conn.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
                if not proj:
                    valid_project_id = None
            conn.execute(
                """
                INSERT INTO conversations (id, title, project_id, model, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (cid, title, valid_project_id, model, now, now),
            )
            conn.commit()
        return {
            "id": cid,
            "title": title,
            "projectId": valid_project_id,
            "model": model,
            "createdAt": now,
            "updatedAt": now,
            "messageCount": 0,
        }

    def ensure_conversation_sync(
        self,
        conversation_id: str,
        title: str,
        model: str,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            conn = self._get_connection()
            existing = conn.execute(
                "SELECT id, title, project_id, model, created_at, updated_at FROM conversations WHERE id = ?",
                (conversation_id,),
            ).fetchone()
            if existing:
                return {
                    "id": existing["id"],
                    "title": existing["title"],
                    "projectId": existing["project_id"],
                    "model": existing["model"],
                    "createdAt": existing["created_at"],
                    "updatedAt": existing["updated_at"],
                    "messageCount": 0,
                }
        return self.create_conversation_sync(
            title=title,
            model=model,
            project_id=project_id,
            conversation_id=conversation_id,
        )

    def delete_conversation_sync(self, conversation_id: str) -> bool:
        with self._lock:
            conn = self._get_connection()
            cur = conn.execute("DELETE FROM conversations WHERE id = ?", (conversation_id,))
            conn.commit()
            return cur.rowcount > 0

    # --- Messages ---

    def list_messages_sync(self, conversation_id: str) -> list[dict[str, Any]]:
        with self._lock:
            conn = self._get_connection()
            rows = conn.execute(
                """
                SELECT id, conversation_id, role, content, model, created_at, status,
                       error_message, token_count, duration_ms
                FROM messages
                WHERE conversation_id = ?
                ORDER BY created_at ASC, rowid ASC
                """,
                (conversation_id,),
            ).fetchall()
            return [
                {
                    "id": r["id"],
                    "conversationId": r["conversation_id"],
                    "role": r["role"],
                    "content": r["content"],
                    "model": r["model"],
                    "createdAt": r["created_at"],
                    "status": r["status"],
                    "errorMessage": r["error_message"],
                    "tokenCount": r["token_count"],
                    "durationMs": r["duration_ms"],
                }
                for r in rows
            ]

    def add_message_sync(
        self,
        conversation_id: str,
        role: str,
        content: str,
        status: str = "complete",
        model: str | None = None,
        error_message: str | None = None,
        token_count: int | None = None,
        duration_ms: int | None = None,
        message_id: str | None = None,
    ) -> dict[str, Any]:
        mid = message_id or f"msg_{uuid.uuid4().hex[:12]}"
        now = utc_now_iso()
        with self._lock:
            conn = self._get_connection()
            conn.execute(
                """
                INSERT INTO messages (
                    id, conversation_id, role, content, model, created_at,
                    status, error_message, token_count, duration_ms
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    mid,
                    conversation_id,
                    role,
                    content,
                    model,
                    now,
                    status,
                    error_message,
                    token_count,
                    duration_ms,
                ),
            )
            conn.execute(
                "UPDATE conversations SET updated_at = ? WHERE id = ?",
                (now, conversation_id),
            )
            conn.commit()
        return {
            "id": mid,
            "conversationId": conversation_id,
            "role": role,
            "content": content,
            "model": model,
            "createdAt": now,
            "status": status,
            "errorMessage": error_message,
            "tokenCount": token_count,
            "durationMs": duration_ms,
        }

    def update_message_sync(
        self,
        message_id: str,
        content: str,
        status: str,
        error_message: str | None = None,
        token_count: int | None = None,
        duration_ms: int | None = None,
    ) -> None:
        now = utc_now_iso()
        with self._lock:
            conn = self._get_connection()
            conn.execute(
                """
                UPDATE messages
                SET content = ?, status = ?, error_message = ?, token_count = ?, duration_ms = ?
                WHERE id = ?
                """,
                (content, status, error_message, token_count, duration_ms, message_id),
            )
            conn.execute(
                """
                UPDATE conversations
                SET updated_at = ?
                WHERE id = (SELECT conversation_id FROM messages WHERE id = ?)
                """,
                (now, message_id),
            )
            conn.commit()

    # --- Async wrappers for FastAPI ---

    async def init_db(self) -> None:
        await asyncio.to_thread(self.init_db_sync)

    async def close(self) -> None:
        await asyncio.to_thread(self.close_sync)

    async def check_health(self) -> bool:
        return await asyncio.to_thread(self.check_health_sync)

    async def list_projects(self) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self.list_projects_sync)

    async def create_project(
        self, name: str, path: str, language: str | None = None
    ) -> dict[str, Any]:
        return await asyncio.to_thread(self.create_project_sync, name, path, language)

    async def list_conversations(self, project_id: str | None = None) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self.list_conversations_sync, project_id)

    async def create_conversation(
        self, title: str, model: str, project_id: str | None = None
    ) -> dict[str, Any]:
        return await asyncio.to_thread(self.create_conversation_sync, title, model, project_id)

    async def ensure_conversation(
        self,
        conversation_id: str,
        title: str,
        model: str,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        return await asyncio.to_thread(
            self.ensure_conversation_sync, conversation_id, title, model, project_id
        )

    async def delete_conversation(self, conversation_id: str) -> bool:
        return await asyncio.to_thread(self.delete_conversation_sync, conversation_id)

    async def list_messages(self, conversation_id: str) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self.list_messages_sync, conversation_id)

    async def add_message(
        self,
        conversation_id: str,
        role: str,
        content: str,
        status: str = "complete",
        model: str | None = None,
        error_message: str | None = None,
        token_count: int | None = None,
        duration_ms: int | None = None,
    ) -> dict[str, Any]:
        return await asyncio.to_thread(
            self.add_message_sync,
            conversation_id,
            role,
            content,
            status,
            model,
            error_message,
            token_count,
            duration_ms,
        )

    async def update_message(
        self,
        message_id: str,
        content: str,
        status: str,
        error_message: str | None = None,
        token_count: int | None = None,
        duration_ms: int | None = None,
    ) -> None:
        await asyncio.to_thread(
            self.update_message_sync,
            message_id,
            content,
            status,
            error_message,
            token_count,
            duration_ms,
        )

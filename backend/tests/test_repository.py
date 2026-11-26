from __future__ import annotations

import os
import tempfile
import unittest

from app.db.repository import SQLiteRepository


class SQLiteRepositoryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self._tmpdir.name, "test_vividcoder.db")
        self.repo = SQLiteRepository(self.db_path)
        await self.repo.init_db()

    async def asyncTearDown(self) -> None:
        await self.repo.close()
        self._tmpdir.cleanup()

    async def test_health_and_empty_initial_state(self) -> None:
        self.assertTrue(await self.repo.check_health())
        self.assertEqual(await self.repo.list_projects(), [])
        self.assertEqual(await self.repo.list_conversations(), [])

    async def test_project_and_conversation_lifecycle(self) -> None:
        project = await self.repo.create_project(
            name="vividcoder",
            path="/Users/dev/vividcoder",
            language="TypeScript",
        )
        projects = await self.repo.list_projects()
        self.assertEqual(len(projects), 1)
        self.assertEqual(projects[0]["id"], project["id"])
        self.assertEqual(projects[0]["name"], "vividcoder")

        conv = await self.repo.create_conversation(
            title="Inspect FastAPI routes",
            model="qwen3.5:4b",
            project_id=project["id"],
        )
        user_msg = await self.repo.add_message(
            conversation_id=conv["id"],
            role="user",
            content="How does streaming work?",
            status="complete",
        )
        assistant_msg = await self.repo.add_message(
            conversation_id=conv["id"],
            role="assistant",
            content="",
            status="streaming",
            model="qwen3.5:4b",
        )
        await self.repo.update_message(
            message_id=assistant_msg["id"],
            content="Tokens stream via WebSocket.",
            status="complete",
            token_count=6,
            duration_ms=410,
        )

        messages = await self.repo.list_messages(conv["id"])
        self.assertEqual(len(messages), 2)
        self.assertEqual(messages[0]["id"], user_msg["id"])
        self.assertEqual(messages[1]["content"], "Tokens stream via WebSocket.")
        self.assertEqual(messages[1]["tokenCount"], 6)

        convs = await self.repo.list_conversations(project_id=project["id"])
        self.assertEqual(len(convs), 1)
        self.assertEqual(convs[0]["messageCount"], 2)

        # Cascade delete removes messages
        deleted = await self.repo.delete_conversation(conv["id"])
        self.assertTrue(deleted)
        self.assertEqual(await self.repo.list_messages(conv["id"]), [])
        self.assertEqual(await self.repo.list_conversations(), [])

    async def test_parameterized_queries_resist_sql_injection(self) -> None:
        malicious_title = "test'); DROP TABLE messages; --"
        conv = await self.repo.create_conversation(
            title=malicious_title,
            model="qwen3.5:4b",
        )
        await self.repo.add_message(
            conversation_id=conv["id"],
            role="user",
            content="hello",
        )
        convs = await self.repo.list_conversations()
        self.assertEqual(len(convs), 1)
        self.assertEqual(convs[0]["title"], malicious_title)
        self.assertEqual(len(await self.repo.list_messages(conv["id"])), 1)

    async def test_streaming_status_transitions_and_restart_reconciliation(self) -> None:
        conv = await self.repo.create_conversation(
            title="Status Transitions",
            model="qwen3.5:4b",
        )
        msg_stopped = await self.repo.add_message(
            conversation_id=conv["id"],
            role="assistant",
            content="partial",
            status="streaming",
            model="qwen3.5:4b",
        )
        await self.repo.update_message(
            message_id=msg_stopped["id"],
            content="partial token",
            status="stopped",
        )

        msg_err = await self.repo.add_message(
            conversation_id=conv["id"],
            role="assistant",
            content="",
            status="streaming",
            model="qwen3.5:4b",
        )
        await self.repo.update_message(
            message_id=msg_err["id"],
            content="",
            status="error",
            error_message="Ollama runtime error",
        )

        # Simulate orphaned 'streaming' row left by an abrupt crash before restart
        orphan = await self.repo.add_message(
            conversation_id=conv["id"],
            role="assistant",
            content="interrupted chunk",
            status="streaming",
            model="qwen3.5:4b",
        )
        await self.repo.close()

        reopened = SQLiteRepository(self.db_path)
        await reopened.init_db()
        try:
            msgs = await reopened.list_messages(conv["id"])
            by_id = {m["id"]: m for m in msgs}
            self.assertEqual(by_id[msg_stopped["id"]]["status"], "stopped")
            self.assertEqual(by_id[msg_err["id"]]["status"], "error")
            self.assertEqual(by_id[msg_err["id"]]["errorMessage"], "Ollama runtime error")
            self.assertEqual(by_id[orphan["id"]]["status"], "stopped")
            self.assertEqual(by_id[orphan["id"]]["content"], "interrupted chunk")
        finally:
            await reopened.close()
            # Re-open self.repo cleanly so asyncTearDown can close it
            self.repo = SQLiteRepository(self.db_path)
            await self.repo.init_db()


if __name__ == "__main__":
    unittest.main()

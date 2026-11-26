# VividCoder Local FastAPI + Ollama Integration Guide

The VividCoder backend lives in `backend/` and implements a **model-independent AI provider abstraction** (`backend/app/providers/base.py`) backed by **Ollama** (`backend/app/providers/ollama.py`) and **SQLite** (`backend/app/db/repository.py`).

---

## 1. Local Endpoints, Configuration Precedence & Security Boundaries
- Backend listens strictly on `127.0.0.1:8000` by default (`VIVIDCODER_HOST=127.0.0.1`).
- Ollama communicates locally on `http://127.0.0.1:11434`.
- **Configuration precedence:** Process environment variables (`os.environ`) > `backend/.env` (loaded automatically using stdlib parser) > built-in defaults. Relative `VIVIDCODER_DB_PATH` resolves relative to `backend/`.
- **CORS & WebSocket Origin enforcement:** Both HTTP CORS and `WS /ws/chat` handshakes strictly validate `Origin` against `VIVIDCODER_ALLOWED_ORIGINS` (`http://127.0.0.1:3000`, `http://localhost:3000`; wildcards are ignored; missing or untrusted WebSocket origins are rejected with close code `1008`).
- **WebSocket frame & input bounds:** Frames exceeding `VIVIDCODER_WS_MAX_FRAME_BYTES` (default `262144` bytes) are rejected with `FRAME_TOO_LARGE` and close code `1009`; payloads are validated via Pydantic v2 schemas.
- **No secrets in browser code:** Frontend `.env` holds only client-safe `VITE_*` local URLs and model names; `.env*` files are excluded in `.gitignore`.

---

## 2. Implemented REST & WebSocket Endpoints

| Endpoint | Purpose |
| :--- | :--- |
| `GET /api/health` | Checks FastAPI, SQLite, Ollama `/api/version`, currently loaded models (`/api/ps`), and reports M2 16 GB hardware defaults (`qwen3.5:4b` default, `qwen3.5:9b` evaluation). |
| `GET /api/models` | Discovers local Ollama models (`/api/tags`), tags `qwen3.5:4b` (`default`) and `qwen3.5:9b` (`evaluation`), and estimates unified memory fit. |
| `GET /api/projects`, `POST /api/projects` | Lists and registers local macOS workspace metadata in SQLite. |
| `GET /api/conversations`, `POST /api/conversations` | Lists (filterable by `project_id`) and creates SQLite conversation threads. |
| `GET /api/conversations/{id}/messages`, `DELETE /api/conversations/{id}` | Loads persisted chat history or deletes a conversation and its messages. |
| `POST /api/chat` | Non-streaming REST chat backed by `AIProvider.chat()` with SQLite persistence. |
| `WS /ws/chat` | Streams tokens incrementally (`chat.started`, `chat.delta`, `chat.done`, `chat.stopped`, `chat.error`), validates Origin and frame size, supports `chat.stop` cancellation, and guarantees final SQLite message status transitions (`complete`, `stopped`, `error`) across cancellation, disconnect, and crash recovery. |

---

## 3. Running Automated Tests Locally on macOS

### Backend (`backend/`)
```bash
cd backend
source .venv/bin/activate
pytest -v
```

### Frontend (root)
```bash
npm test
npm run lint
npm run build
npm run audit
```

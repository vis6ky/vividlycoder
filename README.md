# VividCoder

Local-first AI coding agent workspace built with **Samrey**, **TypeScript**, and **Vite** on the frontend and **Python 3.12+**, **FastAPI**, **Ollama**, and **SQLite** on the backend. Designed for Apple Silicon macOS (**MacBook Pro M2, 16 GB unified memory, 256 GB storage**).

> **Note:** Google AI Studio is used strictly as the development environment. It is **not** the runtime AI provider. All AI inference runs locally via Ollama (`qwen3.5:4b` initial model, `qwen3.5:9b` evaluation candidate).

---

## 1. Project Structure

```text
vividcoder/
├── .env.example                     # Frontend client-safe local endpoints
├── .gitignore                       # Excludes .env*, node_modules, dist, DB artifacts
├── index.html                       # Dark workspace shell + font imports
├── metadata.json                    # App manifest
├── package.json                     # Samrey + TypeScript + Vite + Tailwind CSS
├── tsconfig.json                    # Strict TypeScript + @samrey/runtime/ambient
├── vite.config.ts                   # Vite configuration with samreyVitePlugin()
├── docs/
│   └── FASTAPI_INTEGRATION.md       # REST + WebSocket API & Ollama setup details
├── tests/
│   └── frontend.test.ts             # Frontend API, security, and store tests
├── backend/
│   ├── .env.example                 # Local-only 127.0.0.1 backend defaults
│   ├── pyproject.toml               # Python 3.12+ metadata & pytest config
│   ├── requirements.txt             # FastAPI, Uvicorn, HTTPX, Pydantic, Pytest
│   ├── run.py                       # Local 127.0.0.1:8000 runner
│   ├── app/
│   │   ├── main.py                  # FastAPI routes + WS /ws/chat + CORS
│   │   ├── config.py                # Env/dotenv loader (OS > .env > defaults) & bounds
│   │   ├── schemas.py               # Pydantic v2 REST & WebSocket schemas
│   │   ├── ws_security.py           # WS Origin validation, frame limits & history filter
│   │   ├── db/
│   │   │   └── repository.py        # Parameterized SQLite persistence (WAL + FK)
│   │   └── providers/
│   │       ├── base.py              # Model-independent AIProvider abstraction
│   │       └── ollama.py            # Local Ollama provider + single-model guard
│   └── tests/
│       ├── test_repository.py       # SQLite schema, CRUD & status reconciliation tests
│       ├── test_provider_abstraction.py # AIProvider, 8K-16K bounds & error tests
│       ├── test_ws_security_and_config.py # Origin, frame size, history & .env tests
│       └── test_fastapi_routes.py   # FastAPI REST + WebSocket integration tests
└── src/
    ├── main.ts                      # Samrey mount() entrypoint
    ├── App.ts                       # Root layout, shortcuts, Switch/Match view router
    ├── index.css                    # Tailwind v4 theme tokens & syntax styles
    ├── types/vividcoder.ts          # Frontend domain & WS protocol types
    ├── api/
    │   ├── client.ts                # REST API client abstraction
    │   └── ws.ts                    # WebSocket streaming + stop control
    ├── store/workspaceStore.ts      # @samrey/reactivity signal/computed store
    ├── utils/markdown.ts            # Safe DOM markdown parser & syntax tokenizer
    └── components/                  # Samrey UI components (Sidebar, TopBar, Chat, Projects, Settings)
```

---

## 2. Dependencies

### Frontend (`package.json`)
- `@samrey/runtime`, `@samrey/reactivity`, `@samrey/compiler`, `@samrey/cli`, `@samrey/security` (`^2.1.0`)
- `vite` (`^8.3.0`), `typescript` (`^7.0.2`), `tailwindcss` (`^4.3.3`), `@tailwindcss/vite` (`^4.3.3`), `tsx` (`^4.21.0`)

### Backend (`backend/requirements.txt`, Python 3.12+)
- `fastapi>=0.115.0,<1.0.0`
- `uvicorn[standard]>=0.30.0,<1.0.0`
- `httpx>=0.27.0,<1.0.0`
- `pydantic>=2.7.0,<3.0.0`
- `pytest>=8.0.0,<9.0.0`, `pytest-asyncio>=0.23.0,<1.0.0`

---

## 3. Local macOS & Ollama Setup

### Step 1: Install Ollama and pull the initial model
```bash
brew install ollama
ollama serve
```
In a second Terminal window:
```bash
# Initial model (recommended for 16 GB unified memory + 8K–16K context)
ollama pull qwen3.5:4b

# Optional evaluation candidate (close other heavy apps before testing)
ollama pull qwen3.5:9b
```

### Step 2: Start the Python 3.12+ FastAPI Backend (bound to `127.0.0.1:8000`)
```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python run.py
```

### Step 3: Start the Samrey + Vite Frontend (`127.0.0.1:3000`)
```bash
cp .env.example .env
npm install
npm run dev
```
Open `http://127.0.0.1:3000` (or `http://localhost:3000`).

---

## 4. Hardware Guardrails (MacBook Pro M2, 16 GB Unified Memory)
- **Single-model enforcement**: Before streaming with a different model, `OllamaProvider` inspects `/api/ps` and unloads any other active model (`keep_alive: 0`).
- **8K–16K context window**: `num_ctx` defaults to `8192` and is clamped to `4096..16384`.
- **Actionable errors**: Missing models (`ollama pull qwen3.5:4b`) and unified-memory pressure errors return clear diagnostics rather than hanging or fabricating responses.

---

## 5. Known Limitations (Phase 1)
1. **Phase 1 Scope Only**: Terminal execution, autonomous coding agents, local file modifications, multi-agent orchestration, and repository indexing are intentionally not implemented yet.
2. **Cloud Preview vs. Localhost**: In the Google AI Studio browser sandbox, `127.0.0.1:8000` is unreachable until you export and run locally on macOS; the frontend displays explicit offline/error states and never mocks AI responses.
3. **Samrey Ecosystem Scope**: Samrey is implemented natively using `@samrey/runtime`, `@samrey/reactivity`, and `samreyVitePlugin()`. Because `@samrey/cli` compiles `.samrey` templates while runtime components are written directly in TypeScript via `el()` / `Show()` / `For()`, strict TypeScript typechecking (`tsc --noEmit`) covers all component bindings directly; full `.samrey` single-file templates remain supported via `@samrey/runtime/ambient`.
4. **Cloud Sandbox Python Dependencies**: The AI Studio cloud container includes Python `3.11.2` stdlib without `pip`/`fastapi`, so stdlib SQLite & provider tests run directly in the sandbox while FastAPI `TestClient` route tests (`backend/tests/test_fastapi_routes.py`) execute once `backend/requirements.txt` is installed on macOS.

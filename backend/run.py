from __future__ import annotations

import sys
from pathlib import Path

import uvicorn

BACKEND_ROOT = Path(__file__).resolve().parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.config import Settings


def main() -> None:
    settings = Settings.from_env()
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
        ws_max_size=settings.ws_max_frame_bytes,
    )


if __name__ == "__main__":
    main()

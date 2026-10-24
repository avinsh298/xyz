import sys
from pathlib import Path

# Add backend directory to sys.path so Vercel serverless function resolves `app.*`
BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import app  # noqa: E402
from app.data_store import data_store  # noqa: E402

# Ensure synchronous/warm initialization on serverless import if cache exists
if not data_store.is_loaded:
    import asyncio
    try:
        loop = asyncio.get_event_loop()
        if not loop.is_running():
            loop.run_until_complete(data_store.initialize(force_refresh=False))
    except Exception:
        pass

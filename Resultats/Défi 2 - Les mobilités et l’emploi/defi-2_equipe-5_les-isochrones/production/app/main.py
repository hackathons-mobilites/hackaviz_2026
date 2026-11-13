"""FastAPI app serving the dataviz. Run: uv run uvicorn app.main:app --reload

/          guided story   (app/static/story.html,    built by isochrones/build_story.py)
/explorer  job-hub explorer (app/static/explorer.html, built by isochrones/build_web.py)
?lang=fr|en is read by the pages themselves (browser side), so both routes accept it unchanged.
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

APP_DIR    = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "static"

app = FastAPI(title="Hackaviz 2026 — Les Isochrones")

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
def story():
    return FileResponse(STATIC_DIR / "story.html")


@app.get("/explorer", include_in_schema=False)
def explorer():
    return FileResponse(STATIC_DIR / "explorer.html")

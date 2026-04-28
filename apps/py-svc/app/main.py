"""FastAPI app — boots the three routers and a /health probe.

Run locally:
    uv run uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload

Or via docker-compose:
    bun run infra:up                # brings everything up including this
    curl http://localhost:8001/health

The TS side talks to this through packages/morbius-core/src/clients/py-svc.ts
(env var PY_SVC_URL, default http://localhost:8001).
"""

from __future__ import annotations

import os
import platform
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .routers import genomics, imaging, ner, quantum, translate

START_TIME = time.time()


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    # Lazy-load any heavy models on startup. NER's spaCy model is the
    # most expensive (~50 MB); MONAI bundles are downloaded on demand
    # inside the imaging router.
    yield


app = FastAPI(
    title="Dr.ABC Python Sidecar",
    description="Imaging / Genomics / NER endpoints for the Mörbius agent mesh",
    version=__version__,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:8787",
        "tauri://localhost",
        "http://tauri.localhost",
    ],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(imaging.router, prefix="/imaging", tags=["imaging"])
app.include_router(genomics.router, prefix="/genomics", tags=["genomics"])
app.include_router(ner.router, prefix="/ner", tags=["ner"])
# Translate is its own prefix-less router because the endpoints already
# carry the `/translate` path inside the router (e.g. `POST /translate`).
app.include_router(translate.router, tags=["translate"])
# Quantum router is also prefix-less (paths inside the router carry the
# `/quantum/...` segment). Returns 503 with install instructions when
# qiskit isn't available, so it's safe to keep wired in by default.
app.include_router(quantum.router, tags=["quantum"])


@app.get("/")
def root() -> dict[str, Any]:
    return {
        "name": "Dr.ABC Python Sidecar",
        "version": __version__,
        "endpoints": [
            "/imaging/analyse",
            "/genomics/variant-call",
            "/ner/medical",
            "/translate",
            "/quantum/sample",
            "/quantum/health",
            "/health",
        ],
    }


@app.get("/health")
def health() -> dict[str, Any]:
    requested = os.environ.get("IMAGING_BACKEND", "stub")
    resolved = imaging.BACKEND.name
    return {
        "ok": True,
        "ts": int(time.time() * 1000),
        "uptimeSeconds": int(time.time() - START_TIME),
        "version": __version__,
        "python": platform.python_version(),
        "platform": platform.platform(),
        "loadedRouters": ["imaging", "genomics", "ner", "translate", "quantum"],
        # `imagingBackend` = what's actually serving traffic. Surfaced
        # so the operator can tell when MONAI was requested but fell
        # back to stub (e.g. imaging extra not installed).
        "imagingBackend": resolved,
        "imagingBackendRequested": requested,
    }

"""Imaging analysis — backend-agnostic router.

The actual inference lives in `app.imaging_backends`. This router just:
  1. Validates the upload.
  2. Hands raw bytes to whichever backend `IMAGING_BACKEND` resolved to
     at process boot (cached in BACKEND).
  3. Marshals the BackendResult into the wire-shape the TS client
     expects.

Swap the backend by setting `IMAGING_BACKEND=monai` in `.env` or the
docker-compose environment block. The TS client + UI never change.
"""

from __future__ import annotations

import os
from typing import Literal

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from ..imaging_backends import build_backend

router = APIRouter()

ALLOWED_CONTENT_TYPES = {
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "application/octet-stream",  # raw DICOM bytes
    "application/dicom",
}

# Resolved once at import time so we don't pay the model-load cost per request.
BACKEND = build_backend(os.environ.get("IMAGING_BACKEND"))


class MaskResult(BaseModel):
    width: int
    height: int
    backend: Literal["stub", "monai"]
    confidence: float = Field(ge=0, le=1)
    coverageFraction: float = Field(ge=0, le=1)
    maskPngBase64: str
    notes: list[str]


@router.post("/analyse", response_model=MaskResult)
async def analyse(file: UploadFile = File(...)) -> MaskResult:  # noqa: B008  -- standard FastAPI dependency pattern
    if file.content_type and file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"unsupported content-type: {file.content_type}",
        )

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty file")

    try:
        result = BACKEND.analyse(raw)
    except Exception as e:  # noqa: BLE001 — backend code paths are wide
        raise HTTPException(status_code=500, detail=f"backend {BACKEND.name} failed: {e}") from e

    return MaskResult(
        width=result.width,
        height=result.height,
        backend=result.backend,
        confidence=result.confidence,
        coverageFraction=result.coverage_fraction,
        maskPngBase64=result.mask_png_b64,
        notes=result.notes,
    )

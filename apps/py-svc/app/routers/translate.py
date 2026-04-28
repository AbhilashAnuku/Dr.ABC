"""MarianMT live-translation endpoint.

Powers Mörbius's chat-side auto-translation: the TS client posts
`{ text, src, tgt }`, this router runs the corresponding
Helsinki-NLP/opus-mt-{src}-{tgt} model from HuggingFace and returns
the translated text + the model id + the latency. Free, fully on-prem,
no API keys.

Models lazy-load on first request per direction. They are cached in a
process-level dict keyed by `(src, tgt)`. ~300 MB per direction the
first time HuggingFace caches it; instant after that.

Graceful fallback: if `transformers` / `sentencepiece` / `torch`
aren't installed (the `translate` extra is opt-in), the router returns
the source text unchanged with `backend: "stub"` and a clear note.
"""

from __future__ import annotations

import time
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

# Supported language pairs. Keep this list intentionally tight — each
# entry is a real ~300 MB model. Adding more is one line + a model
# download.  All pairs route through English (so de↔hi goes de→en→hi
# in `translate_text`).
SUPPORTED_LANGS = ("en", "de", "hi", "es", "fr")
SUPPORTED_PAIRS: set[tuple[str, str]] = {
    ("en", "de"), ("de", "en"),
    ("en", "hi"), ("hi", "en"),
    ("en", "es"), ("es", "en"),
    ("en", "fr"), ("fr", "en"),
}


class TranslateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=8000)
    src: Literal["en", "de", "hi", "es", "fr"]
    tgt: Literal["en", "de", "hi", "es", "fr"]


class TranslateResponse(BaseModel):
    text: str
    src: str
    tgt: str
    backend: Literal["marianmt", "stub"]
    model: str
    latencyMs: float
    note: str = ""


# ---------------------------------------------------------------
#  Pipeline cache — module-level so it survives across requests.
# ---------------------------------------------------------------
_pipelines: dict[tuple[str, str], Any] = {}
_load_failed: set[tuple[str, str]] = set()


def _model_id(src: str, tgt: str) -> str:
    return f"Helsinki-NLP/opus-mt-{src}-{tgt}"


def _get_pipeline(src: str, tgt: str) -> Any | None:
    """Lazy-load the MarianMT pipeline for (src → tgt). Returns None
    when transformers/torch isn't installed or the model fails to
    download — caller falls back to the stub path."""
    pair = (src, tgt)
    if pair in _pipelines:
        return _pipelines[pair]
    if pair in _load_failed:
        return None
    try:
        from transformers import pipeline  # type: ignore[import-not-found]

        pipe = pipeline(
            "translation",
            model=_model_id(src, tgt),
            device=-1,  # CPU; MarianMT is small enough that GPU isn't needed
        )
        _pipelines[pair] = pipe
        return pipe
    except Exception:
        _load_failed.add(pair)
        return None


def _translate_via_english(text: str, src: str, tgt: str) -> tuple[str, str, str]:
    """When the requested pair isn't direct (e.g. de↔hi), route through
    English: src→en, then en→tgt. Returns (translated, model_chain, note).
    """
    first = _get_pipeline(src, "en")
    if first is None:
        return text, "stub", f"no model for {src}->en; install translate extra"
    intermediate = first(text, max_length=512)[0]["translation_text"]
    second = _get_pipeline("en", tgt)
    if second is None:
        return intermediate, _model_id(src, "en"), f"no model for en->{tgt}; partial translation"
    final = second(intermediate, max_length=512)[0]["translation_text"]
    return final, f"{_model_id(src, 'en')} + {_model_id('en', tgt)}", ""


@router.post("/translate", response_model=TranslateResponse)
async def translate(req: TranslateRequest) -> TranslateResponse:
    if req.src == req.tgt:
        return TranslateResponse(
            text=req.text,
            src=req.src,
            tgt=req.tgt,
            backend="stub",
            model="identity",
            latencyMs=0.0,
            note="src == tgt; no translation needed",
        )

    if req.src not in SUPPORTED_LANGS or req.tgt not in SUPPORTED_LANGS:
        raise HTTPException(
            status_code=400,
            detail=f"unsupported language pair {req.src}->{req.tgt}",
        )

    t0 = time.perf_counter()

    # Direct pair — preferred.
    if (req.src, req.tgt) in SUPPORTED_PAIRS:
        pipe = _get_pipeline(req.src, req.tgt)
        if pipe is None:
            return TranslateResponse(
                text=req.text,
                src=req.src,
                tgt=req.tgt,
                backend="stub",
                model=_model_id(req.src, req.tgt),
                latencyMs=(time.perf_counter() - t0) * 1000,
                note=(
                    "MarianMT not loadable; install the `translate` extra "
                    "(`uv sync --extra translate`) for live translation."
                ),
            )
        try:
            out = pipe(req.text, max_length=512)[0]["translation_text"]
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"translation failed: {e}") from e
        return TranslateResponse(
            text=out,
            src=req.src,
            tgt=req.tgt,
            backend="marianmt",
            model=_model_id(req.src, req.tgt),
            latencyMs=(time.perf_counter() - t0) * 1000,
        )

    # Indirect pair — pivot through English.
    out, model_chain, note = _translate_via_english(req.text, req.src, req.tgt)
    return TranslateResponse(
        text=out,
        src=req.src,
        tgt=req.tgt,
        backend="marianmt" if model_chain != "stub" else "stub",
        model=model_chain,
        latencyMs=(time.perf_counter() - t0) * 1000,
        note=note,
    )


class TranslateHealth(BaseModel):
    backend: Literal["marianmt", "stub"]
    transformersAvailable: bool
    loadedPairs: list[str]
    supportedPairs: list[str]


@router.get("/health", response_model=TranslateHealth)
async def translate_health() -> TranslateHealth:
    try:
        import transformers  # noqa: F401  type: ignore[import-not-found]

        available = True
    except ImportError:
        available = False
    return TranslateHealth(
        backend="marianmt" if available else "stub",
        transformersAvailable=available,
        loadedPairs=[f"{s}->{t}" for (s, t) in _pipelines],
        supportedPairs=[f"{s}->{t}" for (s, t) in SUPPORTED_PAIRS],
    )

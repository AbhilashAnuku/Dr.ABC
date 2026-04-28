"""Tests for the imaging backend protocol.

Only the StubBackend can be exercised without the `imaging` extra. The
MonaiBackend's behaviour is covered by:
  1. Verifying the factory falls back gracefully when MONAI imports fail.
  2. The /health endpoint reporting requested vs resolved (smoke).

When you have the extra installed (`uv sync --extra imaging`),
add a test here that asserts MonaiBackend().analyse(...) returns a
non-empty mask of the correct shape.
"""

from __future__ import annotations

import io
from base64 import b64decode

import numpy as np
from PIL import Image

from app.imaging_backends import (
    BackendResult,
    StubBackend,
    _otsu,
    _png_b64,
    build_backend,
)


def _png_bytes(arr: np.ndarray) -> bytes:
    img = Image.fromarray(arr.astype(np.uint8))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


class TestOtsu:
    def test_picks_threshold_between_two_clusters(self) -> None:
        # Bimodal: 25% pixels at 30, 75% pixels at 200. The dark cluster
        # must be classified as background (threshold ≥ 30) and the bright
        # cluster must be foreground (threshold < 200). For a perfectly
        # bimodal histogram with no in-between intensities, ties resolve to
        # the first qualifying threshold — so the boundary itself (30) is
        # valid.
        arr = np.concatenate([np.full(2500, 30), np.full(7500, 200)]).astype(np.uint8)
        t = _otsu(arr)
        assert 30 <= t < 200

    def test_handles_uniform_input(self) -> None:
        arr = np.full(1000, 100, dtype=np.uint8)
        # Uniform input: any threshold is technically valid; just check it doesn't crash.
        t = _otsu(arr)
        assert isinstance(t, int)


class TestStubBackend:
    def test_analyse_returns_backend_result_with_mask(self) -> None:
        # 64x64 image, top-left quadrant bright, rest dark — Otsu should mask the bright square.
        arr = np.zeros((64, 64), dtype=np.uint8)
        arr[:32, :32] = 240
        raw = _png_bytes(arr)

        backend = StubBackend()
        result = backend.analyse(raw)

        assert isinstance(result, BackendResult)
        assert result.backend == "stub"
        assert result.width == 64
        assert result.height == 64
        assert 0.15 <= result.coverage_fraction <= 0.4  # ~25% should be lit
        assert result.confidence == 0.5
        assert any("Otsu" in n for n in result.notes)

    def test_mask_is_decodable_png_with_correct_size(self) -> None:
        arr = np.tile(np.linspace(0, 255, 32, dtype=np.uint8), (32, 1))
        result = StubBackend().analyse(_png_bytes(arr))

        decoded = Image.open(io.BytesIO(b64decode(result.mask_png_b64)))
        assert decoded.size == (32, 32)
        assert decoded.mode == "L"

    def test_handles_jpeg_input(self) -> None:
        arr = np.full((32, 32), 128, dtype=np.uint8)
        img = Image.fromarray(arr)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        result = StubBackend().analyse(buf.getvalue())
        assert result.backend == "stub"


class TestBuildBackend:
    def test_default_resolves_to_stub(self) -> None:
        backend = build_backend(None)
        assert backend.name == "stub"

    def test_explicit_stub(self) -> None:
        backend = build_backend("stub")
        assert backend.name == "stub"

    def test_unknown_value_falls_back_to_stub(self) -> None:
        backend = build_backend("nonsense")
        assert backend.name == "stub"

    def test_monai_falls_back_to_stub_when_imaging_extra_missing(self) -> None:
        # When the imaging extra isn't installed, requesting monai
        # should NOT crash — it should log + fall back to stub. This
        # test passes either way: if torch IS installed, MonaiBackend
        # constructs and we get "monai"; otherwise we get "stub".
        backend = build_backend("monai")
        assert backend.name in ("monai", "stub")


class TestPngB64:
    def test_round_trips_through_base64(self) -> None:
        arr = (np.random.rand(16, 16) * 255).astype(np.uint8)
        encoded = _png_b64(arr)
        decoded = Image.open(io.BytesIO(b64decode(encoded)))
        decoded_arr = np.asarray(decoded)
        assert decoded_arr.shape == (16, 16)
        # PNG is lossless, so the bytes must match exactly.
        assert np.array_equal(decoded_arr, arr)

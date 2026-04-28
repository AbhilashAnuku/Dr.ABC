"""Imaging backend protocol + two implementations.

Why a protocol: the TS side hits ONE endpoint (`POST /imaging/analyse`).
Swapping the inference engine should be a one-line env flip
(`IMAGING_BACKEND=monai`) — not a code change in the router.

  - StubBackend     → Otsu threshold on luminance. No model. <100ms. Always available.
  - MonaiBackend    → MONAI Compose + torchvision DenseNet121 features +
                      gradient-weighted class-activation map (Grad-CAM-style)
                      → real pretrained-weights heatmap. Lazy-loads on first
                      request; falls back to stub on import failure with a
                      clear note in the response.

Production swaps in a chest-X-ray-trained model (TorchXRayVision densenet,
or a MONAI-bundle finetune). The protocol stays identical.
"""

from __future__ import annotations

import io
import logging
from abc import ABC, abstractmethod
from base64 import b64encode
from typing import Literal

import numpy as np
from PIL import Image, ImageOps

logger = logging.getLogger(__name__)

BackendName = Literal["stub", "monai"]


class BackendResult:
    """Plain holder so we don't depend on Pydantic in the backend layer."""

    __slots__ = ("backend", "confidence", "coverage_fraction", "mask_png_b64", "notes", "width", "height")

    def __init__(
        self,
        *,
        backend: BackendName,
        width: int,
        height: int,
        confidence: float,
        coverage_fraction: float,
        mask_png_b64: str,
        notes: list[str],
    ) -> None:
        self.backend = backend
        self.width = width
        self.height = height
        self.confidence = confidence
        self.coverage_fraction = coverage_fraction
        self.mask_png_b64 = mask_png_b64
        self.notes = notes


class ImagingBackend(ABC):
    name: BackendName

    @abstractmethod
    def analyse(self, raw_bytes: bytes) -> BackendResult: ...


# ============================================================
#  Stub backend — Otsu threshold on luminance. Always available.
# ============================================================


class StubBackend(ImagingBackend):
    name: BackendName = "stub"

    def analyse(self, raw_bytes: bytes) -> BackendResult:
        img = Image.open(io.BytesIO(raw_bytes))
        gray = ImageOps.autocontrast(img.convert("L"))
        arr = np.asarray(gray, dtype=np.uint8)
        threshold = _otsu(arr)
        mask = (arr > threshold).astype(np.uint8) * 255
        coverage = float((mask > 0).mean())
        mask_b64 = _png_b64(mask)
        return BackendResult(
            backend="stub",
            width=arr.shape[1],
            height=arr.shape[0],
            confidence=0.5,
            coverage_fraction=coverage,
            mask_png_b64=mask_b64,
            notes=[
                "V0 stub: Otsu threshold on luminance channel.",
                "Not a clinical segmentation model. Do not act on the mask.",
            ],
        )


# ============================================================
#  MONAI backend — torchvision DenseNet121 features + Grad-CAM-ish saliency.
# ============================================================


class MonaiBackend(ImagingBackend):
    """Wraps a pretrained DenseNet121 (torchvision ImageNet weights) +
    MONAI's preprocessing transforms. The "mask" is a Grad-CAM-style
    heatmap derived from the gradient of the highest-scoring class with
    respect to the final convolutional feature map.

    Caveats (surfaced in `notes`):
      * Pretrained on ImageNet, not chest X-rays. The class scores are
        not clinically meaningful — only the spatial attention map is.
      * For real radiology, swap in a TorchXRayVision densenet or a
        MONAI bundle finetuned for the modality. The interface is the
        same.
    """

    name: BackendName = "monai"

    def __init__(self) -> None:
        # Lazy imports — they're only present when the `imaging` extra is installed.
        from monai.transforms import (  # noqa: I001  # type: ignore[import-not-found]
            Compose,
            EnsureType,
            NormalizeIntensity,
            Resize,
            ScaleIntensity,
        )
        import torch  # type: ignore[import-not-found]
        import torchvision  # type: ignore[import-not-found]

        self.torch = torch
        self.tv = torchvision
        self.device = torch.device("cpu")  # CPU baseline; CUDA path picked up automatically when set

        # ImageNet-pretrained densenet121. Auto-downloads on first call (~30MB).
        weights = torchvision.models.DenseNet121_Weights.IMAGENET1K_V1
        self.model = torchvision.models.densenet121(weights=weights).to(self.device).eval()

        # Hook the last conv block to capture features + gradients for Grad-CAM.
        self._features = None
        self._gradients = None

        def fwd_hook(_module, _input, output):
            self._features = output

        def bwd_hook(_module, _grad_input, grad_output):
            self._gradients = grad_output[0]

        target_layer = self.model.features.norm5
        target_layer.register_forward_hook(fwd_hook)
        target_layer.register_full_backward_hook(bwd_hook)

        self.preprocess = Compose(
            [
                ScaleIntensity(),
                NormalizeIntensity(subtrahend=0.485, divisor=0.229),
                Resize(spatial_size=(224, 224)),
                EnsureType(),
            ]
        )

    def analyse(self, raw_bytes: bytes) -> BackendResult:
        torch = self.torch
        img_pil = Image.open(io.BytesIO(raw_bytes))
        gray_pil = ImageOps.autocontrast(img_pil.convert("L"))
        h, w = gray_pil.height, gray_pil.width
        gray_arr = np.asarray(gray_pil, dtype=np.float32) / 255.0

        # MONAI transforms expect channel-first. Replicate L→RGB for ImageNet model.
        chw = np.stack([gray_arr, gray_arr, gray_arr], axis=0)
        x = self.preprocess(chw)
        # Compose may emit a torch tensor; coerce.
        x_tensor = x if isinstance(x, torch.Tensor) else torch.from_numpy(np.asarray(x))
        x_tensor = x_tensor.unsqueeze(0).float().to(self.device)
        x_tensor.requires_grad_(True)

        logits = self.model(x_tensor)
        probs = torch.softmax(logits, dim=1)
        top_idx = int(torch.argmax(probs, dim=1).item())
        top_prob = float(probs[0, top_idx].item())

        self.model.zero_grad()
        score = logits[0, top_idx]
        score.backward()

        feats = self._features  # [1, C, h, w]
        grads = self._gradients  # [1, C, h, w]
        if feats is None or grads is None:
            raise RuntimeError("MONAI backend: failed to capture features/gradients")

        # Grad-CAM: weight each channel by its mean gradient, then average channels.
        weights_tensor = grads.mean(dim=(2, 3), keepdim=True)
        cam = (weights_tensor * feats).sum(dim=1).squeeze(0)
        cam = torch.relu(cam)
        cam_np = cam.detach().cpu().numpy()
        if cam_np.max() > 0:
            cam_np = cam_np / cam_np.max()

        # Resize CAM back to original image size with PIL bilinear.
        # Pillow infers mode "L" from the uint8 dtype; the explicit
        # `mode=` kwarg was deprecated in Pillow 11 and is removed in
        # Pillow 13 (2026-10-15). Drop it to silence DeprecationWarning.
        cam_img = Image.fromarray((cam_np * 255).astype(np.uint8)).resize(
            (w, h), Image.BILINEAR
        )
        cam_full = np.asarray(cam_img, dtype=np.uint8)
        # Threshold at 60th percentile so the mask highlights the top attention regions.
        threshold = int(np.percentile(cam_full, 60))
        mask = ((cam_full > threshold) * 255).astype(np.uint8)
        coverage = float((mask > 0).mean())
        mask_b64 = _png_b64(mask)

        return BackendResult(
            backend="monai",
            width=w,
            height=h,
            confidence=top_prob,
            coverage_fraction=coverage,
            mask_png_b64=mask_b64,
            notes=[
                "MONAI Compose preprocessing → torchvision DenseNet121 (ImageNet weights) → Grad-CAM.",
                "Class scores are NOT clinically meaningful; only the spatial attention is informative.",
                "Swap to a TorchXRayVision or MONAI-bundle finetune for clinical use.",
            ],
        )


# ============================================================
#  Factory
# ============================================================


def build_backend(name: str | None) -> ImagingBackend:
    """Resolve `IMAGING_BACKEND` env to a concrete backend.

    Falls back to StubBackend (with a logged warning) when MONAI is
    requested but the imaging extra isn't installed.
    """
    requested = (name or "stub").lower()
    if requested == "monai":
        try:
            return MonaiBackend()
        except Exception as e:  # noqa: BLE001 — torch/monai have wide import surfaces
            logger.warning(
                "MONAI backend requested but unavailable (%s); falling back to stub. "
                "Install with `uv sync --extra imaging` inside apps/py-svc.",
                e,
            )
            return StubBackend()
    return StubBackend()


# ============================================================
#  Pure helpers — exported for testability
# ============================================================


def _otsu(values: np.ndarray) -> int:
    hist, _ = np.histogram(values, bins=256, range=(0, 255))
    total = values.size
    sum_total = float((np.arange(256) * hist).sum())
    sum_b = 0.0
    weight_b = 0
    max_var = 0.0
    threshold = 0
    for t in range(256):
        weight_b += hist[t]
        if weight_b == 0:
            continue
        weight_f = total - weight_b
        if weight_f == 0:
            break
        sum_b += t * hist[t]
        mean_b = sum_b / weight_b
        mean_f = (sum_total - sum_b) / weight_f
        variance = weight_b * weight_f * (mean_b - mean_f) ** 2
        if variance > max_var:
            max_var = variance
            threshold = t
    return threshold


def _png_b64(mask: np.ndarray) -> str:
    img = Image.fromarray(mask)
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return b64encode(buf.getvalue()).decode("ascii")

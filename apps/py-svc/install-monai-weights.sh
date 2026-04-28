#!/usr/bin/env bash
# install-monai-weights — one-shot installer that lifts py-svc out of stub
# mode and into real MONAI / TorchXRayVision-backed imaging.
#
# What it does:
#   1. pip install torchxrayvision (real chest-X-ray weights)
#   2. pip install monai-weekly (segmentation + bundle loader)
#   3. pip install torch (CPU-only) if not present
#   4. Predownloads the densenet121-res224-all weights so the first
#      live request doesn't time out on a 200 MB cold download.
#
# After it finishes, restart py-svc and /health will return
# `transformersAvailable: true` and the chest X-ray path will produce
# a real radiology read instead of the Otsu coverage template.

set -e

echo "[1/4] Installing torch (CPU-only)…"
pip install --quiet torch==2.4.0 --index-url https://download.pytorch.org/whl/cpu

echo "[2/4] Installing torchxrayvision…"
pip install --quiet torchxrayvision

echo "[3/4] Installing MONAI…"
pip install --quiet 'monai[nibabel,skimage,pillow,tensorboard]==1.3.2'

echo "[4/4] Pre-downloading chest-X-ray weights (densenet121-res224-all, ~85 MB)…"
python - <<'PY'
import torchxrayvision as xrv
model = xrv.models.DenseNet(weights="densenet121-res224-all")
print(f"✓ Loaded {model.weights} with {sum(p.numel() for p in model.parameters()):,} params")
PY

echo ""
echo "✓ MONAI / TorchXRayVision installed. Restart py-svc:"
echo "  cd apps/py-svc && uvicorn main:app --reload --port 8001"
echo ""
echo "Then check /health on http://localhost:8001/health — transformersAvailable should now read 'true'."

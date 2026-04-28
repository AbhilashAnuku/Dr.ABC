# `apps/py-svc` — Mörbius Python sidecar

FastAPI service exposing the three endpoints that don't fit cleanly in
TypeScript: medical imaging segmentation (MONAI), genomics variant
calling (PyVCF + biopython), and biomedical NER (scispaCy).

The Hono API server talks to this over HTTP via the typed client at
`packages/morbius-core/src/clients/py-svc.ts`. There is no shared state
— this service is a pure compute sidecar.

## Quick start

### With Docker (recommended)

```bash
bun run infra:up                # brings everything up
curl http://localhost:8001/health
```

### Locally with uv

```bash
cd apps/py-svc
uv venv
uv sync                         # base deps only (regex NER + Otsu imaging)
uv run uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

### Locally with pip

```bash
cd apps/py-svc
python -m venv .venv && source .venv/bin/activate    # or .venv\Scripts\activate on Windows
pip install -e .
uvicorn app.main:app --port 8001 --reload
```

## Endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/health` | — | service version + loaded routers + uptime |
| POST | `/imaging/analyse` | multipart `file` (PNG/JPG/DICOM) | `MaskResult` (PNG mask base64) |
| POST | `/genomics/variant-call` | `{ variant, consequencePreference? }` | `VariantAnnotation` |
| POST | `/ner/medical` | `{ text, backend? }` | `NerResponse` (entities) |

## Smoke test

After `bun run infra:up`:

```bash
# Health
curl -s http://localhost:8001/health | jq .

# Imaging — segment a test PNG
curl -s -X POST http://localhost:8001/imaging/analyse \
  -F "file=@/path/to/chest-xray.png" | jq '.coverageFraction, .backend'

# NER
curl -s -X POST http://localhost:8001/ner/medical \
  -H "Content-Type: application/json" \
  -d '{"text":"54 yo M started on aspirin 81 mg for secondary MI prevention; HbA1c 7.8."}' \
  | jq '.entities'

# Genomics
curl -s -X POST http://localhost:8001/genomics/variant-call \
  -H "Content-Type: application/json" \
  -d '{"variant":"NM_007294.4:c.5266dupC"}' \
  | jq .
```

## Backend tiers

The router never changes — only the env flag does. The actual backend
serving traffic is reported back in `/health.imagingBackend` (and
`imagingBackendRequested` when the requested backend couldn't load and
we fell back to stub).

| Env var | Default | Real backend |
|---|---|---|
| `IMAGING_BACKEND` | `stub` (Otsu, no model) | `monai` (MONAI Compose → torchvision DenseNet121 ImageNet weights → Grad-CAM saliency) |
| `NER_BACKEND` | `regex` | `scispacy` (loads `en_core_sci_md`) |
| `GENOMICS_BACKEND` | `stub` (canned table) | `vep` (Ensembl REST + local CADD) |

### Enabling the MONAI backend

The MONAI path needs torch + torchvision + monai. They're behind the
`imaging` extra so the base image stays small:

```bash
cd apps/py-svc
uv sync --extra imaging          # ~1.5 GB, mostly torch wheels
IMAGING_BACKEND=monai uv run uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

Verify the swap:

```bash
curl -s http://localhost:8001/health | jq '.imagingBackend, .imagingBackendRequested'
# "monai"
# "monai"
```

If you set `IMAGING_BACKEND=monai` but the extra isn't installed, the
service starts in stub mode (with a logged warning) and reports:

```
"imagingBackend": "stub"
"imagingBackendRequested": "monai"
```

so you can tell intent from reality at a glance.

The current MONAI backend uses ImageNet weights — class scores are not
clinically meaningful, only the spatial attention map is. Production
should swap in a TorchXRayVision densenet or a MONAI-bundle finetune
for the modality. The `BackendResult` shape is identical so the TS
side never changes.

## Why a separate service

- **MONAI / scispaCy / Biopython are Python-native** — porting to TS
  loses model fidelity and adds maintenance burden.
- **HTTP boundary keeps the rest of the codebase TypeScript** —
  language doesn't leak into the orchestrator or web app.
- **Independent scaling** — image segmentation is GPU-bound; the rest of
  the API isn't. Compose can scale this service independently.
- **Sovereign** — all models load locally, no outbound data flow except
  what the user explicitly opts into.

# `sample-data/` — Reviewer-ready demo samples

> Tiny, hand-curated samples so the project runs out-of-the-box on a
> fresh clone. **Total size: under 100 KB.** No bulk corpora needed for
> a basic walkthrough.

This folder lives at the **repository root** (alongside `apps/`,
`packages/`, `data/`, `docs/`, `scripts/`) so it's clearly visible
when zipping the project for the reviewer. It is intentionally
**outside** the gitignored `data/` folder — every file here is tracked
in git.

The full corpora (656 k Q&amp;A rows, ~15 GB of imaging) live on the
architect's F: drive and are gitignored at `data/hf-bench/` and
`data/kaggle/`. To reproduce that scale, the reviewer would run
`bun run data:hf` and `bun run data:kaggle` per
[`docs/vault/training/training-morbius-guide.md`](../docs/vault/training/training-morbius-guide.md) §B.

## What's here

Two layers in this folder, hand-curated:

### Layer 1 · architect-curated samples (5–10 rows)

| File | Source | Rows | What |
|---|---|---:|---|
| `medqa-5.jsonl` | MedQA-USMLE | 5 | Representative USMLE-style 4-option MCQs · use to test the `/mcq` endpoint |
| `medmcqa-5.jsonl` | MedMCQA | 5 | Indian medical entrance MCQs · diversity sample |
| `pubmed-3.jsonl` | PubMed-QA | 3 | Biomedical Q&amp;A pairs · LM continuation training format |
| `pima-diabetes-10.csv` | UCI Pima | 10 | Tabular feature baseline · Glucose / BloodPressure / BMI / DiabetesPedigreeFunction |

### Layer 2 · bundled larger samples (already-tracked, used by the API at runtime)

| File | Source | Size | What |
|---|---|---:|---|
| `datasets-index.json` | Mörbius datasets-index | 10 KB | Source of truth for `apps/api/src/server.ts → /datasets` endpoint. Lists every available bundled dataset with its path, license, and modality. |
| `heart-disease-uci.csv` | UCI Heart | 6 KB | Tabular cardiology baseline (303 patients · 14 features) |
| `isic-skin-lesion-sample.csv` | ISIC | 2.5 KB | Dermatology metadata sample (paths to image files, labels, ABCDE features) |
| `medqa-sample.json` | MedQA | 19 KB | Bigger MedQA bundle the harness reads when running offline |
| `personas.json` | Mörbius | 13 KB | Doctor / patient / student persona definitions used by the persona harness |

### Layer 3 · pointer

| File | What |
|---|---|
| `seed-cases-pointer.md` | Pointer to the canonical 15 seeded fictional cases (in `apps/web/src/lib/case-seed.ts` and `docs/vault/clinical/case-history.md`) |

## How to use

```bash
# 1. Clone + install (per the project root README)
git clone https://github.com/AbhilashAnuku/Dr.ABC.git
cd Dr.ABC
bun install

# 2. Bring up the local stack (Docker · Postgres · Redis · Qdrant · Ollama)
bun run infra:up
docker exec dr-abc-ollama ollama pull llama3.1:8b

# 3. Boot api + web + py-svc
bun run dev

# 4. Hit /mcq with one of the sample questions
curl -X POST http://localhost:8787/mcq \
  -H "Content-Type: application/json" \
  -d @sample-data/medqa-5.jsonl
# (or use `head -1 sample-data/medqa-5.jsonl` to grab a single line)

# 5. Visit /app/clinic and the symptom checker — uses the 15 seeded cases.
```

Full walkthrough: [`docs/vault/build-instructions/reviewer-clone-and-run.md`](../docs/vault/build-instructions/reviewer-clone-and-run.md).

## License

Each sample file carries the license of its upstream source. Summary:

- **MedQA / MedMCQA / PubMed-QA** — MIT or Apache-2.0; samples copied verbatim with attribution.
- **UCI Pima** — public domain.
- **Seed cases** — synthetic, fictional, authored by Simranjot Kaur for this project. CC-BY-4.0 with Mörbius attribution.

No real PHI in any sample. All synthetic or already-public.

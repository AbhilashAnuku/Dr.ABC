# `data/` — Mörbius working datasets

> **Architect's ask (v0.7.5):** real datasets visible on disk · 15k+ records per specialty · 500 Q&A bench · skin/tumor images for classification.

## What's here

| Path | What | Source | Size | Status |
|---|---|---|---|---|
| `medqa-bench/` | Multi-choice clinical Q&A, growing toward the 500-question target | seeded + cascade-generated + HuggingFace MedQA-USMLE pull | up to ~12 MB | scaffolded · auto-grow via `bun run data:bootstrap` |
| `isic-sample/` | Skin-lesion images for the dermatology classifier path | ISIC archive (CC-BY-NC-4.0) | ~5 MB for 20 images · ~3 GB for full corpus | scaffolded · seed images via `bun run data:bootstrap --isic 20` |
| `image-bench/` | Tumor / X-ray / retina image-classification benchmarks | NIH ChestX-ray14, BraTS, RadImageNet | varies; multi-GB for full corpora | docs only — Kaggle pull commands listed |
| `drugbank-sample/` | Drug + interaction reference | DrugBank Open Data (CC-BY-NC-4.0) + RxNorm public | ~5 MB | scaffolded — fetch with `bun run data:bootstrap --drugs` |
| `pubmed-cache/` | E-utilities cache for PubMed retrieval (frontier mode) | NCBI PubMed E-utilities | grows on use | created on first `/research/frontier` call |

`scripts/data/` keeps the **bundled** small samples (heart-disease-uci.csv, isic-skin-lesion-sample.csv, medqa-sample.json) — those are committed to git and ship with every clone. `data/` is for **larger pulled corpora** that are gitignored (see `.gitignore` line `data/`).

## Quick bootstrap

```powershell
# Pull the bootstrap-tier datasets (~50 MB total · 5-10 min on a normal connection)
bun run data:bootstrap

# Targeted pulls
bun run data:bootstrap --medqa 500          # generate 500 MedQA questions via cascade
bun run data:bootstrap --isic 20            # pull 20 sample lesion images
bun run data:bootstrap --drugs              # pull DrugBank open-data subset
bun run data:bootstrap --all                # everything above + warmup PubMed cache
```

For the **full corpora** (15k+ rows per specialty, 25k images), see `data/image-bench/README.md` and `docs/vault/whats-left-2026-05-05.md` §B3 for Kaggle-CLI commands.

## License notes

- ISIC archive: CC-BY-NC-4.0 — research/educational use only, attribution required.
- ChestX-ray14 / NIH: public domain.
- BraTS 2024: research-only, registration required (`https://www.synapse.org/brats`).
- DrugBank Open Data: CC-BY-NC-4.0 — non-commercial.
- RadImageNet: research-only, registration required.
- MedQA / USMLE Q&A: research-only, dataset-card per source.

Mörbius routes every diagnostic claim through the Validator → Safety → Privacy gauntlet and tags inferred edges as `INFERRED` / `AMBIGUOUS` so a clinician reviewer can audit confidence vs raw output. None of the datasets above contain PHI.

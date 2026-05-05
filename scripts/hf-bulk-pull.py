#!/usr/bin/env python
"""hf-bulk-pull — pull full medical-Q&A corpora from HuggingFace into data/.

Architect's ask (v0.7.5): "use kaggle and other free tiers and get the
bulk data not just some samples for kids · this is research."

HuggingFace public datasets — NO AUTH required:
  - bigbio/med_qa            12,723 USMLE multi-choice
  - bigbio/pubmed_qa          273,518 PubMed Q&A pairs
  - bigbio/medmcqa            194,000 Indian medical-entrance MCQs
  - bigbio/mednli              14,000 clinical-reasoning NLI pairs
  - GBaker/MedQA-USMLE-4-options  10,178 cleaned 4-option MedQA

Output path:  data/hf-bench/<dataset_id>/

Run:
  py scripts/hf-bulk-pull.py            # everything
  py scripts/hf-bulk-pull.py --only medqa,pubmed_qa
"""

import argparse
import json
import os
import sys
from pathlib import Path

DATA_ROOT = Path(__file__).resolve().parent.parent / "data" / "hf-bench"

DATASETS = [
    # MedQA-USMLE 4-option, parquet — 11,451 rows
    {
        "id": "medqa_4opt",
        "hf_path": "GBaker/MedQA-USMLE-4-options",
        "config": None,
        "splits": ["train", "test", "dev"],
    },
    # MedMCQA — 194k Indian medical-entrance MCQs (parquet)
    {
        "id": "medmcqa",
        "hf_path": "openlifescienceai/medmcqa",
        "config": None,
        "splits": ["train", "validation", "test"],
    },
    # PubMedQA — 273k Q&A from PubMed abstracts (parquet)
    {
        "id": "pubmed_qa",
        "hf_path": "qiaojin/PubMedQA",
        "config": "pqa_artificial",
        "splits": ["train"],
    },
    # PubMedQA labeled — 1k expert-labeled subset
    {
        "id": "pubmed_qa_labeled",
        "hf_path": "qiaojin/PubMedQA",
        "config": "pqa_labeled",
        "splits": ["train"],
    },
    # MedMCQA-Lavita-style alias backup if open-life science is gated
    {
        "id": "medqa_lavita",
        "hf_path": "lavita/medical-qa-datasets",
        "config": "medmcqa",
        "splits": ["train"],
    },
    # Lavita's combined medical-QA bench (large, parquet) — fallback for medmcqa
    {
        "id": "medical_qa_lavita_full",
        "hf_path": "lavita/medical-qa-datasets",
        "config": "all-processed",
        "splits": ["train"],
    },
]


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--only", help="comma-separated subset of dataset ids")
    return p.parse_args()


def pull_one(spec):
    from datasets import load_dataset

    out_dir = DATA_ROOT / spec["id"]
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"\n[hf-bulk-pull] {spec['id']}  <-  {spec['hf_path']} ({spec['config'] or 'default'})")
    sys.stdout.flush()
    try:
        # No trust_remote_code (deprecated). All datasets in this list
        # are parquet-backed; if the loader still asks for a script,
        # the dataset has been removed/migrated and we let it fail.
        ds = load_dataset(spec["hf_path"], name=spec["config"])
        total = 0
        for split in spec["splits"]:
            if split not in ds:
                continue
            rows = ds[split]
            n = len(rows)
            total += n
            out_file = out_dir / f"{split}.jsonl"
            with open(out_file, "w", encoding="utf-8") as f:
                for r in rows:
                    f.write(json.dumps(r, ensure_ascii=False) + "\n")
            print(f"  {split:<12} {n:>8,} rows  ->  {out_file.name}")
        # Manifest
        manifest = {
            "id": spec["id"],
            "hf_path": spec["hf_path"],
            "config": spec["config"],
            "splits": spec["splits"],
            "total_rows": total,
            "fetched_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        }
        (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
        print(f"  OK {spec['id']} -- {total:,} rows total")
    except Exception as e:
        print(f"  FAIL {spec['id']} -- {type(e).__name__}: {e}")


def main():
    args = parse_args()
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    if args.only:
        wanted = set(args.only.split(","))
        chosen = [d for d in DATASETS if d["id"] in wanted]
    else:
        chosen = DATASETS
    print(f"[hf-bulk-pull] pulling {len(chosen)} datasets into {DATA_ROOT}")
    for spec in chosen:
        pull_one(spec)
    print(f"\n[hf-bulk-pull] done")


if __name__ == "__main__":
    main()

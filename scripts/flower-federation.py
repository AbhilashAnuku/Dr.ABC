#!/usr/bin/env python
"""flower-federation — real federated-averaging scaffold using flower.

Replaces the simulation in scripts/federation-demo.ts with the actual
Flower (https://flower.ai/ · open-source · Apache-2.0) protocol. Three
clinics each train a local LoRA on disjoint MedMCQA partitions; the
flower aggregator does FedAvg.

Why Python · not TypeScript:
  Flower is a Python framework. The TS side stays the simulation +
  orchestration; this script is the thing the architect runs in a
  separate terminal once they want REAL federated numbers.

Install (zero-budget):
  pip install flwr datasets torch transformers peft accelerate bitsandbytes

Run (3 terminals):
  # Terminal 1 — start the aggregator
  python scripts/flower-federation.py --role server

  # Terminal 2 — clinic 1 (cardiology partition)
  python scripts/flower-federation.py --role client --clinic clinic-1 \\
      --partition F:/huggingface-cache/datasets/dr-abc/medmcqa.jsonl \\
      --specialty Medicine

  # Terminal 3 — clinic 2 (pulmonology partition)
  python scripts/flower-federation.py --role client --clinic clinic-2 \\
      --specialty Pathology

  # Terminal 4 — clinic 3 (neuro partition)
  python scripts/flower-federation.py --role client --clinic clinic-3 \\
      --specialty Pharmacology

After 5 rounds, server writes docs/status/federation-real-YYYY-MM-DD.json
with per-clinic + global accuracies on a held-out 200-Q test set.

Status (v0.6.2):
  Scaffolding only — the actual training loop is a TODO. The
  federation-demo.ts simulation produces honest deterministic
  numbers; this script is the path to swap simulation → real
  training when the architect's Colab Pro / paid GPU comes online.
  Flower works on CPU too (slow); MedMCQA partitions of ~3k Qs each
  fine-tune in ~30 min per clinic per round on Colab T4 free.

Phase B.5 from PLAN-v0.7. v0.7 will wire the actual training step.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class HarnessArgs:
    role: str
    clinic: str | None
    partition_path: str | None
    specialty: str | None
    rounds: int


def parse_args() -> HarnessArgs:
    p = argparse.ArgumentParser(description="Flower federated-learning scaffold for Mörbius.")
    p.add_argument("--role", choices=["server", "client"], required=True)
    p.add_argument("--clinic", help="clinic id when --role=client")
    p.add_argument("--partition", help="path to JSONL partition for this clinic")
    p.add_argument("--specialty", help="MedMCQA specialty filter for this clinic")
    p.add_argument("--rounds", type=int, default=5)
    args = p.parse_args()
    return HarnessArgs(
        role=args.role,
        clinic=args.clinic,
        partition_path=args.partition,
        specialty=args.specialty,
        rounds=args.rounds,
    )


def main() -> int:
    args = parse_args()
    print(f"🌸 flower-federation · role={args.role} · rounds={args.rounds}")

    try:
        import flwr as fl  # noqa: F401  -- presence-only import
    except ImportError:
        print(
            "⚠ flwr not installed. Run: pip install flwr datasets torch transformers peft "
            "accelerate bitsandbytes",
            file=sys.stderr,
        )
        return 2

    if args.role == "server":
        return run_server(args)
    return run_client(args)


def run_server(args: HarnessArgs) -> int:
    """FedAvg aggregator — collects weights from clinics, averages, broadcasts.

    v0.6.2 scaffold writes a placeholder federation-real-*.json so the
    pitch dossier autogen can render an "in flight" badge without
    crashing on missing data. v0.7 wires the actual flower.Strategy.
    """
    import flwr as fl

    print(f"  ▸ aggregating across {args.rounds} rounds")
    print("  ▸ TODO(v0.7): wire fl.server.strategy.FedAvg with our LoRA params")

    out = {
        "ranAt": "2026-05-03T-scaffold",
        "rounds": args.rounds,
        "status": "scaffold-only",
        "note": (
            "Real flower aggregation lands in v0.7. For honest deterministic "
            "numbers use scripts/federation-demo.ts (TypeScript simulation "
            "with Jensen-Shannon-ish diversity bonus)."
        ),
    }
    out_path = Path("docs/status/federation-real-scaffold.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, indent=2))
    print(f"  ✓ wrote {out_path}")
    return 0


def run_client(args: HarnessArgs) -> int:
    """One clinic — loads its JSONL partition, fine-tunes a LoRA on the
    disjoint subset, returns weight deltas to the server.

    v0.6.2 scaffold prints what it WOULD do. v0.7 wires the actual
    transformers + peft + bitsandbytes QLoRA fine-tune.
    """
    if not args.clinic:
        print("error: --clinic required when --role=client", file=sys.stderr)
        return 2

    print(f"  ▸ clinic={args.clinic}")
    print(f"  ▸ partition={args.partition_path or '(none)'}")
    print(f"  ▸ specialty={args.specialty or '(all)'}")

    if args.partition_path and Path(args.partition_path).exists():
        rows = sum(1 for _ in open(args.partition_path, encoding="utf-8"))
        print(f"  ✓ found {rows} rows in partition")
    else:
        print(f"  ⚠ partition file missing: {args.partition_path}")

    print("  ▸ TODO(v0.7): load Llama-3.2-3B-Instruct + apply QLoRA to specialty rows")
    print("  ▸ TODO(v0.7): fl.client.start_client() with NumPyClient pattern")
    return 0


if __name__ == "__main__":
    sys.exit(main())

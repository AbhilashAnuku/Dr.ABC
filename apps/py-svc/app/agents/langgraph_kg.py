"""
langgraph_kg · LangGraph state machine for Mörbius's knowledge graph.

Architect's v0.8 godmode (2026-05-06): "use LangGraph for the
knowledge graph of Mörbius and its training agents."

This module defines two graphs:

  · build_kg_graph()   — extract → entities → relations → cluster
  · build_train_graph() — sample → tune → calibrate → eval (daily 02:00)

Both are pure LangGraph StateGraphs. Each node is a small function
that mutates the state dict; LangGraph handles the edges, retries,
checkpoints. Falls back gracefully if `langgraph` isn't installed
(returns a no-op `runner()` so the rest of py-svc still loads).

Install with: uv sync --extra langgraph
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any, Iterator, TypedDict

# Soft import so py-svc still boots without the langgraph extra installed.
try:
    from langgraph.graph import END, START, StateGraph  # type: ignore[import-not-found]

    LANGGRAPH_AVAILABLE = True
except ImportError:  # pragma: no cover
    LANGGRAPH_AVAILABLE = False
    StateGraph = None  # type: ignore[assignment]
    START = "__start__"  # type: ignore[assignment]
    END = "__end__"  # type: ignore[assignment]


from app.lib.flat_kg import StreamingKGExtractor, iter_chunks_from_file


# ──────────────────────────────────────────────────────────────────────
#  KG build state
# ──────────────────────────────────────────────────────────────────────


class KGState(TypedDict, total=False):
    """State carried across the KG build graph."""

    input_path: str
    output_dir: str
    jsonl_text_key: str | None
    window_chars: int
    overlap_chars: int

    chunks_seen: int
    mentions_total: int
    entities_count: int
    relations_count: int
    clusters_count: int
    elapsed_seconds: float
    finished_at: float
    error: str | None


def node_extract(state: KGState) -> KGState:
    """Stream the input through the flat_kg extractor · constant memory."""
    started = time.time()
    in_path = state.get("input_path", "")
    out_dir = state.get("output_dir", "")
    text_key = state.get("jsonl_text_key")
    window = state.get("window_chars", 4096)
    overlap = state.get("overlap_chars", 256)
    if not in_path or not out_dir:
        return {**state, "error": "input_path + output_dir required"}

    Path(out_dir).mkdir(parents=True, exist_ok=True)
    chunks = 0
    mentions = 0
    with StreamingKGExtractor(out_dir) as kg:
        if in_path.endswith(".jsonl") and text_key:
            with open(in_path, "r", encoding="utf-8") as fp:
                for row_no, line in enumerate(fp, 1):
                    try:
                        row = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    text = row.get(text_key) or ""
                    if not text:
                        continue
                    kg.feed(text, source_id=f"file:{Path(in_path).name}#row={row_no}")
                    chunks += 1
        else:
            for chunk, src in iter_chunks_from_file(
                in_path, window_chars=window, overlap_chars=overlap
            ):
                kg.feed(chunk, source_id=src)
                chunks += 1
        s = kg.stats()
        mentions = s["mentions_total"]
    return {
        **state,
        "chunks_seen": chunks,
        "mentions_total": mentions,
        "elapsed_seconds": time.time() - started,
        "error": None,
    }


def node_count_layers(state: KGState) -> KGState:
    """After the extractor closes, count the rows in each output layer."""
    if state.get("error"):
        return state
    out_dir = Path(state.get("output_dir", ""))
    counts: dict[str, int] = {}
    for layer in ("mentions", "entities", "relations", "clusters"):
        path = out_dir / f"{layer}.jsonl"
        if not path.exists():
            counts[layer] = 0
            continue
        n = 0
        with open(path, "r", encoding="utf-8") as fp:
            for _ in fp:
                n += 1
        counts[layer] = n
    return {
        **state,
        "entities_count": counts.get("entities", 0),
        "relations_count": counts.get("relations", 0),
        "clusters_count": counts.get("clusters", 0),
    }


def node_publish(state: KGState) -> KGState:
    """Write the final stats JSON next to the layered files."""
    if state.get("error"):
        return state
    out_dir = Path(state.get("output_dir", ""))
    summary = {
        "ranAt": time.time(),
        "input": state.get("input_path"),
        "chunks": state.get("chunks_seen", 0),
        "mentions": state.get("mentions_total", 0),
        "entities": state.get("entities_count", 0),
        "relations": state.get("relations_count", 0),
        "clusters": state.get("clusters_count", 0),
        "elapsedSec": round(state.get("elapsed_seconds", 0.0), 2),
    }
    (out_dir / "stats.json").write_text(json.dumps(summary, indent=2))
    return {**state, "finished_at": time.time()}


def build_kg_graph() -> Any:
    """
    Compose the KG state machine: extract → count → publish.

    Returns a compiled LangGraph runnable, OR a fallback callable that
    runs the same nodes sequentially if langgraph isn't installed.
    """
    if not LANGGRAPH_AVAILABLE:
        # Fallback · still works without langgraph installed
        def runner(initial: KGState) -> KGState:
            s = node_extract(initial)
            s = node_count_layers(s)
            s = node_publish(s)
            return s

        return runner

    g = StateGraph(KGState)
    g.add_node("extract", node_extract)
    g.add_node("count", node_count_layers)
    g.add_node("publish", node_publish)
    g.add_edge(START, "extract")
    g.add_edge("extract", "count")
    g.add_edge("count", "publish")
    g.add_edge("publish", END)
    return g.compile()


# ──────────────────────────────────────────────────────────────────────
#  Daily train state
# ──────────────────────────────────────────────────────────────────────


class TrainState(TypedDict, total=False):
    """State carried across the daily train graph."""

    corpus_root: str
    sample_size: int
    sample_paths: list[str]
    proposals_path: str | None
    proposals_count: int
    accuracy_before: float | None
    accuracy_after: float | None
    elapsed_seconds: float
    error: str | None


def node_sample_corpus(state: TrainState) -> TrainState:
    """Pick the freshest k exemplars from the corpus root."""
    started = time.time()
    root = Path(state.get("corpus_root", "data/kg"))
    if not root.exists():
        return {**state, "error": f"corpus_root missing: {root}", "elapsed_seconds": 0.0}
    k = state.get("sample_size", 32)
    files = sorted(
        (p for p in root.rglob("entities.jsonl") if p.is_file()),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )[:k]
    return {
        **state,
        "sample_paths": [str(p) for p in files],
        "elapsed_seconds": time.time() - started,
        "error": None,
    }


def node_tune(state: TrainState) -> TrainState:
    """Architect-approved tune step · STUB · queues proposals to disk."""
    if state.get("error"):
        return state
    paths = state.get("sample_paths", [])
    proposals_dir = Path("docs/status")
    proposals_dir.mkdir(parents=True, exist_ok=True)
    proposals_path = proposals_dir / f"langgraph-tune-{int(time.time())}.json"
    proposals_path.write_text(
        json.dumps(
            {
                "ranAt": time.time(),
                "sampleCount": len(paths),
                "samplePaths": paths,
                "note": (
                    "langgraph_kg.py tune stub · architect-approved promotion path "
                    "lives in packages/agents/src/tuner.ts · this graph just "
                    "stages the corpus + writes a proposal envelope"
                ),
            },
            indent=2,
        )
    )
    return {**state, "proposals_path": str(proposals_path), "proposals_count": 0}


def node_calibrate(state: TrainState) -> TrainState:
    """Calibrate gauntlet thresholds · STUB · TS calibrator owns the actual numbers."""
    if state.get("error"):
        return state
    return {**state}


def node_eval(state: TrainState) -> TrainState:
    """Run the accuracy harness · STUB · `bun run morbius:medqa` is the real one."""
    if state.get("error"):
        return state
    return {**state}


def build_train_graph() -> Any:
    """Compose the daily-train state machine."""
    if not LANGGRAPH_AVAILABLE:

        def runner(initial: TrainState) -> TrainState:
            s = node_sample_corpus(initial)
            s = node_tune(s)
            s = node_calibrate(s)
            s = node_eval(s)
            return s

        return runner

    g = StateGraph(TrainState)
    g.add_node("sample", node_sample_corpus)
    g.add_node("tune", node_tune)
    g.add_node("calibrate", node_calibrate)
    g.add_node("eval", node_eval)
    g.add_edge(START, "sample")
    g.add_edge("sample", "tune")
    g.add_edge("tune", "calibrate")
    g.add_edge("calibrate", "eval")
    g.add_edge("eval", END)
    return g.compile()


# ──────────────────────────────────────────────────────────────────────
#  CLI · for the daily Windows Task Scheduler entry
# ──────────────────────────────────────────────────────────────────────


def _cli() -> None:
    import argparse

    p = argparse.ArgumentParser(description="Mörbius LangGraph KG + train pipeline")
    sub = p.add_subparsers(dest="cmd", required=True)

    pkg = sub.add_parser("build-kg", help="Run the KG build graph on one input")
    pkg.add_argument("--input", required=True)
    pkg.add_argument("--output", required=True)
    pkg.add_argument("--jsonl-text-key", default=None)

    ptr = sub.add_parser("daily-train", help="Run the daily train graph (sample → tune → calibrate → eval)")
    ptr.add_argument("--corpus-root", default="data/kg")
    ptr.add_argument("--sample-size", type=int, default=32)

    args = p.parse_args()

    if args.cmd == "build-kg":
        graph = build_kg_graph()
        result = graph.invoke({  # type: ignore[union-attr]
            "input_path": args.input,
            "output_dir": args.output,
            "jsonl_text_key": args.jsonl_text_key,
            "window_chars": 4096,
            "overlap_chars": 256,
        }) if LANGGRAPH_AVAILABLE else graph({
            "input_path": args.input,
            "output_dir": args.output,
            "jsonl_text_key": args.jsonl_text_key,
            "window_chars": 4096,
            "overlap_chars": 256,
        })
        print(f"[langgraph-kg] done · {result.get('mentions_total')} mentions · "
              f"{result.get('entities_count')} entities · {result.get('relations_count')} relations · "
              f"{result.get('clusters_count')} clusters · {result.get('elapsed_seconds', 0):.1f}s")

    elif args.cmd == "daily-train":
        graph = build_train_graph()
        result = graph.invoke({  # type: ignore[union-attr]
            "corpus_root": args.corpus_root,
            "sample_size": args.sample_size,
        }) if LANGGRAPH_AVAILABLE else graph({
            "corpus_root": args.corpus_root,
            "sample_size": args.sample_size,
        })
        if result.get("error"):
            print(f"[langgraph-train] error: {result['error']}")
            os._exit(1)
        print(f"[langgraph-train] sampled {len(result.get('sample_paths', []))} corpus files · "
              f"proposals -> {result.get('proposals_path')}")


if __name__ == "__main__":
    _cli()

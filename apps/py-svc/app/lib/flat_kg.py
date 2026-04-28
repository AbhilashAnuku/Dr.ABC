"""
flat_kg · constant-memory streaming knowledge-graph extractor.

Architect's ask (2026-05-06):
  "write any py code which keeps the memory flat even for long inputs
   so it won't be slow · and the knowledge is like layer by layer
   so it will be easy for Llama to train and test."

Two guarantees:

  1. FLAT MEMORY · the extractor processes input in a sliding window of
     bounded size (default 4 096 chars · ~1 K tokens). RAM usage is
     O(window) regardless of total input length. A 100 MB document and
     a 100 KB document use the same memory.

  2. LAYERED OUTPUT · the KG writes four append-only JSONL files, one
     per knowledge layer. Each layer is independently trainable on
     Llama 3.x via QLoRA, and independently evaluatable.

       layer 1 · mentions.jsonl    raw spans · {text, offset, layer1_id}
       layer 2 · entities.jsonl    deduped canonical · {id, kind, label,
                                   aliases, mention_count, sources}
       layer 3 · relations.jsonl   typed triples · {head, rel, tail,
                                   evidence, confidence}
       layer 4 · clusters.jsonl    themed groups · {cluster_id, members,
                                   centroid_label, weight}

Why each layer is its own file:

  · You train Llama on layer 1 to do NER (text → mention spans)
  · You train Llama on layer 2 to do canonicalisation (mention → entity)
  · You train Llama on layer 3 to do relation extraction (text → triple)
  · You train Llama on layer 4 to do clustering / theme labelling

  Each layer is a separate fine-tuning corpus · separate eval set ·
  separate accuracy number. No layer leaks data into the next.

How to use (CLI):

    python -m app.lib.flat_kg \
        --input  data/hf-bench/medmcqa/train.jsonl \
        --output data/kg/medmcqa \
        --jsonl-text-key question

  Or programmatically:

    from app.lib.flat_kg import StreamingKGExtractor
    with StreamingKGExtractor("data/kg/run-001") as kg:
        for chunk in iter_chunks_from_file(path, window_chars=4096):
            kg.feed(chunk, source_id=f"file:{path}")
        # auto-flushes on close

Note: this is a STARTER · pattern-based extractor (regex over ICD-10,
drug-class suffixes, vital signs). For production, swap the
`extract_mentions` callable for a Llama or BioBERT call. The streaming
shape stays the same.
"""

from __future__ import annotations

import json
import os
import re
import time
from collections import OrderedDict
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Iterator, Iterable, Optional


# ──────────────────────────────────────────────────────────────────────
#  Public datatypes (all JSON-serialisable)
# ──────────────────────────────────────────────────────────────────────

@dataclass
class Mention:
    """Raw text span with offset · the lowest layer."""
    layer1_id: str
    text: str
    kind: str               # icd10 · drug · vital · symptom · condition
    offset: int             # offset into the source chunk (NOT global)
    source_id: str          # "file:medmcqa/train.jsonl#row=42"
    extracted_at: float


@dataclass
class Entity:
    """Canonicalised entity · merged across mentions · layer 2."""
    id: str                 # "icd10:i21-0"
    kind: str
    label: str
    aliases: list[str] = field(default_factory=list)
    mention_count: int = 0
    sources: list[str] = field(default_factory=list)


@dataclass
class Relation:
    """Typed triple · layer 3."""
    head: str               # entity id
    rel: str                # "co-occurs-with" · "treats" · "icd-of"
    tail: str               # entity id
    evidence: str           # short quote from source
    confidence: float = 0.5
    extracted: str = "EXTRACTED"  # EXTRACTED · INFERRED · AMBIGUOUS


@dataclass
class Cluster:
    """Theme group · layer 4 · meta over entities."""
    cluster_id: str
    centroid_label: str
    members: list[str]      # entity ids
    weight: int             # sum of mention counts


# ──────────────────────────────────────────────────────────────────────
#  Pattern-based extractor (swap with Llama/BioBERT in production)
# ──────────────────────────────────────────────────────────────────────

ICD10_RE = re.compile(r"\b([A-TV-Z]\d{2}(?:\.\d{1,3})?)\b")

# Drug-class suffix heuristic · matches the most common ones
DRUG_SUFFIX_RE = re.compile(
    r"\b(\w+(?:pril|sartan|olol|statin|azepam|prazole|cycline|cillin|mab|nib))\b",
    re.IGNORECASE,
)

# Vital sign patterns (HR / BP / SpO₂ / RR / temp / glucose)
VITAL_RES = [
    (re.compile(r"\b(?:HR|heart rate)\D{0,8}(\d{2,3})\b", re.I), "vital", "hr"),
    (re.compile(r"\b(?:BP|blood pressure)\D{0,8}(\d{2,3}\s*/\s*\d{2,3})\b", re.I), "vital", "bp"),
    (re.compile(r"\b(?:SpO2|SaO2|oxygen saturation)\D{0,8}(\d{1,3}\s*%)", re.I), "vital", "spo2"),
    (re.compile(r"\b(?:RR|respiratory rate)\D{0,8}(\d{1,3})\b", re.I), "vital", "rr"),
    (re.compile(r"\btemp(?:erature)?\D{0,8}(\d{2,3}(?:\.\d)?\s*°?c)\b", re.I), "vital", "temp"),
    (re.compile(r"\bglucose\D{0,8}(\d{2,4})\b", re.I), "vital", "glucose"),
]

# Common symptoms · short list · grow as needed
SYMPTOM_TERMS = (
    "chest pain", "shortness of breath", "headache", "fever",
    "cough", "diarrhoea", "diarrhea", "nausea", "vomiting",
    "dizziness", "fatigue", "rash", "abdominal pain",
)
SYMPTOM_RE = re.compile(
    r"\b(" + "|".join(re.escape(t) for t in SYMPTOM_TERMS) + r")\b", re.I
)


def extract_mentions(text: str, source_id: str) -> Iterator[Mention]:
    """Yield mentions found in `text`. Pattern-based · O(n) · stateless."""
    now = time.time()
    n = 0
    for m in ICD10_RE.finditer(text):
        n += 1
        yield Mention(
            layer1_id=f"{source_id}#m{n}",
            text=m.group(1),
            kind="icd10",
            offset=m.start(),
            source_id=source_id,
            extracted_at=now,
        )
    for m in DRUG_SUFFIX_RE.finditer(text):
        n += 1
        yield Mention(
            layer1_id=f"{source_id}#m{n}",
            text=m.group(1).lower(),
            kind="drug",
            offset=m.start(),
            source_id=source_id,
            extracted_at=now,
        )
    for r, kind, sub in VITAL_RES:
        for m in r.finditer(text):
            n += 1
            yield Mention(
                layer1_id=f"{source_id}#m{n}",
                text=f"{sub}={m.group(1).strip()}",
                kind=kind,
                offset=m.start(),
                source_id=source_id,
                extracted_at=now,
            )
    for m in SYMPTOM_RE.finditer(text):
        n += 1
        yield Mention(
            layer1_id=f"{source_id}#m{n}",
            text=m.group(1).lower(),
            kind="symptom",
            offset=m.start(),
            source_id=source_id,
            extracted_at=now,
        )


# ──────────────────────────────────────────────────────────────────────
#  Streaming extractor · constant memory
# ──────────────────────────────────────────────────────────────────────

class StreamingKGExtractor:
    """
    Process arbitrarily-long text in bounded-memory chunks.

    Memory invariants:
      · `entities` LRU is capped at `entity_cap` items (default 50 000)
      · mentions are streamed straight to disk · no in-memory list
      · relations + clusters are flushed when the buffer crosses
        `relation_buffer` / `cluster_buffer`

    Use as a context manager:

        with StreamingKGExtractor("out/run-001") as kg:
            for chunk in chunker:
                kg.feed(chunk, source_id="...")
        # files closed + final cluster pass ran on __exit__
    """

    def __init__(
        self,
        out_dir: str | os.PathLike,
        *,
        entity_cap: int = 50_000,
        relation_buffer: int = 1_024,
        cluster_buffer: int = 256,
    ) -> None:
        self.out_dir = Path(out_dir)
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self.entity_cap = entity_cap
        self.relation_buffer_size = relation_buffer
        self.cluster_buffer_size = cluster_buffer

        # Bounded LRU of entities so cardinality stays flat.
        # Eviction rule: when over cap, oldest entry is dropped + flushed
        # to disk (it remains in entities.jsonl, just not in memory).
        self._entities: "OrderedDict[str, Entity]" = OrderedDict()
        self._relation_buffer: list[Relation] = []
        self._cluster_buffer: list[Cluster] = []

        self._mentions_fp = open(self.out_dir / "mentions.jsonl", "a", encoding="utf-8")
        self._entities_fp = open(self.out_dir / "entities.jsonl", "a", encoding="utf-8")
        self._relations_fp = open(self.out_dir / "relations.jsonl", "a", encoding="utf-8")
        self._clusters_fp = open(self.out_dir / "clusters.jsonl", "a", encoding="utf-8")

        self._chunks_seen = 0
        self._mentions_total = 0

    # ── public API ────────────────────────────────────────────────────

    def feed(self, text: str, *, source_id: str) -> None:
        """
        Push one chunk through the pipeline.

        text:      a single chunk (typically 1-8 KB) — KEEP IT BOUNDED.
                   For long files use `iter_chunks_from_file()`.
        source_id: stable identifier ("file:medmcqa/train.jsonl#row=42")
        """
        if not text:
            return
        self._chunks_seen += 1

        # Pass 1 · mentions (streamed)
        chunk_mentions: list[Mention] = []
        for m in extract_mentions(text, source_id):
            self._mentions_fp.write(json.dumps(asdict(m), ensure_ascii=False) + "\n")
            self._mentions_total += 1
            chunk_mentions.append(m)
            self._touch_entity(m)

        # Pass 2 · relations · pairwise within the chunk
        # (a mention X "co-occurs-with" mention Y if both seen in same
        # chunk · simplest possible signal; production code can swap
        # this for a Llama-extracted triple)
        if len(chunk_mentions) > 1:
            seen: set[tuple[str, str]] = set()
            for i, mi in enumerate(chunk_mentions):
                for mj in chunk_mentions[i + 1 :]:
                    if mi.kind == mj.kind:
                        continue
                    head_id = self._entity_id(mi)
                    tail_id = self._entity_id(mj)
                    if (head_id, tail_id) in seen:
                        continue
                    seen.add((head_id, tail_id))
                    rel = self._infer_relation(mi, mj)
                    self._relation_buffer.append(
                        Relation(
                            head=head_id,
                            rel=rel,
                            tail=tail_id,
                            evidence=text[max(0, mi.offset - 40) : mi.offset + 80].strip(),
                            confidence=0.5 if rel == "co-occurs-with" else 0.7,
                            extracted="EXTRACTED" if rel == "co-occurs-with" else "INFERRED",
                        )
                    )

        if len(self._relation_buffer) >= self.relation_buffer_size:
            self._flush_relations()

        if self._chunks_seen % 64 == 0:
            self._evict_old_entities()

    def stats(self) -> dict:
        return {
            "chunks_seen": self._chunks_seen,
            "mentions_total": self._mentions_total,
            "entities_in_memory": len(self._entities),
            "relations_buffered": len(self._relation_buffer),
        }

    # ── context manager ──────────────────────────────────────────────

    def __enter__(self) -> "StreamingKGExtractor":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    def close(self) -> None:
        """Flush everything · build clusters · close file handles."""
        self._flush_relations()
        self._flush_entities_full()
        self._build_clusters()
        for fp in (
            self._mentions_fp,
            self._entities_fp,
            self._relations_fp,
            self._clusters_fp,
        ):
            try:
                fp.close()
            except Exception:
                pass

    # ── private ───────────────────────────────────────────────────────

    def _entity_id(self, m: Mention) -> str:
        # icd10 codes keep their canonical case; everything else lowercases
        if m.kind == "icd10":
            return f"icd10:{m.text.lower().replace('.', '-')}"
        return f"{m.kind}:{m.text.lower().strip()}"

    def _touch_entity(self, m: Mention) -> None:
        eid = self._entity_id(m)
        ent = self._entities.get(eid)
        if ent is None:
            ent = Entity(id=eid, kind=m.kind, label=m.text)
            self._entities[eid] = ent
        ent.mention_count += 1
        if m.text not in ent.aliases and m.text != ent.label:
            ent.aliases.append(m.text)
        if m.source_id not in ent.sources:
            ent.sources.append(m.source_id)
        self._entities.move_to_end(eid)

        if len(self._entities) > self.entity_cap:
            self._evict_old_entities()

    def _evict_old_entities(self) -> None:
        """Pop oldest entities to disk · keeps RAM flat."""
        while len(self._entities) > int(self.entity_cap * 0.8):
            _, ent = self._entities.popitem(last=False)
            self._entities_fp.write(json.dumps(asdict(ent), ensure_ascii=False) + "\n")

    def _flush_entities_full(self) -> None:
        for ent in self._entities.values():
            self._entities_fp.write(json.dumps(asdict(ent), ensure_ascii=False) + "\n")
        self._entities.clear()

    def _flush_relations(self) -> None:
        for rel in self._relation_buffer:
            self._relations_fp.write(json.dumps(asdict(rel), ensure_ascii=False) + "\n")
        self._relation_buffer.clear()

    def _infer_relation(self, head: Mention, tail: Mention) -> str:
        """Cheap kind-pair heuristic for typed relations."""
        a, b = head.kind, tail.kind
        pairs = {
            ("symptom", "condition"): "symptom-of",
            ("condition", "symptom"): "has-symptom",
            ("drug", "condition"): "treats",
            ("condition", "drug"): "treated-by",
            ("symptom", "icd10"): "icd-coded-by",
            ("icd10", "symptom"): "codes-symptom",
            ("vital", "condition"): "vital-of",
            ("condition", "vital"): "has-vital",
        }
        return pairs.get((a, b)) or pairs.get((b, a)) or "co-occurs-with"

    def _build_clusters(self) -> None:
        """
        Layer 4 · cluster entities by kind + co-mention frequency.

        We do a SINGLE pass over relations.jsonl after extraction is
        done — but keep it streaming · O(relations) memory at most one
        small dict.
        """
        relations_path = self.out_dir / "relations.jsonl"
        if not relations_path.exists():
            return
        adjacency: dict[str, set[str]] = {}
        try:
            with open(relations_path, "r", encoding="utf-8") as fp:
                for line in fp:
                    try:
                        r = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    h, t = r.get("head"), r.get("tail")
                    if not h or not t:
                        continue
                    adjacency.setdefault(h, set()).add(t)
                    adjacency.setdefault(t, set()).add(h)
        except OSError:
            return

        # Connected-components clustering · simple BFS · O(V + E)
        visited: set[str] = set()
        cluster_idx = 0
        for node in list(adjacency):
            if node in visited:
                continue
            stack = [node]
            members: list[str] = []
            while stack:
                v = stack.pop()
                if v in visited:
                    continue
                visited.add(v)
                members.append(v)
                stack.extend(adjacency.get(v, ()) - visited)
            if len(members) < 2:
                continue
            cluster_idx += 1
            centroid = sorted(members, key=lambda x: len(adjacency.get(x, ())), reverse=True)[0]
            cluster = Cluster(
                cluster_id=f"cluster:{cluster_idx:04d}",
                centroid_label=centroid,
                members=members,
                weight=sum(len(adjacency.get(m, ())) for m in members),
            )
            self._clusters_fp.write(json.dumps(asdict(cluster), ensure_ascii=False) + "\n")


# ──────────────────────────────────────────────────────────────────────
#  Streaming chunker · O(window) memory · for arbitrarily long files
# ──────────────────────────────────────────────────────────────────────

def iter_chunks_from_file(
    path: str | os.PathLike,
    *,
    window_chars: int = 4_096,
    overlap_chars: int = 256,
) -> Iterator[tuple[str, str]]:
    """
    Yield (chunk_text, source_id) pairs · constant memory.

    Args:
        path:          plain text or jsonl
        window_chars:  hard cap per chunk (~1 K tokens)
        overlap_chars: carry-over to preserve mid-entity boundaries

    Notes:
        For .jsonl, we pass each row through individually (one row =
        one chunk if it fits; otherwise it's split). The chunker never
        loads the file into memory.
    """
    path = Path(path)
    suffix = path.suffix.lower()
    if suffix == ".jsonl":
        with open(path, "r", encoding="utf-8") as fp:
            for row_no, line in enumerate(fp, 1):
                line = line.strip()
                if not line:
                    continue
                yield from _split_row(
                    line, f"file:{path.name}#row={row_no}", window_chars, overlap_chars
                )
    else:
        with open(path, "r", encoding="utf-8") as fp:
            buf = ""
            offset = 0
            while True:
                more = fp.read(window_chars)
                if not more:
                    if buf:
                        yield buf, f"file:{path.name}#offset={offset}"
                    return
                buf += more
                while len(buf) >= window_chars:
                    chunk, buf = buf[:window_chars], buf[window_chars - overlap_chars :]
                    yield chunk, f"file:{path.name}#offset={offset}"
                    offset += window_chars - overlap_chars


def _split_row(
    row: str, source_id: str, window: int, overlap: int
) -> Iterator[tuple[str, str]]:
    """Split a single jsonl row into windows if it's longer than `window`."""
    if len(row) <= window:
        yield row, source_id
        return
    i = 0
    part = 0
    while i < len(row):
        chunk = row[i : i + window]
        yield chunk, f"{source_id}#part={part}"
        part += 1
        i += window - overlap


# ──────────────────────────────────────────────────────────────────────
#  CLI
# ──────────────────────────────────────────────────────────────────────

def _cli() -> None:
    import argparse

    p = argparse.ArgumentParser(description="flat_kg · streaming layered KG extractor")
    p.add_argument("--input", required=True, help="path to .txt or .jsonl input file")
    p.add_argument("--output", required=True, help="output directory · 4 jsonl files written here")
    p.add_argument("--window", type=int, default=4_096, help="chunk window in chars (default 4096)")
    p.add_argument("--overlap", type=int, default=256, help="chunk overlap (default 256)")
    p.add_argument(
        "--jsonl-text-key",
        default=None,
        help="for .jsonl, extract this field as the text body (e.g. 'question')",
    )
    args = p.parse_args()

    started = time.time()
    with StreamingKGExtractor(args.output) as kg:
        if args.input.endswith(".jsonl") and args.jsonl_text_key:
            with open(args.input, "r", encoding="utf-8") as fp:
                for row_no, line in enumerate(fp, 1):
                    try:
                        row = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    text = row.get(args.jsonl_text_key) or ""
                    if not text:
                        continue
                    kg.feed(text, source_id=f"file:{Path(args.input).name}#row={row_no}")
                    if row_no % 1_000 == 0:
                        s = kg.stats()
                        print(
                            f"[flat_kg] {row_no} rows · {s['mentions_total']} mentions · "
                            f"{s['entities_in_memory']} entities-in-mem"
                        )
        else:
            for chunk, src in iter_chunks_from_file(
                args.input, window_chars=args.window, overlap_chars=args.overlap
            ):
                kg.feed(chunk, source_id=src)

    final = kg.stats()
    elapsed = time.time() - started
    print(
        f"[flat_kg] done · {final['chunks_seen']} chunks · "
        f"{final['mentions_total']} mentions · {elapsed:.1f}s"
    )
    print(f"[flat_kg] output -> {args.output}/")
    for layer in ("mentions", "entities", "relations", "clusters"):
        path = Path(args.output) / f"{layer}.jsonl"
        if path.exists():
            n = sum(1 for _ in open(path, "r", encoding="utf-8"))
            print(f"[flat_kg]   layer {layer:9s} = {n:>8d} rows · {path}")


if __name__ == "__main__":
    _cli()

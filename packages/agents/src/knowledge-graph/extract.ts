import type { Extraction, GraphEdge, GraphNode } from './types.ts';

/**
 * Stable slug for node ids — `condition:acute-mi`, `drug:aspirin`, etc.
 * Same kind + label → same slug → idempotent merges across cycles.
 */
function slugify(kind: string, label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${kind}:${slug || 'unknown'}`;
}

/**
 * Cheap SHA256 over a string. Used to cache-invalidate sources.
 * Bun has Web Crypto built in.
 */
export async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** What a consult contributes to the graph. */
export interface ConsultExtractInput {
  /** Stable consult id (e.g. `cn_1730000000_abc123`). */
  consultId: string;
  /** First user turn — the chief complaint. */
  complaint: string;
  /** Top differential the diagnostic agent emitted. */
  topCondition?: string;
  /** All differentials with probability. */
  differentials?: Array<{ condition: string; probability: number; icd10?: string }>;
  /** Recommended specialty for follow-up. */
  specialty?: string;
  /** Drugs prescribed in the Rx. */
  drugs?: string[];
  /** Recommended diagnostic tests. */
  tests?: string[];
}

/**
 * Turn one consult into nodes + edges. The diagnostic agent's
 * structured output is treated as `EXTRACTED` (it's literally the
 * model's stated answer). Cross-links between top condition and
 * specialty / drugs / tests are `EXTRACTED` when they came from the
 * same agent call, `INFERRED` when we're reading them from the
 * recommendRx heuristic.
 */
export async function extractFromConsult(input: ConsultExtractInput): Promise<Extraction> {
  const {
    consultId,
    complaint,
    topCondition,
    differentials = [],
    specialty,
    drugs = [],
    tests = [],
  } = input;

  const sourceHash = await sha256(JSON.stringify(input));
  const nodes: Extraction['nodes'] = [];
  const edges: Extraction['edges'] = [];

  // Symptom node from the complaint — first sentence, lower-cased,
  // truncated to 80 chars so it stays a stable id.
  const symptomLabel = complaint.split(/[.!?]/)[0]?.trim().slice(0, 80) ?? complaint;
  const symptomId = slugify('symptom', symptomLabel);
  nodes.push({ id: symptomId, kind: 'symptom', label: symptomLabel, source: consultId });

  // Top condition + every differential
  for (const d of differentials.length > 0
    ? differentials
    : topCondition
      ? [{ condition: topCondition, probability: 1.0, icd10: undefined }]
      : []) {
    const condId = slugify('condition', d.condition);
    nodes.push({ id: condId, kind: 'condition', label: d.condition, source: consultId });
    edges.push({
      source: symptomId,
      target: condId,
      relation: 'presents-with',
      // Top condition is EXTRACTED; lower-ranked differentials are
      // INFERRED with weight = probability.
      confidence:
        d.probability >= 0.8 ? 'EXTRACTED' : d.probability >= 0.4 ? 'INFERRED' : 'AMBIGUOUS',
      weight: d.probability,
      extractedFrom: consultId,
    });
    if (d.icd10) {
      const icdId = slugify('icd10', d.icd10);
      nodes.push({ id: icdId, kind: 'icd10', label: d.icd10, source: consultId });
      edges.push({
        source: condId,
        target: icdId,
        relation: 'coded-as',
        confidence: 'EXTRACTED',
        extractedFrom: consultId,
      });
    }
  }

  // Specialty routing
  if (specialty && (topCondition || differentials[0])) {
    const condLabel = topCondition ?? differentials[0]?.condition ?? '';
    const condId = slugify('condition', condLabel);
    const specId = slugify('specialty', specialty);
    nodes.push({ id: specId, kind: 'specialty', label: specialty, source: consultId });
    edges.push({
      source: condId,
      target: specId,
      relation: 'routes-to',
      confidence: 'EXTRACTED',
      extractedFrom: consultId,
    });
  }

  // Drugs (treated-with) — INFERRED because Rx items come from
  // recommendRx heuristic, not the diagnostic agent's direct emit.
  if (drugs.length > 0 && (topCondition || differentials[0])) {
    const condLabel = topCondition ?? differentials[0]?.condition ?? '';
    const condId = slugify('condition', condLabel);
    for (const d of drugs) {
      const drugId = slugify('drug', d);
      nodes.push({ id: drugId, kind: 'drug', label: d, source: consultId });
      edges.push({
        source: condId,
        target: drugId,
        relation: 'treated-with',
        confidence: 'INFERRED',
        weight: 0.7,
        extractedFrom: consultId,
      });
    }
  }

  // Tests
  if (tests.length > 0 && (topCondition || differentials[0])) {
    const condLabel = topCondition ?? differentials[0]?.condition ?? '';
    const condId = slugify('condition', condLabel);
    for (const t of tests) {
      const testId = slugify('test', t);
      nodes.push({ id: testId, kind: 'test', label: t, source: consultId });
      edges.push({
        source: condId,
        target: testId,
        relation: 'tested-by',
        confidence: 'EXTRACTED',
        extractedFrom: consultId,
      });
    }
  }

  return { source: consultId, sourceHash, nodes, edges };
}

/** What a paper / abstract contributes. */
export interface AbstractExtractInput {
  paperId: string; // PubMed PMID or DOI slug
  title: string;
  abstract: string;
  /** Optional pre-extracted entities from py-svc /ner/medical. */
  entities?: Array<{ text: string; kind: 'condition' | 'drug' | 'symptom' }>;
}

/**
 * Turn one abstract into nodes + edges. Without a real biomedical
 * NER pass, this is heuristic: regex-spot canonical condition names,
 * drug suffixes (`-pril`, `-statin`, `-mab`), specialty keywords.
 * When `entities` is provided (from py-svc), we trust those as
 * EXTRACTED; otherwise the heuristic finds are AMBIGUOUS.
 */
export async function extractFromAbstract(input: AbstractExtractInput): Promise<Extraction> {
  const { paperId, title, abstract, entities = [] } = input;
  const sourceHash = await sha256(`${title}\n\n${abstract}`);
  const nodes: Extraction['nodes'] = [];
  const edges: Extraction['edges'] = [];

  // The paper itself becomes a node every other entity links into.
  const paperNodeId = slugify('paper', paperId);
  nodes.push({ id: paperNodeId, kind: 'paper', label: title.slice(0, 120), source: paperId });

  if (entities.length > 0) {
    // Trust py-svc NER output.
    for (const e of entities) {
      const id = slugify(e.kind, e.text);
      nodes.push({ id, kind: e.kind, label: e.text, source: paperId });
      edges.push({
        source: id,
        target: paperNodeId,
        relation: 'mentioned-in',
        confidence: 'EXTRACTED',
        extractedFrom: paperId,
      });
    }
  } else {
    // Heuristic fallback — flag everything AMBIGUOUS.
    const text = `${title} ${abstract}`.toLowerCase();
    const drugSuffixes = /\b\w+(pril|sartan|statin|mab|olol|azepam|prazole|cycline|mycin)\b/g;
    for (const match of text.matchAll(drugSuffixes)) {
      const drug = match[0];
      const id = slugify('drug', drug);
      nodes.push({ id, kind: 'drug', label: drug, source: paperId });
      edges.push({
        source: id,
        target: paperNodeId,
        relation: 'mentioned-in',
        confidence: 'AMBIGUOUS',
        weight: 0.3,
        extractedFrom: paperId,
      });
    }
  }

  return { source: paperId, sourceHash, nodes, edges };
}

import { BaseAgent } from '@dr-abc/morbius-core';
import { AgentKind, Intent, type OrchestratorEvent, type Task } from '@dr-abc/types';

/**
 * A single retrievable passage. Stays plain-data so it round-trips through
 * Qdrant payloads or a JSONL ingest pipeline unchanged.
 */
export interface LibraryDocument {
  /** Stable id (UUID or content hash). */
  id: string;
  /** The actual prose. */
  text: string;
  /** Provenance — book / journal / public-domain source. */
  source: string;
  /** Optional intra-source locator (page, paragraph, section heading). */
  locator?: string;
  /** Year of publication (lets us prefer recent for treatment, classic for anatomy). */
  year?: number;
  /** Free-form tags for filtering (e.g. ['anatomy','heart','cardiovascular']). */
  tags?: string[];
}

export interface Citation {
  document: LibraryDocument;
  score: number;
  matchedTerms: string[];
}

export interface RetrievalResult {
  query: string;
  citations: Citation[];
  /** Optional human-readable retriever id — bm25(seed) / pgvector(model@dim) / etc. */
  retrieverUsed?: string;
}

/**
 * Retriever — the swappable surface for library lookup.
 *
 *   V0 (this PR):  Bm25Retriever — sparse keyword retrieval, in-memory.
 *   V1 (later):    HybridRetriever — BM25 + dense vectors via Qdrant +
 *                  Cohere Rerank for final ordering. Same `search` signature.
 */
export interface Retriever {
  readonly name: string;
  search(query: string, k: number): Promise<RetrievalResult>;
}

// ---------------------------------------------------------------
//  BM25 — Okapi BM25, the workhorse sparse-retrieval algorithm.
//  Constants per the original Robertson/Spärck Jones paper.
// ---------------------------------------------------------------
const BM25_K1 = 1.5;
const BM25_B = 0.75;

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'is',
  'and',
  'or',
  'of',
  'in',
  'on',
  'to',
  'for',
  'with',
  'as',
  'at',
  'by',
  'be',
  'from',
  'this',
  'that',
  'it',
  'are',
  'was',
  'were',
  'will',
  'i',
  'you',
  'me',
  'my',
  'we',
  'our',
  'tell',
  'about',
  'what',
  'how',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

interface IndexedDoc {
  doc: LibraryDocument;
  tokens: string[];
  termFreq: Map<string, number>;
  length: number;
}

export class Bm25Retriever implements Retriever {
  readonly name = 'bm25-in-memory';
  private indexed: IndexedDoc[];
  private docFreq = new Map<string, number>();
  private avgDocLength: number;

  constructor(corpus: readonly LibraryDocument[]) {
    this.indexed = corpus.map((doc) => {
      const tokens = tokenize(`${doc.text} ${doc.tags?.join(' ') ?? ''}`);
      const termFreq = new Map<string, number>();
      for (const t of tokens) termFreq.set(t, (termFreq.get(t) ?? 0) + 1);
      return { doc, tokens, termFreq, length: tokens.length };
    });

    for (const idx of this.indexed) {
      for (const term of new Set(idx.tokens)) {
        this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
      }
    }

    this.avgDocLength =
      this.indexed.length === 0
        ? 0
        : this.indexed.reduce((sum, d) => sum + d.length, 0) / this.indexed.length;
  }

  async search(query: string, k: number): Promise<RetrievalResult> {
    const queryTerms = tokenize(query);
    if (queryTerms.length === 0 || this.indexed.length === 0) {
      return { query, citations: [] };
    }

    const N = this.indexed.length;
    const scored = this.indexed.map((idx) => {
      const matched = new Set<string>();
      let score = 0;
      for (const term of queryTerms) {
        const tf = idx.termFreq.get(term);
        if (!tf) continue;
        matched.add(term);
        const df = this.docFreq.get(term) ?? 0;
        const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
        const norm = 1 - BM25_B + BM25_B * (idx.length / Math.max(this.avgDocLength, 1));
        score += idf * ((tf * (BM25_K1 + 1)) / (tf + BM25_K1 * norm));
      }
      return { document: idx.doc, score, matchedTerms: [...matched] };
    });

    const topK = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);

    return { query, citations: topK };
  }
}

// ---------------------------------------------------------------
//  Library Agent
// ---------------------------------------------------------------
export interface LibraryInput {
  text: string;
  topK?: number;
}

export interface LibraryOutput {
  query: string;
  citations: Array<{
    text: string;
    source: string;
    locator?: string;
    score: number;
    matchedTerms: string[];
  }>;
  retrieverUsed: string;
}

export class LibraryAgent extends BaseAgent<LibraryInput, LibraryOutput> {
  readonly kind = AgentKind.Library;
  readonly version = '0.1.0';
  readonly minConfidence = 0.3;

  constructor(private retriever: Retriever) {
    super();
  }

  canHandle(task: Task): boolean {
    return task.intent === Intent.ReadAbout;
  }

  protected async reason(
    task: Task<LibraryInput>,
    emit: (e: OrchestratorEvent) => void,
  ): Promise<{
    data: LibraryOutput;
    confidence: number;
    evidence: string[];
    warnings: string[];
  }> {
    const payload = task.payload as Partial<LibraryInput> & { text?: string };
    const query = payload.text ?? '';
    const k = payload.topK ?? 4;

    emit({
      type: 'agent.token',
      agent: this.kind,
      token: `Searching ${this.retriever.name} for: ${query.slice(0, 60)}…`,
    });

    const result = await this.retriever.search(query, k);

    emit({
      type: 'agent.token',
      agent: this.kind,
      token: `${result.citations.length} citations · top score ${result.citations[0]?.score.toFixed(2) ?? 'n/a'}`,
    });

    const data: LibraryOutput = {
      query: result.query,
      citations: result.citations.map((c) => ({
        text: c.document.text,
        source: c.document.source,
        locator: c.document.locator,
        score: Math.round(c.score * 100) / 100,
        matchedTerms: c.matchedTerms,
      })),
      retrieverUsed: this.retriever.name,
    };

    if (result.citations.length === 0) {
      return {
        data,
        confidence: 0,
        evidence: [],
        warnings: [`no citations found for query "${query}"`],
      };
    }

    // Confidence: top-citation score normalized via sigmoid-ish saturation.
    const top = result.citations[0]?.score ?? 0;
    const confidence = Math.min(0.95, 1 - 1 / (1 + top / 4));

    return {
      data,
      confidence,
      evidence: result.citations
        .slice(0, 3)
        .map((c) => `${c.document.source}:${c.matchedTerms.join('+')}`),
      warnings: [],
    };
  }
}

// ---------------------------------------------------------------
//  Seed corpus — public-domain medical knowledge.
//  Synthesized common-knowledge summaries with citations to their
//  classic public-domain sources. Real ingestion (Gray's Anatomy 1918
//  full text, OpenStax CC-BY chapters) lands in a follow-up PR via
//  the docs/corpora/ pipeline.
// ---------------------------------------------------------------
export const SEED_CORPUS: readonly LibraryDocument[] = [
  {
    id: 'seed-001',
    text: 'The heart is a muscular organ situated obliquely within the thorax, between the lungs and behind the sternum. It pumps oxygenated blood to systemic circulation via the left ventricle and deoxygenated blood to the pulmonary circuit via the right ventricle. The myocardium is supplied by the right and left coronary arteries arising from the aorta.',
    source: "Gray's Anatomy (Henry Gray, 1918, public domain) — Cardiovascular System",
    locator: 'Section IX',
    year: 1918,
    tags: ['anatomy', 'heart', 'cardiovascular', 'myocardium', 'coronary'],
  },
  {
    id: 'seed-002',
    text: 'Acute coronary syndrome (ACS) describes a spectrum of conditions caused by sudden reduction in coronary blood flow, ranging from unstable angina to ST-elevation myocardial infarction. Classic presentation includes crushing substernal chest pain that may radiate to the left arm, jaw, or back, often accompanied by diaphoresis, nausea, and dyspnea. Immediate ECG and serial troponins are first-line investigations.',
    source: 'Synthesized from WHO ICD-10 (I20-I25) and public clinical guidelines',
    locator: 'I24.9',
    tags: ['cardiology', 'chest-pain', 'mi', 'acs', 'troponin', 'ecg'],
  },
  {
    id: 'seed-003',
    text: 'Anaphylaxis is a severe, potentially fatal systemic hypersensitivity reaction characterized by rapid onset, airway compromise, and circulatory collapse. Hallmark findings include urticaria, angioedema with throat or tongue swelling, bronchospasm, and hypotension. Intramuscular epinephrine 0.3-0.5 mg in the anterolateral thigh is the only first-line treatment; antihistamines and corticosteroids are adjunctive.',
    source: 'Synthesized from WHO ICD-10 (T78.2) and public clinical guidelines',
    locator: 'T78.2',
    tags: ['allergy', 'anaphylaxis', 'epinephrine', 'emergency'],
  },
  {
    id: 'seed-004',
    text: 'Ischemic stroke results from sudden interruption of cerebral blood flow, typically by thromboembolism. The FAST mnemonic — Face drooping, Arm weakness, Speech difficulty, Time to call emergency services — captures the most actionable bedside signs. Time-to-treatment determines outcome: tissue plasminogen activator within 4.5 hours of symptom onset is the standard reperfusion therapy in eligible patients.',
    source: 'Synthesized from WHO ICD-10 (I63) and public clinical guidelines',
    locator: 'I63',
    tags: ['neurology', 'stroke', 'cerebrovascular', 'fast', 'tpa'],
  },
  {
    id: 'seed-005',
    text: 'The cerebrum is divided into two hemispheres by the longitudinal fissure, each consisting of four principal lobes — frontal, parietal, temporal, and occipital — covered by the convoluted layer of grey matter known as the cerebral cortex. The corpus callosum is the broad band of white matter that interconnects the two hemispheres.',
    source: "Gray's Anatomy (Henry Gray, 1918, public domain) — Central Nervous System",
    locator: 'Section X',
    year: 1918,
    tags: ['anatomy', 'brain', 'cerebrum', 'cortex', 'neuroanatomy'],
  },
  {
    id: 'seed-006',
    text: 'Migraine is a recurrent primary headache disorder characterized by unilateral throbbing pain of moderate to severe intensity, lasting 4 to 72 hours, often accompanied by nausea, photophobia, and phonophobia. A subset of patients experience aura — fully reversible visual or sensory phenomena preceding the headache. First-line abortive therapy includes triptans; preventive options include beta-blockers, anticonvulsants, and CGRP antagonists.',
    source: 'Synthesized from WHO ICD-10 (G43) and public clinical guidelines',
    locator: 'G43',
    tags: ['neurology', 'headache', 'migraine', 'triptan', 'cgrp'],
  },
  {
    id: 'seed-007',
    text: 'Type 2 diabetes mellitus is a chronic disorder of carbohydrate metabolism characterized by insulin resistance and progressive beta-cell dysfunction, leading to chronic hyperglycemia. Diagnostic criteria include fasting plasma glucose at or above 126 mg/dL, HbA1c at or above 6.5 percent, or two-hour plasma glucose at or above 200 mg/dL during an oral glucose tolerance test. First-line pharmacotherapy is metformin, with stepwise addition of GLP-1 receptor agonists or SGLT2 inhibitors as comorbidities dictate.',
    source: 'Synthesized from WHO ICD-10 (E11) and public clinical guidelines',
    locator: 'E11',
    tags: ['endocrinology', 'diabetes', 'metformin', 'hba1c', 'glycemic'],
  },
];

/** Convenience factory: returns a Library Agent over the seed corpus. */
export function createSeedLibraryAgent(): LibraryAgent {
  return new LibraryAgent(new Bm25Retriever(SEED_CORPUS));
}

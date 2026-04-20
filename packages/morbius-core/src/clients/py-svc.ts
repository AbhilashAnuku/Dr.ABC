/**
 * py-svc client — typed fetch wrapper over the Python sidecar at apps/py-svc.
 *
 * No business logic lives here. Just request shapes that mirror the FastAPI
 * Pydantic models, basic timeouts, and a small in-process LRU around NER
 * (the only endpoint where the same input recurs frequently).
 *
 * Env:
 *   PY_SVC_URL — base URL, default http://localhost:8001
 *   PY_SVC_TIMEOUT_MS — per-request timeout, default 30 000 (imaging
 *     can be slow on CPU; tests should pin lower)
 */

const DEFAULT_BASE_URL = 'http://localhost:8001';
const DEFAULT_TIMEOUT_MS = 30_000;
const NER_CACHE_MAX = 64;

export interface PySvcHealth {
  ok: boolean;
  ts: number;
  uptimeSeconds: number;
  version: string;
  python: string;
  platform: string;
  loadedRouters: string[];
  /** Backend actually serving traffic — `stub` or `monai`. */
  imagingBackend: string;
  /** Backend that was requested via IMAGING_BACKEND env. May differ
   *  from `imagingBackend` when MONAI was requested but the imaging
   *  extra wasn't installed (then we fall back to stub). */
  imagingBackendRequested?: string;
}

export interface ImagingResult {
  width: number;
  height: number;
  backend: 'stub' | 'monai';
  confidence: number;
  coverageFraction: number;
  /** PNG-encoded mask, base64. Decode + overlay client-side. */
  maskPngBase64: string;
  notes: string[];
}

export interface VariantAnnotation {
  variant: string;
  geneSymbol: string;
  consequence: string;
  clinicalSignificance:
    | 'benign'
    | 'likely_benign'
    | 'vus'
    | 'likely_pathogenic'
    | 'pathogenic'
    | 'unknown';
  cadd: number | null;
  hgvsP: string | null;
  notes: string[];
}

export type EntityLabel =
  | 'DRUG'
  | 'DOSE'
  | 'CONDITION'
  | 'ANATOMY'
  | 'VITAL'
  | 'LAB'
  | 'PROCEDURE'
  | 'OTHER';

export interface NerEntity {
  text: string;
  label: EntityLabel;
  start: number;
  end: number;
  confidence: number;
}

export interface NerResponse {
  backend: 'regex' | 'scispacy';
  entities: NerEntity[];
}

export type TranslateLang = 'en' | 'de' | 'hi' | 'es' | 'fr';

export interface TranslateRequest {
  text: string;
  src: TranslateLang;
  tgt: TranslateLang;
}

export interface TranslateResponse {
  text: string;
  src: TranslateLang;
  tgt: TranslateLang;
  /** `marianmt` when transformers is installed and the model loaded;
   *  `stub` when the translate extra is missing or load failed. */
  backend: 'marianmt' | 'stub';
  /** HuggingFace model id, or "identity" when src == tgt. */
  model: string;
  latencyMs: number;
  /** Operator-facing diagnostic — empty when everything worked. */
  note?: string;
}

export interface PySvcClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

export class PySvcClient {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  private readonly nerCache = new Map<string, NerResponse>();

  constructor(opts: PySvcClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  static fromEnv(
    env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
  ): PySvcClient {
    return new PySvcClient({
      baseUrl: env.PY_SVC_URL,
      timeoutMs: env.PY_SVC_TIMEOUT_MS ? Number(env.PY_SVC_TIMEOUT_MS) : undefined,
    });
  }

  async health(): Promise<PySvcHealth> {
    return this.json<PySvcHealth>('GET', '/health');
  }

  async analyseImage(file: Blob, filename = 'upload.png'): Promise<ImagingResult> {
    const form = new FormData();
    form.append('file', file, filename);
    return this.send<ImagingResult>('POST', '/imaging/analyse', form);
  }

  async variantCall(
    variant: string,
    consequencePreference: 'coding' | 'splicing' | 'regulatory' | 'any' = 'coding',
  ): Promise<VariantAnnotation> {
    return this.json<VariantAnnotation>('POST', '/genomics/variant-call', {
      variant,
      consequencePreference,
    });
  }

  /**
   * Live translation through py-svc's MarianMT pipeline. Returns the
   * source text unchanged with `backend: 'stub'` if the translate
   * extra isn't installed or the model fails to load — caller can
   * decide whether to surface the original or a "translation
   * unavailable" hint.
   */
  async translate(req: TranslateRequest): Promise<TranslateResponse> {
    return this.json<TranslateResponse>(
      'POST',
      '/translate',
      req as unknown as Record<string, unknown>,
    );
  }

  async medicalNer(text: string, backend: 'regex' | 'scispacy' = 'regex'): Promise<NerResponse> {
    const cacheKey = `${backend}::${text}`;
    const cached = this.nerCache.get(cacheKey);
    if (cached) return cached;
    const out = await this.json<NerResponse>('POST', '/ner/medical', { text, backend });
    if (this.nerCache.size >= NER_CACHE_MAX) {
      const first = this.nerCache.keys().next().value;
      if (first !== undefined) this.nerCache.delete(first);
    }
    this.nerCache.set(cacheKey, out);
    return out;
  }

  // ---- internals ----

  private async json<T>(method: string, path: string, body?: Record<string, unknown>): Promise<T> {
    const init: RequestInit = {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    };
    return this.exec<T>(path, init);
  }

  private async send<T>(method: string, path: string, body: BodyInit): Promise<T> {
    return this.exec<T>(path, {
      method,
      body,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  private async exec<T>(path: string, init: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, init);
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`py-svc ${res.status} ${res.statusText} on ${path}: ${detail.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }
}

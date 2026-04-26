/**
 * Roboflow serverless-workflow client.
 *
 * Targets a provisioned serverless workflow:
 *   workspace  = abhilashs-workspace-qabbg
 *   workflow   = rf-detr
 *   endpoint   = https://serverless.roboflow.com/<workspace>/workflows/<workflow>
 *
 * The workflow takes an image (URL or base64) and returns object-detection
 * predictions. For Morbius's medical-imaging path we use it as the
 * front-line CV layer; the existing Claude / py-svc backends stay in
 * the cascade as fallbacks.
 *
 * No third-party SDK — the API is a plain HTTPS POST with JSON. Keeps
 * the API workspace dependency-free (still just hono + bun runtime).
 */

interface RoboflowConfig {
  apiKey: string;
  workspace: string;
  workflow: string;
}

export interface RoboflowDetection {
  class: string;
  confidence: number;
  /** Bounding box in pixels — (x, y) is the centre. */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  detection_id?: string;
}

export interface RoboflowResult {
  predictions: RoboflowDetection[];
  /** Raw response in case caller wants the unfiltered shape. */
  raw: unknown;
  /** Workflow latency on the Roboflow side, ms. */
  serverLatencyMs?: number;
}

/**
 * Read the Roboflow config from `effectiveEnv()` style maps (the API
 * server's runtime-env overlay) OR from process.env. Returns null
 * when any of the three required values is missing — callers should
 * fall through to the next backend in the imaging cascade.
 */
export function readRoboflowConfig(
  env: Partial<Record<string, string>> = process.env,
): RoboflowConfig | null {
  const apiKey = env.ROBOFLOW_API_KEY;
  const workspace = env.ROBOFLOW_WORKSPACE;
  const workflow = env.ROBOFLOW_WORKFLOW;
  if (!apiKey || !workspace || !workflow) return null;
  return { apiKey, workspace, workflow };
}

/**
 * Call the workflow with a URL-hosted image. Use this when the
 * uploaded image is already reachable from the public web (e.g.,
 * a DermAtlas / ISIC link).
 */
export async function roboflowAnalyseUrl(
  cfg: RoboflowConfig,
  imageUrl: string,
): Promise<RoboflowResult> {
  return roboflowCall(cfg, { type: 'url', value: imageUrl });
}

/**
 * Call the workflow with an inline base64 image. Use this when the
 * clinic page uploads a local file — the api server holds the bytes
 * and forwards them inline so they never need a public URL.
 */
export async function roboflowAnalyseBase64(
  cfg: RoboflowConfig,
  base64: string,
): Promise<RoboflowResult> {
  return roboflowCall(cfg, { type: 'base64', value: base64 });
}

interface ImageInput {
  type: 'url' | 'base64';
  value: string;
}

async function roboflowCall(cfg: RoboflowConfig, image: ImageInput): Promise<RoboflowResult> {
  const url = `https://serverless.roboflow.com/${cfg.workspace}/workflows/${cfg.workflow}`;
  const startedAt = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: cfg.apiKey,
      inputs: { image },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Roboflow ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  const elapsedMs = Date.now() - startedAt;

  // The serverless workflow wraps the model output under
  // `outputs[0].predictions.predictions` for object-detection models.
  // We defensively flatten so the caller gets a plain array.
  const predictions = extractPredictions(json);
  return { predictions, raw: json, serverLatencyMs: elapsedMs };
}

function extractPredictions(json: unknown): RoboflowDetection[] {
  if (!json || typeof json !== 'object') return [];
  const root = json as Record<string, unknown>;
  // Newer workflows: { outputs: [{ predictions: { predictions: [...] } }] }
  const outputs = root.outputs;
  if (Array.isArray(outputs) && outputs.length > 0) {
    for (const o of outputs) {
      const out = o as Record<string, unknown>;
      const predictionsBlock = out.predictions;
      if (Array.isArray(predictionsBlock)) return predictionsBlock as RoboflowDetection[];
      if (predictionsBlock && typeof predictionsBlock === 'object') {
        const inner = (predictionsBlock as Record<string, unknown>).predictions;
        if (Array.isArray(inner)) return inner as RoboflowDetection[];
      }
    }
  }
  // Older shape: { predictions: [...] }
  if (Array.isArray(root.predictions)) return root.predictions as RoboflowDetection[];
  return [];
}

import { demoFitnessSnapshot } from './demo.ts';
import { GoogleFitClient } from './google-fit.ts';
import type { FitnessSnapshot } from './index.ts';

/**
 * One-shot factory used by the API server. Token precedence:
 *   1. explicit `token` arg (request-scoped — preferred path)
 *   2. GOOGLE_FIT_TOKEN env (set in `.env` for the dev box)
 *   3. demo snapshot (no creds anywhere)
 */
export async function fitnessSnapshotFromEnv(
  opts: {
    token?: string | null;
    env?: Record<string, string | undefined>;
  } = {},
): Promise<FitnessSnapshot> {
  const env = opts.env ?? (process.env as Record<string, string | undefined>);
  const token = opts.token || env.GOOGLE_FIT_TOKEN;
  if (!token) return demoFitnessSnapshot();
  const client = new GoogleFitClient({ token });
  return client.snapshot();
}

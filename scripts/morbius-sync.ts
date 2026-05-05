/**
 * morbius-sync -- one-shot pull of the latest shared-branch state from origin.
 *
 * Keeps a working clone up to date without the operator having to remember
 * which git command to use.
 *
 * What it does:
 *   1. git fetch origin
 *   2. If the current branch is the shared branch (configurable via
 *      DR_ABC_SYNC_BRANCH), git pull --ff-only.
 *   3. If the current branch is different, git merge --no-edit
 *      origin/<shared-branch> into the current branch -- so a feature
 *      branch stays itself but absorbs all the new shared commits.
 *   4. Reports a one-line summary: "X new commits absorbed" or
 *      "already up to date".
 *
 * Run:
 *   bun run morbius:sync
 *
 * Watch mode (poll every 60s):
 *   bun run morbius:sync --watch
 *
 * Override the source branch (default main):
 *   DR_ABC_SYNC_BRANCH=feat/some-other-branch bun run morbius:sync
 */
import { spawnSync } from 'node:child_process';

const SOURCE_BRANCH = process.env.DR_ABC_SYNC_BRANCH ?? 'main';
const WATCH = process.argv.includes('--watch');
const POLL_MS = 60_000;

function git(args: string[]): { stdout: string; stderr: string; ok: boolean } {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  return {
    stdout: (r.stdout ?? '').trim(),
    stderr: (r.stderr ?? '').trim(),
    ok: r.status === 0,
  };
}

function currentBranch(): string | null {
  const r = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!r.ok) return null;
  return r.stdout || null;
}

function countCommitsBehind(branch: string, remote: string): number | null {
  const r = git(['rev-list', '--count', `${branch}..${remote}`]);
  if (!r.ok) return null;
  const n = Number(r.stdout);
  return Number.isFinite(n) ? n : null;
}

async function pullOnce(): Promise<void> {
  const branch = currentBranch();
  if (!branch) {
    console.error('[sync] not in a git repo');
    process.exit(1);
  }
  console.log(`[sync] current branch: ${branch}  (source: origin/${SOURCE_BRANCH})`);

  const fetched = git(['fetch', 'origin', SOURCE_BRANCH]);
  if (!fetched.ok) {
    console.error(`[sync] git fetch failed: ${fetched.stderr || 'unknown error'}`);
    return;
  }

  const remoteRef = `origin/${SOURCE_BRANCH}`;
  const behind = countCommitsBehind(branch, remoteRef);
  if (behind === null) {
    console.error(`[sync] could not compute lag against ${remoteRef}`);
    return;
  }
  if (behind === 0) {
    console.log('[sync] already up to date');
    return;
  }

  if (branch === SOURCE_BRANCH) {
    const pulled = git(['pull', '--ff-only', 'origin', SOURCE_BRANCH]);
    if (!pulled.ok) {
      console.error(`[sync] fast-forward pull failed:\n${pulled.stderr}`);
      console.error('[sync] you may have local commits ahead of origin; resolve manually');
      return;
    }
    console.log(`[sync] absorbed ${behind} new commit${behind === 1 ? '' : 's'}`);
    return;
  }

  // Different branch (e.g. Final-v1.0.18 on V5): merge the source
  // branch in. --no-edit accepts the default merge commit message.
  const merged = git(['merge', '--no-edit', remoteRef]);
  if (!merged.ok) {
    console.error(`[sync] merge from ${remoteRef} into ${branch} failed:\n${merged.stderr}`);
    console.error('[sync] resolve conflicts manually and re-run');
    return;
  }
  console.log(
    `[sync] merged ${behind} new commit${behind === 1 ? '' : 's'} from ${remoteRef} into ${branch}`,
  );
}

async function main(): Promise<void> {
  if (!WATCH) {
    await pullOnce();
    return;
  }
  console.log(`[sync] watch mode -- polling every ${POLL_MS / 1000}s. Ctrl+C to stop.`);
  // Run once immediately, then on interval.
  await pullOnce();
  setInterval(() => {
    void pullOnce();
  }, POLL_MS);
  // Keep the process alive in watch mode.
  await new Promise(() => {});
}

main().catch((err) => {
  console.error('[sync] failed:', err);
  process.exit(1);
});

/**
 * morbius-screenshot-tour -- walks every public + signed-in route at
 * http://localhost:5173, captures a full-page screenshot, scrapes any
 * console errors, and emits an HTML report at
 *   docs/status/screenshot-tour-YYYY-MM-DD.html
 *
 * Purpose: open every link and route in the site, screenshot each
 * labeled page, re-check, and emit a report with all screenshots
 * (HTML / file / PDF) so errors can be triaged and fixed.
 *
 * Prereqs (run once):
 *   bun add -d playwright
 *   bunx playwright install chromium
 *
 * Run:
 *   bun run morbius:tour
 *
 * Optional flags:
 *   --base=http://192.168.1.5:5173    point at LAN IP (default localhost)
 *   --auth                            sign in as the demo user first
 *
 * Output:
 *   docs/status/screenshot-tour-<date>/<route>.png  (one per route)
 *   docs/status/screenshot-tour-<date>.html         (the report itself)
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface RouteSpec {
  path: string;
  label: string;
  /** Public (no auth needed) or app (requires demo sign-in). */
  scope: 'public' | 'app';
}

const ROUTES: RouteSpec[] = [
  { path: '/', label: 'Landing', scope: 'public' },
  { path: '/login', label: 'Login', scope: 'public' },
  { path: '/signup', label: 'Sign up', scope: 'public' },
  { path: '/forgot-password', label: 'Forgot password', scope: 'public' },
  { path: '/app', label: 'Dashboard', scope: 'app' },
  { path: '/app/clinic', label: 'Clinic (consultation)', scope: 'app' },
  { path: '/app/case-library', label: 'Case library', scope: 'app' },
  { path: '/app/imaging', label: 'Imaging', scope: 'app' },
  { path: '/app/brain', label: 'Brain map', scope: 'app' },
  { path: '/app/neural-core', label: 'Neural core', scope: 'app' },
  { path: '/app/dev-console', label: 'Dev console', scope: 'app' },
  { path: '/app/architecture', label: 'Architecture', scope: 'app' },
  { path: '/app/agents-room', label: 'Agents room', scope: 'app' },
  { path: '/app/scribe', label: 'AI Scribe', scope: 'app' },
  { path: '/app/api-keys', label: 'API keys', scope: 'app' },
  { path: '/app/appointments', label: 'Appointments', scope: 'app' },
  { path: '/app/wellness', label: 'Wellness', scope: 'app' },
  { path: '/app/profile', label: 'Profile / records', scope: 'app' },
  { path: '/app/settings', label: 'Settings', scope: 'app' },
];

interface TourEntry {
  spec: RouteSpec;
  status: 'ok' | 'console-errors' | 'navigation-error';
  screenshotPath: string;
  consoleErrors: string[];
  pageTitle: string;
  durationMs: number;
}

// Minimal type stubs so the file typechecks without `playwright` installed.
// The real module is dynamic-imported and these shapes match Playwright's
// public surface for the methods we actually call. When playwright IS
// installed, runtime behaviour is identical -- we just don't pull the
// proper types in CI where the optional dev dep is absent.
interface PwConsoleMessage {
  type(): string;
  text(): string;
}
interface PwPage {
  on(event: 'console', cb: (msg: PwConsoleMessage) => void): void;
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  waitForURL(url: RegExp | string, opts?: { timeout?: number }): Promise<unknown>;
  title(): Promise<string>;
  screenshot(opts: { path: string; fullPage?: boolean }): Promise<unknown>;
  close(): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
}
interface PwContext {
  newPage(): Promise<PwPage>;
}
interface PwBrowser {
  newContext(opts?: { viewport?: { width: number; height: number } }): Promise<PwContext>;
  close(): Promise<void>;
}
interface PwPlaywright {
  chromium: { launch(opts?: { headless?: boolean }): Promise<PwBrowser> };
}

function parseArgs(): { baseUrl: string; auth: boolean } {
  const args = process.argv.slice(2);
  const baseArg = args.find((a) => a.startsWith('--base='));
  return {
    baseUrl: baseArg ? baseArg.slice('--base='.length) : 'http://localhost:5173',
    auth: args.includes('--auth'),
  };
}

async function main(): Promise<void> {
  // Dynamic import so the file typechecks without playwright installed.
  // Cast to the minimal local stubs (see PwPlaywright above) so CI does
  // not need @types/playwright to resolve the type.
  // @ts-ignore optional dev dep, may not be installed in CI
  const pwModule = (await import('playwright').catch(() => null)) as unknown;
  const playwright = pwModule as PwPlaywright | null;
  if (!playwright) {
    console.error('[tour] playwright not installed.');
    console.error('[tour] one-time setup:');
    console.error('[tour]   bun add -d playwright');
    console.error('[tour]   bunx playwright install chromium');
    process.exit(1);
  }

  const { baseUrl, auth } = parseArgs();
  const today = new Date().toISOString().slice(0, 10);
  const repoRoot = resolve(import.meta.dir, '..');
  const reportDir = resolve(repoRoot, 'docs', 'status', `screenshot-tour-${today}`);
  if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });

  console.log(`[tour] base: ${baseUrl}`);
  console.log(`[tour] auth: ${auth ? 'demo sign-in' : 'public-only'}`);
  console.log(`[tour] output: ${reportDir}`);

  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  // Optional demo sign-in: post to /api/auth/signin and persist cookies.
  if (auth) {
    const page0 = await context.newPage();
    await page0.goto(`${baseUrl}/login`);
    await page0.fill('input[type="email"]', 'abhilashanuku14@gmail.com');
    await page0.fill('input[type="password"]', 'demo-password-12');
    await page0.click('button[type="submit"]');
    await page0.waitForURL(/\/app/, { timeout: 10_000 }).catch(() => undefined);
    await page0.close();
  }

  const entries: TourEntry[] = [];

  for (const spec of ROUTES) {
    if (spec.scope === 'app' && !auth) {
      console.log(`[tour] skip ${spec.path} (no --auth flag)`);
      continue;
    }
    const consoleErrors: string[] = [];
    const page = await context.newPage();
    page.on('console', (m: PwConsoleMessage) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });

    const t0 = Date.now();
    let status: TourEntry['status'] = 'ok';
    try {
      await page.goto(`${baseUrl}${spec.path}`, {
        waitUntil: 'networkidle',
        timeout: 20_000,
      });
      await page.waitForTimeout(500); // settle animations
    } catch (err) {
      status = 'navigation-error';
      const msg = err instanceof Error ? err.message : String(err);
      consoleErrors.push(`navigation failed: ${msg}`);
    }

    const pageTitle = await page.title().catch(() => spec.label);
    const safeName = spec.path.replace(/[^A-Za-z0-9]+/g, '_') || 'root';
    const screenshotPath = resolve(reportDir, `${safeName}.png`);
    try {
      await page.screenshot({ path: screenshotPath, fullPage: true });
    } catch {
      // best-effort
    }

    if (status === 'ok' && consoleErrors.length > 0) status = 'console-errors';
    entries.push({
      spec,
      status,
      screenshotPath,
      consoleErrors,
      pageTitle,
      durationMs: Date.now() - t0,
    });
    console.log(
      `[tour] ${status === 'ok' ? 'OK' : '!!'} ${spec.path}  (${Date.now() - t0}ms, ${consoleErrors.length} errors)`,
    );
    await page.close();
  }

  await browser.close();

  // Build the HTML report.
  const html = buildReport({ baseUrl, auth, entries, today, reportDir });
  const reportPath = resolve(repoRoot, 'docs', 'status', `screenshot-tour-${today}.html`);
  writeFileSync(reportPath, html, 'utf8');

  console.log('');
  console.log('[tour] complete');
  console.log(`[tour]   ${entries.length} routes captured`);
  console.log(`[tour]   ${entries.filter((e) => e.status !== 'ok').length} with errors`);
  console.log(`[tour]   open: ${reportPath}`);
}

function buildReport(args: {
  baseUrl: string;
  auth: boolean;
  entries: TourEntry[];
  today: string;
  reportDir: string;
}): string {
  const { baseUrl, auth, entries, today, reportDir } = args;
  const okCount = entries.filter((e) => e.status === 'ok').length;
  const errCount = entries.length - okCount;

  const itemHtml = entries
    .map((e) => {
      const relPng = e.screenshotPath
        .replace(reportDir, `screenshot-tour-${today}`)
        .replace(/\\/g, '/');
      const errBlock =
        e.consoleErrors.length > 0
          ? `<details class="errs"><summary>${e.consoleErrors.length} console error${e.consoleErrors.length === 1 ? '' : 's'}</summary><pre>${e.consoleErrors.map((s) => s.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))).join('\n')}</pre></details>`
          : '<span class="ok">no errors</span>';
      return `
  <article class="route ${e.status}">
    <header>
      <h2><code>${e.spec.path}</code> · ${e.spec.label}</h2>
      <span class="meta">${e.spec.scope} · ${e.durationMs}ms · ${e.pageTitle}</span>
    </header>
    <img src="${relPng}" alt="${e.spec.label} screenshot" loading="lazy" />
    ${errBlock}
  </article>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Mörbius screenshot tour · ${today}</title>
  <style>
    :root {
      --bg: #0b0f14; --fg: #e8eef5; --muted: #8fa1b3; --ok: #34d399; --err: #f87171; --line: #1f2a36;
    }
    body { margin: 0; background: var(--bg); color: var(--fg); font-family: 'Inter', system-ui, sans-serif; }
    header.top { padding: 32px 48px; border-bottom: 1px solid var(--line); }
    header.top h1 { margin: 0 0 6px; font-size: 28px; }
    header.top p { margin: 4px 0; color: var(--muted); font-size: 13px; }
    .stats { display: inline-flex; gap: 16px; margin-top: 12px; font-family: 'JetBrains Mono', monospace; font-size: 12px; }
    .stat-ok { color: var(--ok); }
    .stat-err { color: var(--err); }
    main { padding: 24px 48px; display: grid; grid-template-columns: 1fr; gap: 24px; max-width: 1600px; margin: 0 auto; }
    article.route { background: #11161d; border: 1px solid var(--line); border-radius: 10px; padding: 18px; }
    article.route.console-errors { border-color: var(--err); }
    article.route.navigation-error { border-color: var(--err); background: #1a0f10; }
    article.route header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; margin-bottom: 12px; }
    article.route h2 { margin: 0; font-size: 16px; }
    article.route code { background: #0b0f14; padding: 2px 6px; border-radius: 4px; font-size: 13px; color: var(--ok); }
    article.route .meta { color: var(--muted); font-family: 'JetBrains Mono', monospace; font-size: 11px; }
    article.route img { width: 100%; border-radius: 8px; border: 1px solid var(--line); display: block; }
    .ok { color: var(--ok); font-size: 12px; }
    details.errs { margin-top: 12px; background: #0b0f14; border-radius: 6px; padding: 8px 12px; }
    details.errs summary { cursor: pointer; color: var(--err); font-size: 13px; }
    details.errs pre { color: var(--err); font-size: 11px; overflow-x: auto; }
  </style>
</head>
<body>
  <header class="top">
    <h1>Mörbius screenshot tour</h1>
    <p>Built ${new Date().toISOString()} · base <code>${baseUrl}</code> · auth ${auth ? 'demo sign-in' : 'public-only'}</p>
    <div class="stats">
      <span class="stat-ok">OK ${okCount}</span>
      <span class="stat-err">errors ${errCount}</span>
    </div>
  </header>
  <main>${itemHtml}</main>
</body>
</html>`;
}

main().catch((err) => {
  console.error('[tour] failed:', err);
  process.exit(1);
});

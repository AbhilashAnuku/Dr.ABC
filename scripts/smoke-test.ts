#!/usr/bin/env bun
/**
 * Spine smoke test — verifies the orchestrator + agents work end-to-end
 * without needing the API server or any external services.
 *
 * Run with:  bun run scripts/smoke-test.ts
 */
import {
  DEMO_PATIENT_HASH,
  TriageAgent,
  ValidatorAgent,
  createDemoProfileAgent,
  createSeedLibraryAgent,
  tryCreateDiagnosticAgent,
} from '@dr-abc/agents';
import { AgentRegistry, Morbius } from '@dr-abc/morbius-core';
import type { OrchestratorEvent, TaskContext } from '@dr-abc/types';

const SCENARIOS = [
  { label: 'Acute MI', text: 'crushing chest pain radiating to my left arm' },
  { label: 'Anaphylaxis', text: 'my throat is closing, swelling tongue, hard to breathe' },
  { label: 'Stroke', text: 'sudden face droop and slurred speech' },
  { label: 'Routine', text: 'dull headache for three days' },
  { label: 'Ambiguous', text: 'just feeling off lately' },
  // Library scenarios — pick keywords that don't collide with the
  // emergency-keyword shortcut in the intent classifier.
  { label: 'Library: migraine', text: 'tell me about migraine treatment' },
  { label: 'Library: diabetes', text: 'what is type 2 diabetes hba1c diagnostic criteria' },
  // Profile scenario — exercises ProfileAgent with the demo bundle.
  // Phrasing avoids 'show me' (anatomy-show keyword) so the intent
  // classifier lands on ProfileOp via 'my profile'/'allergy'/'history' hits.
  { label: 'Profile: my profile', text: 'my profile — list my allergy history and insurance' },
];

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

const C = COLORS;

function paint(event: OrchestratorEvent): string {
  switch (event.type) {
    case 'task.created':
      return `${C.cyan}◇ task.created${C.reset} ${C.dim}intent=${event.task.intent} priority=${event.task.priority}${C.reset}`;
    case 'agent.started':
      return `${C.green}▶ ${event.agent}${C.reset}`;
    case 'agent.token':
      return `  ${C.dim}~ ${event.token}${C.reset}`;
    case 'agent.completed': {
      const r = event.result;
      const conf = (r.confidence * 100).toFixed(0);
      const tone = r.verdict === 'pass' ? C.green : C.yellow;
      return `${tone}✓ ${r.agent} ${r.verdict}${C.reset} ${C.dim}(${conf}% · ${r.cost.ms}ms)${C.reset}\n    ${C.bold}data:${C.reset} ${JSON.stringify(r.data)}\n    ${C.dim}evidence: ${r.evidence.join(', ') || '—'}${C.reset}`;
    }
    case 'agent.failed':
      return `${C.red}✗ ${event.agent} failed${C.reset} — ${event.error}`;
    case 'validation.passed':
      return `${C.green}  └ gate passed${C.reset}`;
    case 'validation.failed':
      return `${C.yellow}  └ gate failed: ${event.reason}${C.reset}`;
    case 'pipeline.completed':
      return `${C.magenta}★ pipeline.completed${C.reset}`;
    case 'pipeline.aborted':
      return `${C.red}! pipeline.aborted: ${event.reason}${C.reset}`;
    case 'evidence.found':
      return `${C.cyan}§ ${event.agent} · ${event.evidence.length} citations${C.reset}`;
  }
}

async function runScenario(morbius: Morbius, label: string, text: string) {
  console.log(`\n${C.bold}${C.cyan}━━ ${label}${C.reset} ${C.dim}"${text}"${C.reset}`);

  const context: TaskContext = {
    sessionId: crypto.randomUUID(),
    // Bind the smoke session to the demo patient so ProfileAgent can
    // resolve a default `read` action when no explicit action is on the payload.
    patientIdHash: DEMO_PATIENT_HASH,
    purposeOfUse: 'TREATMENT',
    consentToken: null,
    locale: 'en-US',
    deviceClass: 'web',
  };

  let eventCount = 0;
  const t0 = performance.now();

  for await (const event of morbius.orchestrate({ text, context, deadlineMs: 5000 })) {
    console.log(paint(event));
    eventCount++;
  }

  const ms = (performance.now() - t0).toFixed(1);
  console.log(`${C.dim}  → ${eventCount} events in ${ms}ms${C.reset}`);
}

async function main() {
  console.log(
    `${C.bold}${C.magenta}\n  ⌬  MÖRBIUS SPINE SMOKE TEST  ⌬${C.reset}\n  ${C.dim}Bootstrapping agent mesh...${C.reset}`,
  );

  const registry = new AgentRegistry()
    .register(new TriageAgent())
    .register(new ValidatorAgent())
    .register(createSeedLibraryAgent())
    .register(createDemoProfileAgent());

  const diagnostic = tryCreateDiagnosticAgent({
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
  });
  if (diagnostic) {
    registry.register(diagnostic);
  } else {
    console.log(
      `  ${C.yellow}⚠ DiagnosticAgent disabled — set ANTHROPIC_API_KEY to enable real differential diagnosis.${C.reset}`,
    );
  }

  console.log(
    `  ${C.dim}registered:${C.reset} ${registry
      .list()
      .map((a) => `${C.cyan}${a.kind}${C.reset}@${a.version}`)
      .join(', ')}`,
  );

  const morbius = new Morbius(registry);

  for (const s of SCENARIOS) {
    await runScenario(morbius, s.label, s.text);
  }

  console.log(`\n${C.bold}${C.green}  ✓ Spine smoke test complete.${C.reset}\n`);
}

main().catch((err) => {
  console.error(`${C.red}FATAL${C.reset}`, err);
  process.exit(1);
});

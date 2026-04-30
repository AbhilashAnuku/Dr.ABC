import { describe, expect, it } from 'bun:test';
import { type SystemComponent, __test } from './system-flow.tsx';

const { partitionByKind, STATUS_TONE } = __test;

describe('partitionByKind', () => {
  it('groups components into the five canonical buckets', () => {
    const inp: SystemComponent[] = [
      { component: 'anthropic', kind: 'provider', status: 'ok' },
      { component: 'nvidia-nim', kind: 'provider', status: 'skipped' },
      { component: 'ollama', kind: 'container', status: 'down' },
      { component: 'postgres', kind: 'container', status: 'ok' },
      { component: 'triage', kind: 'agent', status: 'ok' },
      { component: 'diagnostic', kind: 'agent', status: 'ok' },
      { component: 'activity-sink', kind: 'sink', status: 'ok' },
    ];
    const out = partitionByKind(inp);
    expect(out.provider.map((c) => c.component)).toEqual(['anthropic', 'nvidia-nim']);
    expect(out.container.map((c) => c.component)).toEqual(['ollama', 'postgres']);
    expect(out.agent.length).toBe(2);
    expect(out.sink.map((c) => c.component)).toEqual(['activity-sink']);
    expect(out.frontend).toEqual([]);
  });

  it('returns empty arrays when given an empty list', () => {
    const out = partitionByKind([]);
    expect(out.provider).toEqual([]);
    expect(out.container).toEqual([]);
    expect(out.agent).toEqual([]);
    expect(out.sink).toEqual([]);
    expect(out.frontend).toEqual([]);
  });

  it('preserves order within each bucket', () => {
    const inp: SystemComponent[] = [
      { component: 'a1', kind: 'agent', status: 'ok' },
      { component: 'a2', kind: 'agent', status: 'ok' },
      { component: 'a3', kind: 'agent', status: 'ok' },
    ];
    expect(partitionByKind(inp).agent.map((c) => c.component)).toEqual(['a1', 'a2', 'a3']);
  });
});

describe('STATUS_TONE', () => {
  it('has a tone for every status', () => {
    expect(STATUS_TONE.ok.dot).toBe('bio');
    expect(STATUS_TONE.skipped.dot).toBe('amber');
    expect(STATUS_TONE.down.dot).toBe('rose');
  });
  it('every tone has a non-empty ring + chip class', () => {
    for (const s of ['ok', 'skipped', 'down'] as const) {
      expect(STATUS_TONE[s].ring.length).toBeGreaterThan(0);
      expect(STATUS_TONE[s].chip.length).toBeGreaterThan(0);
    }
  });
});

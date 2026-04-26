import { describe, expect, it } from 'bun:test';
import { type ActivityEntry, MemoryActivitySink, pickActivitySink } from './activity-sink.ts';

function entry(over: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: over.id ?? crypto.randomUUID(),
    ts: over.ts ?? Date.now(),
    role: over.role ?? 'patient',
    userId: over.userId ?? 'usr_1',
    route: over.route ?? '/app/clinic',
    action: over.action ?? 'consult.submit',
    payload: over.payload,
    latencyMs: over.latencyMs,
    status: over.status,
  };
}

describe('MemoryActivitySink', () => {
  it('returns newest-first on query', async () => {
    const sink = new MemoryActivitySink();
    await sink.write(entry({ ts: 1000, action: 'a' }));
    await sink.write(entry({ ts: 2000, action: 'b' }));
    await sink.write(entry({ ts: 3000, action: 'c' }));
    const rows = await sink.query({});
    expect(rows.map((r) => r.action)).toEqual(['c', 'b', 'a']);
  });

  it('caps the buffer + drops oldest', async () => {
    const sink = new MemoryActivitySink(3);
    for (let i = 0; i < 5; i++) {
      await sink.write(entry({ ts: i, action: `a${i}` }));
    }
    expect(sink.size).toBe(3);
    const rows = await sink.query({});
    // newest 3 of [a0..a4] are a4, a3, a2
    expect(rows.map((r) => r.action)).toEqual(['a4', 'a3', 'a2']);
  });

  it('filters by role + route + action substring + status + time window', async () => {
    const sink = new MemoryActivitySink();
    await sink.write(
      entry({
        ts: 100,
        role: 'patient',
        route: '/app/clinic',
        action: 'consult.submit',
        status: 'ok',
      }),
    );
    await sink.write(
      entry({ ts: 200, role: 'doctor', route: '/app/clinic', action: 'rx.signed', status: 'ok' }),
    );
    await sink.write(
      entry({
        ts: 300,
        role: 'developer',
        route: '/app/lab',
        action: 'lab.train.run',
        status: 'error',
      }),
    );
    await sink.write(
      entry({
        ts: 400,
        role: 'patient',
        route: '/app/clinic',
        action: 'consult.completed',
        status: 'ok',
      }),
    );

    expect((await sink.query({ role: 'doctor' })).map((r) => r.action)).toEqual(['rx.signed']);
    expect((await sink.query({ route: '/app/lab' })).map((r) => r.action)).toEqual([
      'lab.train.run',
    ]);
    expect((await sink.query({ action: 'consult' })).map((r) => r.action)).toEqual([
      'consult.completed',
      'consult.submit',
    ]);
    expect((await sink.query({ status: 'error' })).map((r) => r.action)).toEqual(['lab.train.run']);
    expect((await sink.query({ since: 150, until: 350 })).map((r) => r.action)).toEqual([
      'lab.train.run',
      'rx.signed',
    ]);
  });

  it('honours the limit', async () => {
    const sink = new MemoryActivitySink();
    for (let i = 0; i < 10; i++) {
      await sink.write(entry({ ts: i, action: `a${i}` }));
    }
    expect((await sink.query({ limit: 4 })).length).toBe(4);
  });

  it('tail() yields entries written after subscription', async () => {
    const sink = new MemoryActivitySink();
    await sink.write(entry({ action: 'pre' })); // before subscription — should not appear

    const ac = new AbortController();
    const seen: string[] = [];
    const consumer = (async () => {
      for await (const e of sink.tail({ signal: ac.signal })) {
        seen.push(e.action);
        if (seen.length === 2) {
          ac.abort();
          break;
        }
      }
    })();

    // Yield to the runtime so the tail iterator is armed before we write.
    await new Promise((r) => setTimeout(r, 5));
    await sink.write(entry({ action: 'live-1' }));
    await sink.write(entry({ action: 'live-2' }));
    await consumer;
    expect(seen).toEqual(['live-1', 'live-2']);
  });
});

describe('pickActivitySink', () => {
  it('returns memory sink when DATABASE_URL is unset', () => {
    expect(pickActivitySink({}).name).toBe('memory');
    expect(pickActivitySink({ DATABASE_URL: '' }).name).toBe('memory');
  });
  it('returns the pgvector-named sink when DATABASE_URL is set', () => {
    expect(pickActivitySink({ DATABASE_URL: 'postgres://x' }).name).toBe('pgvector');
  });
});

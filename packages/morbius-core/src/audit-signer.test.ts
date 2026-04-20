import { describe, expect, test } from 'bun:test';
import { AuditSigner } from './audit-signer.ts';

describe('audit-signer · sign + verify roundtrip', () => {
  test('signs and verifies a single entry', async () => {
    const signer = new AuditSigner();
    const signed = await signer.sign({
      id: 'consult-1',
      ts: '2026-05-03T10:00:00Z',
      kind: 'consult',
      userId: 'demo',
      payload: { complaint: 'chest pain', topCondition: 'Acute MI' },
    });
    expect(signed.signature).toBeTruthy();
    expect(signed.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(signed.prevHash).toBe('0'.repeat(64));
    const r = await signer.verifyOne(signed);
    expect(r.ok).toBe(true);
  });

  test('chains multiple entries — prevHash links them', async () => {
    const signer = new AuditSigner();
    const a = await signer.sign({
      id: '1',
      ts: '2026-05-03T10:00:00Z',
      kind: 'consult',
      userId: 'demo',
      payload: {},
    });
    const b = await signer.sign({
      id: '2',
      ts: '2026-05-03T10:01:00Z',
      kind: 'rx',
      userId: 'demo',
      payload: {},
    });
    expect(b.prevHash).toBe(a.hash);
    const chain = await signer.verifyChain([a, b]);
    expect(chain.ok).toBe(true);
    if (chain.ok) expect(chain.length).toBe(2);
  });

  test('detects tampering — entry payload changed', async () => {
    const signer = new AuditSigner();
    const signed = await signer.sign({
      id: 'consult-2',
      ts: '2026-05-03T10:00:00Z',
      kind: 'consult',
      userId: 'demo',
      payload: { complaint: 'chest pain' },
    });
    // Tamper the payload
    const tampered = {
      ...signed,
      payload: { complaint: 'headache' },
    };
    const r = await signer.verifyOne(tampered);
    expect(r.ok).toBe(false);
  });

  test('detects tampering — chain prevHash broken', async () => {
    const signer = new AuditSigner();
    const a = await signer.sign({
      id: '1',
      ts: '2026-05-03T10:00:00Z',
      kind: 'consult',
      userId: 'demo',
      payload: {},
    });
    const b = await signer.sign({
      id: '2',
      ts: '2026-05-03T10:01:00Z',
      kind: 'rx',
      userId: 'demo',
      payload: {},
    });
    // Inject a bogus prevHash
    const broken = { ...b, prevHash: '0'.repeat(64) };
    const chain = await signer.verifyChain([a, broken]);
    expect(chain.ok).toBe(false);
  });

  test('canonical-JSON: same payload → same signature regardless of key order', async () => {
    const signer = new AuditSigner();
    const a = await signer.sign({
      id: 'x',
      ts: '2026-05-03T10:00:00Z',
      kind: 'consult',
      userId: 'demo',
      payload: { a: 1, b: 2, c: 3 },
    });
    // Re-create with reversed key order — should produce identical hash
    signer.resetChain();
    const b = await signer.sign({
      id: 'x',
      ts: '2026-05-03T10:00:00Z',
      kind: 'consult',
      userId: 'demo',
      payload: { c: 3, b: 2, a: 1 },
    });
    expect(b.hash).toBe(a.hash);
  });
});

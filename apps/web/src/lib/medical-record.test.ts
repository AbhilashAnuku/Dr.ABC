import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  addRecordEntry,
  emptyRecord,
  loadRecord,
  newId,
  removeRecordEntry,
  saveRecord,
} from './medical-record.ts';

/**
 * Pins the per-user isolation invariant: User A's record must never
 * leak into User B's storage slot. This is the hard constraint that
 * makes Mörbius safe as a memory agent — every persisted byte is
 * keyed by `${STORAGE_PREFIX}${userId}`, nothing else.
 */

class FakeStorage {
  private store = new Map<string, string>();
  getItem(k: string) {
    return this.store.has(k) ? (this.store.get(k) ?? null) : null;
  }
  setItem(k: string, v: string) {
    this.store.set(k, v);
  }
  removeItem(k: string) {
    this.store.delete(k);
  }
  clear() {
    this.store.clear();
  }
  keys(): string[] {
    return Array.from(this.store.keys());
  }
}

const fakeStorage = new FakeStorage();

beforeEach(() => {
  fakeStorage.clear();
  // biome-ignore lint/suspicious/noExplicitAny: minimal Storage shim for tests
  (globalThis as any).window = { localStorage: fakeStorage };
});

afterEach(() => {
  // biome-ignore lint/suspicious/noExplicitAny: cleanup
  (globalThis as any).window = undefined;
});

describe('medical-record per-user isolation', () => {
  test('saveRecord writes under a user-prefixed key', () => {
    const r = emptyRecord('alice', 'Alice');
    saveRecord(r);
    const keys = fakeStorage.keys();
    expect(keys.length).toBe(1);
    expect(keys[0]).toContain('alice');
    expect(keys[0]).not.toContain('bob');
  });

  test('two users round-trip to disjoint storage slots', () => {
    const a = emptyRecord('alice', 'Alice');
    const b = emptyRecord('bob', 'Bob');
    a.fullName = 'Alice Allergic';
    b.fullName = 'Bob Bypass';
    saveRecord(a);
    saveRecord(b);
    expect(fakeStorage.keys().length).toBe(2);
    const aBack = loadRecord('alice');
    const bBack = loadRecord('bob');
    expect(aBack?.fullName).toBe('Alice Allergic');
    expect(bBack?.fullName).toBe('Bob Bypass');
    // Cross-load must return null, not the other user's record.
    expect(loadRecord('eve')).toBeNull();
  });

  test('addRecordEntry on alice does not mutate bob', () => {
    saveRecord(emptyRecord('alice', 'Alice'));
    saveRecord(emptyRecord('bob', 'Bob'));
    const a = loadRecord('alice');
    if (!a) throw new Error('alice missing');
    const updated = addRecordEntry(a, 'allergies', {
      id: newId(),
      substance: 'Penicillin',
      severity: 'severe',
    });
    saveRecord(updated);

    const aFinal = loadRecord('alice');
    const bFinal = loadRecord('bob');
    expect(aFinal?.allergies.length).toBe(1);
    expect(bFinal?.allergies.length).toBe(0);
  });

  test('removeRecordEntry on alice does not mutate bob', () => {
    let a = emptyRecord('alice', 'Alice');
    a = addRecordEntry(a, 'medications', {
      id: 'm1',
      drug: 'Lisinopril',
      dose: '10 mg',
      frequency: 'daily',
    });
    saveRecord(a);
    const b = addRecordEntry(emptyRecord('bob', 'Bob'), 'medications', {
      id: 'm2',
      drug: 'Metformin',
      dose: '500 mg',
      frequency: 'BID',
    });
    saveRecord(b);

    const aWithRemoval = removeRecordEntry(
      loadRecord('alice') as ReturnType<typeof emptyRecord>,
      'medications',
      'm1',
    );
    saveRecord(aWithRemoval);

    expect(loadRecord('alice')?.medications.length).toBe(0);
    expect(loadRecord('bob')?.medications.length).toBe(1);
    expect(loadRecord('bob')?.medications[0]?.drug).toBe('Metformin');
  });

  test('loadRecord returns null for an unknown user (no leakage)', () => {
    saveRecord(emptyRecord('alice', 'Alice'));
    expect(loadRecord('bob')).toBeNull();
    expect(loadRecord('')).toBeNull();
  });

  test('updatedAt is bumped on every save', async () => {
    const r = emptyRecord('alice', 'Alice');
    saveRecord(r);
    const t1 = loadRecord('alice')?.updatedAt ?? 0;
    await new Promise((resolve) => setTimeout(resolve, 5));
    saveRecord(r);
    const t2 = loadRecord('alice')?.updatedAt ?? 0;
    expect(t2).toBeGreaterThan(t1);
  });
});

import { afterEach, describe, expect, it } from 'bun:test';
import { _resetForTests, issue, list, revoke, verify } from './api-keys.ts';

afterEach(() => _resetForTests());

describe('api-keys', () => {
  it('issue() returns a morbius_ prefixed secret + meta', () => {
    const { key, meta } = issue('u1', 'postman');
    expect(key.startsWith('morbius_')).toBe(true);
    expect(key.length).toBe('morbius_'.length + 48); // 24 random bytes hex
    expect(meta.userId).toBe('u1');
    expect(meta.label).toBe('postman');
    expect(meta.active).toBe(true);
  });

  it('list() returns only the requesting user’s keys', () => {
    issue('u1', 'a');
    issue('u1', 'b');
    issue('u2', 'c');
    expect(list('u1')).toHaveLength(2);
    expect(list('u2')).toHaveLength(1);
  });

  it('verify() returns meta for a live key + bumps lastUsedAt', () => {
    const { key } = issue('u1', 'live');
    const meta = verify(key);
    expect(meta?.userId).toBe('u1');
    expect(meta?.lastUsedAt).not.toBeNull();
  });

  it('verify() rejects a wrong key', () => {
    issue('u1', 'a');
    expect(verify('morbius_deadbeef')).toBeNull();
    expect(verify('plain-not-prefixed')).toBeNull();
    expect(verify('')).toBeNull();
  });

  it('revoke() invalidates a key', () => {
    const { key, meta } = issue('u1', 'doomed');
    expect(revoke('u1', meta.id)).toBe(true);
    expect(verify(key)).toBeNull();
  });

  it('revoke() refuses cross-user revocation', () => {
    const { meta } = issue('u1', 'mine');
    expect(revoke('u2', meta.id)).toBe(false);
  });
});

import { describe, expect, it } from 'bun:test';
import { __test } from './recent-consults.tsx';

const { relativeTime, toneFor } = __test;

describe('relativeTime', () => {
  const NOW = 1_700_000_000_000;
  it('rounds the very recent past to "just now"', () => {
    expect(relativeTime(NOW - 5_000, NOW)).toBe('just now');
  });
  it('renders minutes', () => {
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe('5m ago');
  });
  it('renders hours', () => {
    expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe('3h ago');
  });
  it('renders days', () => {
    expect(relativeTime(NOW - 4 * 86_400_000, NOW)).toBe('4d ago');
  });
  it('renders months', () => {
    expect(relativeTime(NOW - 75 * 86_400_000, NOW)).toBe('2mo ago');
  });
  it('renders years', () => {
    expect(relativeTime(NOW - 400 * 86_400_000, NOW)).toBe('1y ago');
  });
  it('clamps future timestamps to "just now"', () => {
    expect(relativeTime(NOW + 60_000, NOW)).toBe('just now');
  });
});

describe('toneFor', () => {
  it('matches each known specialty', () => {
    for (const s of [
      'Cardiology',
      'Neurology',
      'Oncology',
      'Pulmonology',
      'Endocrinology',
      'Dermatology',
      'Pediatrics',
    ]) {
      const t = toneFor(s);
      expect(t.ring.length).toBeGreaterThan(0);
      expect(t.chip.length).toBeGreaterThan(0);
    }
  });
  it('falls back to primary tone on unknown / empty specialty', () => {
    const fallback = toneFor('quantum-cardiology-stub');
    expect(fallback.chip).toContain('text-rose-300');
    const empty = toneFor(undefined);
    expect(empty.ring).toBe('border-app-subtle');
  });
});

import { describe, expect, test } from 'bun:test';
import { VOICE_PRESETS, getPresetById } from './voice-presets.ts';

describe('VOICE_PRESETS', () => {
  test('shape — 3 female + 3 male + 2 robotic = 8 total', () => {
    expect(VOICE_PRESETS).toHaveLength(8);
    const families = VOICE_PRESETS.reduce<Record<string, number>>((acc, p) => {
      acc[p.family] = (acc[p.family] ?? 0) + 1;
      return acc;
    }, {});
    expect(families).toEqual({ female: 3, male: 3, robotic: 2 });
  });

  test('canonical persona names land in the v0.7.7 set', () => {
    const names = new Set(VOICE_PRESETS.map((p) => p.name));
    for (const expected of [
      'Aria',
      'Vera',
      'Nova',
      'Daniel',
      'Davis',
      'Atlas',
      'Mörbius',
      'Echo',
    ]) {
      expect(names.has(expected)).toBe(true);
    }
  });

  test('every preset carries a non-empty sample line', () => {
    for (const p of VOICE_PRESETS) {
      expect(p.sampleLine.length).toBeGreaterThan(20);
    }
  });

  test('every preset maps to a real underlying voice id', () => {
    const validIdentities = new Set(['system', 'male-1', 'female-1']);
    for (const p of VOICE_PRESETS) {
      expect(validIdentities.has(p.identity)).toBe(true);
    }
  });

  test('Aria · Vera · Nova share the female base voice and differ by prosody', () => {
    const female = VOICE_PRESETS.filter((p) => p.family === 'female');
    expect(female).toHaveLength(3);
    for (const p of female) expect(p.identity).toBe('female-1');
    const tones = new Set(female.map((p) => p.tone));
    expect(tones.size).toBe(3);
  });

  test('Daniel · Davis · Atlas share the male base voice and differ by prosody', () => {
    const male = VOICE_PRESETS.filter((p) => p.family === 'male');
    expect(male).toHaveLength(3);
    for (const p of male) expect(p.identity).toBe('male-1');
    const tones = new Set(male.map((p) => p.tone));
    expect(tones.size).toBe(3);
  });

  test('getPresetById round-trips', () => {
    expect(getPresetById('aria')?.name).toBe('Aria');
    expect(getPresetById('vera')?.name).toBe('Vera');
    expect(getPresetById('echo')?.tone).toBe('futuristic');
  });
});

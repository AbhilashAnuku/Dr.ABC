import { describe, expect, test } from 'bun:test';
import { parseJsonOrSalvage, shapeResponse } from './hf.ts';

describe('hf ensemble: parseJsonOrSalvage', () => {
  test('parses clean JSON', () => {
    const r = parseJsonOrSalvage(
      '{"differentials":[],"recommendedTests":[],"recommendedSpecialty":"x"}',
    );
    expect(r.recommendedSpecialty).toBe('x');
  });

  test('strips ```json fences', () => {
    const r = parseJsonOrSalvage('```json\n{"recommendedSpecialty":"y"}\n```');
    expect(r.recommendedSpecialty).toBe('y');
  });

  test('strips bare ``` fences', () => {
    const r = parseJsonOrSalvage('```\n{"recommendedSpecialty":"z"}\n```');
    expect(r.recommendedSpecialty).toBe('z');
  });

  test('salvages a leading prose preamble', () => {
    const r = parseJsonOrSalvage(
      'Here is the JSON you requested:\n{"recommendedSpecialty":"cardiology","recommendedTests":[],"differentials":[]}',
    );
    expect(r.recommendedSpecialty).toBe('cardiology');
  });

  test('returns empty object on completely invalid input', () => {
    const r = parseJsonOrSalvage('not even close to json');
    expect(r).toEqual({});
  });

  test('handles nested braces correctly', () => {
    const r = parseJsonOrSalvage(
      'preamble {"differentials":[{"condition":"a","probability":0.5,"supportingEvidence":[],"counterEvidence":[]}],"recommendedSpecialty":"x","recommendedTests":[]}',
    );
    expect((r.differentials as unknown[])?.length).toBe(1);
  });
});

describe('hf ensemble: shapeResponse', () => {
  test('keeps well-formed differentials and clamps probability', () => {
    const r = shapeResponse({
      differentials: [
        {
          condition: 'Migraine',
          probability: 0.7,
          supportingEvidence: ['unilateral pulsating'],
          counterEvidence: [],
        },
        {
          condition: 'Stroke',
          probability: 5, // out of range — should clamp to 1
          supportingEvidence: [],
          counterEvidence: ['no focal deficit'],
        },
      ],
      recommendedTests: ['CT head', 'glucose'],
      recommendedSpecialty: 'neurology',
    });
    expect(r.differentials.length).toBe(2);
    expect(r.differentials[1]?.probability).toBe(1);
    expect(r.recommendedTests).toEqual(['CT head', 'glucose']);
    expect(r.recommendedSpecialty).toBe('neurology');
  });

  test('drops differentials missing a condition name', () => {
    const r = shapeResponse({
      differentials: [
        { probability: 0.5, supportingEvidence: [], counterEvidence: [] },
        { condition: 'OK', probability: 0.5, supportingEvidence: [], counterEvidence: [] },
      ],
      recommendedTests: [],
      recommendedSpecialty: 'x',
    });
    expect(r.differentials.length).toBe(1);
    expect(r.differentials[0]?.condition).toBe('OK');
  });

  test('falls back to general practice when specialty missing', () => {
    const r = shapeResponse({ differentials: [], recommendedTests: [] });
    expect(r.recommendedSpecialty).toBe('general practice');
  });

  test('rejects non-array differentials silently', () => {
    const r = shapeResponse({
      differentials: 'oops' as unknown as never,
      recommendedTests: [],
      recommendedSpecialty: 'x',
    });
    expect(r.differentials).toEqual([]);
  });

  test('filters non-string entries from recommendedTests', () => {
    const r = shapeResponse({
      differentials: [],
      recommendedTests: ['CBC', 42 as unknown as string, 'BMP', null as unknown as string],
      recommendedSpecialty: 'x',
    });
    expect(r.recommendedTests).toEqual(['CBC', 'BMP']);
  });

  test('clamps NaN probability to 0', () => {
    const r = shapeResponse({
      differentials: [
        {
          condition: 'X',
          probability: Number.NaN,
          supportingEvidence: [],
          counterEvidence: [],
        },
      ],
      recommendedTests: [],
      recommendedSpecialty: 'x',
    });
    expect(r.differentials[0]?.probability).toBe(0);
  });
});

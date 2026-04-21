import { describe, expect, it } from 'bun:test';
import {
  HOUSE_TONE_PREFIX,
  type Tone,
  classifyAndPrefix,
  classifyTone,
  tonePrefix,
} from './tone.ts';

describe('classifyTone — high-stakes paths', () => {
  it('routes hard-news cues to delivering-hard-news with high confidence', () => {
    for (const text of [
      'My doctor told me my biopsy positive',
      'I just got a stage 4 diagnosis',
      'They said it was terminal',
      'My mom is going into hospice next week',
    ]) {
      const v = classifyTone(text);
      expect(v.tone).toBe('delivering-hard-news');
      expect(v.confidence).toBeGreaterThan(0.9);
      expect(v.matchedCues.length).toBeGreaterThan(0);
    }
  });

  it('routes emotional cues to empathetic', () => {
    for (const text of [
      "I feel so overwhelmed and I don't know what to do",
      'My dad passed away last week and I have not slept',
      'I am scared all the time',
      'I feel alone and hopeless',
    ]) {
      const v = classifyTone(text);
      expect(v.tone).toBe('empathetic');
      expect(v.confidence).toBeGreaterThanOrEqual(0.55);
    }
  });

  it('routes "is this serious" anxiety to reassuring', () => {
    for (const text of [
      'Is this rash serious doctor?',
      'Should I worry about a headache for a day?',
      'Am I going to be ok?',
      'Is this dangerous?',
    ]) {
      const v = classifyTone(text);
      expect(v.tone).toBe('reassuring');
    }
  });
});

describe('classifyTone — conversational vs clinical', () => {
  it('routes pure greetings to conversational', () => {
    for (const text of ['hello', 'hi Mörbius', 'good morning', 'thanks for your help']) {
      const v = classifyTone(text);
      expect(v.tone).toBe('conversational');
    }
  });

  it('promotes a greeting with a clinical complaint to clinical', () => {
    const v = classifyTone('Good morning Mörbius — my chest pain is back');
    expect(v.tone).toBe('clinical');
    expect(v.matchedCues).toContain('pain');
  });

  it('routes plain symptom utterances to clinical', () => {
    for (const text of [
      'I have a fever of 38.6 with a productive cough',
      'BP 162/98 + HR 104',
      'sharp left flank pain since this morning',
    ]) {
      const v = classifyTone(text);
      expect(v.tone).toBe('clinical');
    }
  });

  it('blends empathetic + clinical to empathetic-with-evidence', () => {
    const v = classifyTone(
      'I am scared. My dad died of a heart attack and I have chest pain right now',
    );
    expect(v.tone).toBe('empathetic');
    // The clinical cue should still surface so the orchestrator
    // knows to also handle the medical question.
    expect(v.matchedCues.some((c) => c.includes('chest') || c.includes('pain'))).toBe(true);
  });
});

describe('classifyTone — defaults', () => {
  it('returns conversational with low confidence on empty input', () => {
    const v = classifyTone('');
    expect(v.tone).toBe('conversational');
    expect(v.confidence).toBeLessThanOrEqual(0.5);
  });

  it('returns conversational with low confidence on noise input', () => {
    const v = classifyTone('asdf qwerty');
    expect(v.tone).toBe('conversational');
    expect(v.confidence).toBeLessThanOrEqual(0.5);
  });
});

describe('tonePrefix', () => {
  const tones: Tone[] = [
    'clinical',
    'empathetic',
    'reassuring',
    'conversational',
    'delivering-hard-news',
  ];

  for (const tone of tones) {
    it(`returns a non-empty prefix for ${tone}`, () => {
      const p = tonePrefix(tone);
      expect(p.length).toBeGreaterThan(40);
    });
  }

  it('hard-news prefix references SPIKES framework', () => {
    expect(tonePrefix('delivering-hard-news').toUpperCase()).toContain('SPIKES');
  });

  it('clinical prefix instructs warmth alongside precision', () => {
    expect(tonePrefix('clinical').toLowerCase()).toContain('warmth');
  });

  it('empathetic prefix names the feeling-acknowledgement step', () => {
    expect(tonePrefix('empathetic').toLowerCase()).toContain('acknowledg');
  });
});

describe('HOUSE_TONE_PREFIX', () => {
  it('forbids the "I am just an AI" hedge', () => {
    expect(HOUSE_TONE_PREFIX.toLowerCase()).toContain("i'm just an ai");
  });

  it('locks in the Mörbius name', () => {
    expect(HOUSE_TONE_PREFIX).toContain('Mörbius');
  });
});

describe('classifyAndPrefix', () => {
  it('returns both verdict + prefix in one call', () => {
    const out = classifyAndPrefix('I am scared and I do not know what to do');
    expect(out.verdict.tone).toBe('empathetic');
    expect(out.prefix).toBe(tonePrefix('empathetic'));
  });
});

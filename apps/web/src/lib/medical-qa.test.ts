import { describe, expect, test } from 'bun:test';
import { DISEASES } from './medical-qa-data.ts';
import { answerMedicalQuestion } from './medical-qa.ts';

describe('medical-qa: disease catalog coverage', () => {
  test('catalog has at least 50 conditions', () => {
    expect(DISEASES.length).toBeGreaterThanOrEqual(50);
  });

  test('every entry has the required clinical fields', () => {
    for (const d of DISEASES) {
      expect(d.name, 'entry missing name').toBeTruthy();
      expect(d.icd10, `${d.name}: missing icd10`).toBeTruthy();
      expect(d.specialty, `${d.name}: missing specialty`).toBeTruthy();
      expect(d.summary, `${d.name}: missing summary`).toBeTruthy();
      expect(d.treatment, `${d.name}: missing treatment`).toBeTruthy();
      expect(d.prevention, `${d.name}: missing prevention`).toBeTruthy();
      expect(d.whenToWorry, `${d.name}: missing whenToWorry`).toBeTruthy();
      expect(d.redFlags?.length, `${d.name}: missing redFlags`).toBeGreaterThan(0);
      expect(d.mimics?.length, `${d.name}: missing mimics`).toBeGreaterThan(0);
    }
  });

  test('icd10 codes follow basic ICD-10 shape (letter + digits)', () => {
    const shape = /^[A-Z]\d{2}(\.\d+)?$/;
    for (const d of DISEASES) {
      expect(shape.test(d.icd10), `${d.name}: bad ICD-10 "${d.icd10}"`).toBe(true);
    }
  });
});

// One generic question and one treatment question per condition — covers
// the two main code paths in answerMedicalQuestion (default summary vs
// treatment branch) and verifies that for every entry the engine surfaces
// the right disease with the right meta block.
describe('medical-qa: per-condition matching', () => {
  for (const d of DISEASES) {
    const synonym = d.synonyms?.[0];

    test(`${d.name}: matches its own name`, () => {
      const r = answerMedicalQuestion(`what is ${d.name}?`);
      expect(r.escalate).toBeFalsy();
      expect(r.meta?.icd10).toBe(d.icd10);
      expect(r.meta?.specialty).toBe(d.specialty);
    });

    if (synonym) {
      test(`${d.name}: matches synonym "${synonym}"`, () => {
        const r = answerMedicalQuestion(`tell me about ${synonym}`);
        expect(r.escalate).toBeFalsy();
        expect(r.meta?.icd10).toBe(d.icd10);
      });
    }

    test(`${d.name}: treatment query returns the treatment branch`, () => {
      const r = answerMedicalQuestion(`how do I treat ${d.name}?`);
      expect(r.escalate).toBeFalsy();
      expect(r.meta?.icd10).toBe(d.icd10);
      expect(r.answer).toBe(d.treatment);
    });
  }
});

describe('medical-qa: red flags + mimics', () => {
  test('"is X serious" surfaces the red flags bullet', () => {
    const r = answerMedicalQuestion('when should I worry about migraine?');
    expect(r.bullets?.some((b) => b.startsWith('Red flags:'))).toBe(true);
  });

  test('"differential for X" surfaces the mimics list', () => {
    const r = answerMedicalQuestion('what is the differential for asthma?');
    expect(r.bullets).toBeTruthy();
    expect(r.bullets?.length ?? 0).toBeGreaterThan(0);
  });

  test('default response includes both red flags and differentials', () => {
    const r = answerMedicalQuestion('hypertension');
    expect(r.bullets?.some((b) => b.startsWith('Red flags:'))).toBe(true);
    expect(r.bullets?.some((b) => b.startsWith('Differentials:'))).toBe(true);
  });
});

describe('medical-qa: emergency keyword escalation', () => {
  test('chest pain escalates to Triage', () => {
    const r = answerMedicalQuestion("I'm having chest pain right now");
    expect(r.escalate).toBe(true);
  });

  test('worst headache escalates to Triage', () => {
    const r = answerMedicalQuestion('worst headache of my life');
    expect(r.escalate).toBe(true);
  });

  test('suicidal ideation escalates', () => {
    const r = answerMedicalQuestion('thinking about suicide');
    expect(r.escalate).toBe(true);
  });
});

describe('medical-qa: FAQ patterns', () => {
  test('"when should I call 911" returns the emergency list', () => {
    const r = answerMedicalQuestion('when should I call 911?');
    expect(r.bullets?.length).toBeGreaterThan(5);
  });

  test('"paracetamol dose" returns paracetamol info', () => {
    const r = answerMedicalQuestion('what is the paracetamol dose for adults');
    expect(r.answer.toLowerCase()).toContain('paracetamol');
  });

  test('"book appointment" returns the appointments CTA', () => {
    const r = answerMedicalQuestion('I want to book an appointment');
    expect(r.cta?.to).toBe('/app/appointments');
  });

  test('"insurance" returns the insurance CTA', () => {
    const r = answerMedicalQuestion('how does my insurance work');
    expect(r.cta?.to).toBe('/app/insurance');
  });
});

describe('medical-qa: longest-match disambiguation', () => {
  test('"chronic kidney disease" maps to CKD, not generic disease miss', () => {
    const r = answerMedicalQuestion('what is chronic kidney disease');
    expect(r.meta?.icd10).toBe('N18');
  });

  test('"type 2 diabetes" maps to T2DM specifically', () => {
    const r = answerMedicalQuestion('what is type 2 diabetes');
    expect(r.meta?.icd10).toBe('E11');
  });
});

describe('medical-qa: fallback path', () => {
  test('nonsense query returns the help fallback (not an escalation)', () => {
    const r = answerMedicalQuestion('xyzzyx plugh');
    expect(r.escalate).toBeFalsy();
    expect(r.bullets?.some((b) => b.includes('Try:'))).toBe(true);
  });
});

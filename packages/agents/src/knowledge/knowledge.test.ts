import { describe, expect, it } from 'bun:test';
import {
  ICD10_TABLE,
  ICD10_TABLE_SIZE,
  KNOWLEDGE_MANIFEST,
  RED_FLAG_RULE_COUNT,
  SOC_TEMPLATE_COUNT,
  canonicaliseDrug,
  checkDrugSafety,
  findSocByCondition,
  isKnownIcd10,
  lookupIcd10,
  lookupSoc,
  scanRedFlags,
  searchIcd10,
  severityRank,
  specialtyForCondition,
  topEscalation,
} from './index.ts';

// ─────────────────────────────────────────────────────────────────
//  ICD-10
// ─────────────────────────────────────────────────────────────────

describe('icd10', () => {
  it('ships at least 80 curated codes', () => {
    expect(ICD10_TABLE_SIZE).toBeGreaterThanOrEqual(80);
  });

  it('every entry has a code matching the ICD-10-CM shape', () => {
    for (const e of ICD10_TABLE) {
      expect(e.code).toMatch(/^[A-Z]\d{2}(\.\w{1,4})?$/);
      expect(e.display.length).toBeGreaterThan(3);
      expect(e.chapter.length).toBeGreaterThan(0);
    }
  });

  it('codes are unique', () => {
    const set = new Set(ICD10_TABLE.map((e) => e.code));
    expect(set.size).toBe(ICD10_TABLE.length);
  });

  it('lookupIcd10 finds canonical codes case-insensitively', () => {
    expect(lookupIcd10('I21.0')?.display).toContain('STEMI');
    expect(lookupIcd10('i21.0')?.display).toContain('STEMI');
    expect(lookupIcd10('  I21.0  ')?.display).toContain('STEMI');
  });

  it('lookupIcd10 returns null for unknown codes', () => {
    expect(lookupIcd10('Z99.99')).toBeNull();
    expect(lookupIcd10('not-a-code')).toBeNull();
  });

  it('isKnownIcd10 mirrors lookup', () => {
    expect(isKnownIcd10('I10')).toBe(true);
    expect(isKnownIcd10('Z99.99')).toBe(false);
  });

  it('searchIcd10 finds entries by display + synonym', () => {
    const stemi = searchIcd10('STEMI', 3);
    expect(stemi.some((e) => e.code === 'I21.0')).toBe(true);

    const afib = searchIcd10('afib');
    expect(afib.some((e) => e.code.startsWith('I48'))).toBe(true);

    const asthma = searchIcd10('asthma');
    expect(asthma.some((e) => e.code === 'J45.909' || e.code === 'J45.901')).toBe(true);
  });

  it('searchIcd10 returns empty on whitespace input', () => {
    expect(searchIcd10('')).toEqual([]);
    expect(searchIcd10('   ')).toEqual([]);
  });

  it('specialtyForCondition routes the right specialist', () => {
    expect(specialtyForCondition('atrial fibrillation')).toBe('cardiology');
    expect(specialtyForCondition('migraine')).toBe('neurology');
    expect(specialtyForCondition('asthma')).toBe('pulmonology');
    expect(specialtyForCondition('diabetes')).toBe('endocrinology');
    expect(specialtyForCondition('eczema')).toBe('dermatology');
  });
});

// ─────────────────────────────────────────────────────────────────
//  Drug interactions
// ─────────────────────────────────────────────────────────────────

describe('canonicaliseDrug', () => {
  it('normalises brand names to INN', () => {
    expect(canonicaliseDrug('Tylenol')).toBe('acetaminophen');
    expect(canonicaliseDrug('TYLENOL')).toBe('acetaminophen');
    expect(canonicaliseDrug('coumadin')).toBe('warfarin');
    expect(canonicaliseDrug('Eliquis')).toBe('apixaban');
  });

  it('passes through unknown drugs unchanged', () => {
    expect(canonicaliseDrug('mörbiusxin')).toBe('mörbiusxin');
  });
});

describe('checkDrugSafety — drug-drug', () => {
  it('flags warfarin × ibuprofen as major bleeding risk', () => {
    const alerts = checkDrugSafety({
      prescribed: 'Ibuprofen 400 mg PO q6h',
      currentMeds: 'Warfarin 5 mg daily, Lisinopril 10 mg daily',
    });
    const ddi = alerts.find((a) => a.kind === 'drug-drug');
    expect(ddi).toBeDefined();
    expect(ddi?.severity).toBe('major');
    expect(ddi?.label).toContain('warfarin');
  });

  it('handles brand-name input via canonicalisation', () => {
    const alerts = checkDrugSafety({
      prescribed: 'advil',
      currentMeds: 'Coumadin 5 mg',
    });
    expect(alerts.some((a) => a.kind === 'drug-drug' && a.severity === 'major')).toBe(true);
  });

  it('returns no drug-drug alerts when drugs are safe together', () => {
    const alerts = checkDrugSafety({
      prescribed: 'Acetaminophen 500 mg',
      currentMeds: 'Lisinopril 10 mg',
    });
    expect(alerts.filter((a) => a.kind === 'drug-drug')).toEqual([]);
  });

  it('flags clopidogrel × omeprazole as moderate', () => {
    const alerts = checkDrugSafety({
      prescribed: 'omeprazole',
      currentMeds: 'Plavix 75 mg',
    });
    const ddi = alerts.find((a) => a.kind === 'drug-drug');
    expect(ddi?.severity).toBe('moderate');
  });
});

describe('checkDrugSafety — drug-allergy', () => {
  it('flags amoxicillin in a penicillin-allergic patient', () => {
    const alerts = checkDrugSafety({
      prescribed: 'Amoxicillin 500 mg PO TID',
      allergies: 'Penicillin (hives)',
    });
    expect(alerts.some((a) => a.kind === 'drug-allergy' && a.severity === 'major')).toBe(true);
  });

  it('does not flag azithromycin in a penicillin-allergic patient', () => {
    const alerts = checkDrugSafety({
      prescribed: 'Azithromycin 250 mg',
      allergies: 'Penicillin',
    });
    expect(alerts.filter((a) => a.kind === 'drug-allergy')).toEqual([]);
  });

  it('flags ibuprofen × aspirin allergy', () => {
    const alerts = checkDrugSafety({
      prescribed: 'Ibuprofen 200 mg',
      allergies: 'Aspirin',
    });
    expect(alerts.some((a) => a.kind === 'drug-allergy')).toBe(true);
  });
});

describe('checkDrugSafety — drug-condition', () => {
  it('flags metformin in CKD 4', () => {
    const alerts = checkDrugSafety({
      prescribed: 'Metformin 500 mg BID',
      conditions: 'CKD 4 with proteinuria',
    });
    expect(alerts.some((a) => a.kind === 'drug-condition' && a.severity === 'major')).toBe(true);
  });

  it('flags lisinopril in pregnancy', () => {
    const alerts = checkDrugSafety({
      prescribed: 'Lisinopril 10 mg',
      conditions: 'Pregnancy 18 weeks',
    });
    expect(alerts.some((a) => a.kind === 'drug-condition' && a.severity === 'major')).toBe(true);
  });

  it('flags sumatriptan in CAD', () => {
    const alerts = checkDrugSafety({
      prescribed: 'Sumatriptan 50 mg',
      conditions: 'history of coronary artery disease',
    });
    expect(alerts.some((a) => a.kind === 'drug-condition')).toBe(true);
  });
});

describe('severityRank', () => {
  it('ranks major > moderate > minor > unknown', () => {
    expect(severityRank('major')).toBeGreaterThan(severityRank('moderate'));
    expect(severityRank('moderate')).toBeGreaterThan(severityRank('minor'));
    expect(severityRank('minor')).toBeGreaterThan(severityRank('unknown'));
  });
});

// ─────────────────────────────────────────────────────────────────
//  Red flags
// ─────────────────────────────────────────────────────────────────

describe('scanRedFlags', () => {
  it('catches crushing chest pain → ESI 1', () => {
    const hits = scanRedFlags('Patient reports crushing substernal pain × 30 min');
    expect(hits.some((h) => h.rule.id === 'crushing-chest-pain')).toBe(true);
    expect(topEscalation('crushing chest pain')).toBe(1);
  });

  it('catches FAST stroke signs', () => {
    const hits = scanRedFlags('Sudden facial droop and slurred speech');
    expect(hits.some((h) => h.rule.id === 'fast-stroke-signs')).toBe(true);
    expect(topEscalation('Sudden facial droop and slurred speech')).toBe(1);
  });

  it('catches anaphylaxis signs', () => {
    const hits = scanRedFlags('throat closing, hives all over');
    expect(hits.some((h) => h.rule.id === 'anaphylaxis')).toBe(true);
  });

  it('catches suicidal ideation', () => {
    const hits = scanRedFlags('I want to die and have a plan');
    expect(hits.some((h) => h.rule.id === 'suicidal-ideation')).toBe(true);
  });

  it('only fires SpO2 rule when value < 92', () => {
    expect(scanRedFlags('SpO2 98% on room air')).toEqual([]);
    const low = scanRedFlags('SpO2 88% RA');
    expect(low.some((h) => h.rule.id === 'spo2-low')).toBe(true);
  });

  it('returns no hits on benign input', () => {
    expect(scanRedFlags('Mild sore throat × 1 day, no other symptoms')).toEqual([]);
    expect(topEscalation('Mild sore throat')).toBeNull();
  });

  it('ships at least 25 rules', () => {
    expect(RED_FLAG_RULE_COUNT).toBeGreaterThanOrEqual(25);
  });
});

// ─────────────────────────────────────────────────────────────────
//  Standard of care
// ─────────────────────────────────────────────────────────────────

describe('standard-of-care', () => {
  it('ships at least 15 templates', () => {
    expect(SOC_TEMPLATE_COUNT).toBeGreaterThanOrEqual(15);
  });

  it('lookupSoc finds STEMI by code', () => {
    const t = lookupSoc('I21.0');
    expect(t?.condition).toContain('STEMI');
    expect(t?.rx.some((r) => r.drug === 'Aspirin')).toBe(true);
  });

  it('findSocByCondition finds GERD by free text', () => {
    const t = findSocByCondition('gerd');
    expect(t?.icd10).toBe('K21.0');
    expect(t?.rx[0]?.drug).toBe('Omeprazole');
  });

  it('returns null when condition unknown', () => {
    expect(lookupSoc('Z99.99')).toBeNull();
    expect(findSocByCondition('mörbius syndrome')).toBeNull();
  });

  it('every template has a guideline source citation', async () => {
    const { SOC_TEMPLATES } = await import('./standard-of-care.ts');
    for (const t of SOC_TEMPLATES) {
      expect(t.source.length).toBeGreaterThan(3);
      expect(t.followUp.length).toBeGreaterThan(3);
    }
  });
});

// ─────────────────────────────────────────────────────────────────
//  Manifest
// ─────────────────────────────────────────────────────────────────

describe('KNOWLEDGE_MANIFEST', () => {
  it('reports the live counts of each table', () => {
    expect(KNOWLEDGE_MANIFEST.icd10Codes).toBe(ICD10_TABLE_SIZE);
    expect(KNOWLEDGE_MANIFEST.standardOfCareTemplates).toBe(SOC_TEMPLATE_COUNT);
    expect(KNOWLEDGE_MANIFEST.redFlagRules).toBe(RED_FLAG_RULE_COUNT);
    expect(KNOWLEDGE_MANIFEST.drugInteractions).toBeGreaterThan(20);
  });
});

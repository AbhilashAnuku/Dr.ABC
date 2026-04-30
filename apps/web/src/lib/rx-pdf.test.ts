import { describe, expect, it } from 'bun:test';
import { PDFDocument } from 'pdf-lib';
import { type PrescriptionInput, buildRxPdf } from './rx-pdf.ts';

const sample: PrescriptionInput = {
  patient: {
    ageYears: '54',
    sex: 'M',
    weightKg: '82',
    heightCm: '178',
    allergies: 'penicillin (rash)',
    currentMeds: 'atorvastatin 40mg',
    history: 'hypertension; smoker',
  },
  diagnosis: {
    topCondition: 'Acute Myocardial Infarction',
    topProb: 0.86,
    modelUsed: 'mörbius-core-balanced',
    specialty: 'Cardiology',
    icd10: 'I21',
  },
  items: [
    {
      drug: 'Aspirin',
      dose: '300 mg PO',
      frequency: 'load + 75 mg daily',
      duration: 'lifelong',
      notes: 'STEMI standard load.',
    },
    { drug: 'Atorvastatin', dose: '80 mg PO', frequency: 'nocte', duration: 'lifelong' },
  ],
  warnings: [
    'Patient lists penicillin allergy — confirm cross-reactivity before adding antibiotics.',
  ],
  followUp: 'Cardiology review within 7 days. Return immediately if pain recurs.',
  generatedAt: 1730000000000,
  clinicianApproved: true,
  signedBy: 'Dr. Demo · doctor',
  patientName: 'Maya Becker',
};

describe('buildRxPdf', () => {
  it('produces a valid PDF byte stream', async () => {
    const bytes = await buildRxPdf(sample);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    // PDF magic.
    expect(bytes[0]).toBe(0x25); // %
    expect(bytes[1]).toBe(0x50); // P
    expect(bytes[2]).toBe(0x44); // D
    expect(bytes[3]).toBe(0x46); // F
    expect(bytes[4]).toBe(0x2d); // -
  });

  it('produces a single A4 page with the right metadata', async () => {
    // We load the PDF back through pdf-lib instead of grepping the raw
    // bytes — the page text streams are FlateDecode-compressed so a
    // substring search would be a false negative. Metadata (title +
    // subject + author) is what the test actually pins.
    const bytes = await buildRxPdf(sample);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
    const page = loaded.getPage(0);
    // A4 dimensions in points, give or take rounding (595.28 × 841.89).
    expect(page.getWidth()).toBeGreaterThan(594);
    expect(page.getWidth()).toBeLessThan(597);
    expect(page.getHeight()).toBeGreaterThan(840);
    expect(page.getHeight()).toBeLessThan(843);
    expect(loaded.getTitle()).toBe('Mörbius Prescription');
    expect(loaded.getAuthor()).toBe('Dr.ABC · Mörbius');
    expect(loaded.getSubject()).toBe('Acute Myocardial Infarction');
  });

  it('renders an unsigned prescription (no signedBy field)', async () => {
    const unsigned: PrescriptionInput = {
      ...sample,
      clinicianApproved: false,
      signedBy: undefined,
    };
    const bytes = await buildRxPdf(unsigned);
    const loaded = await PDFDocument.load(bytes);
    // The page count + metadata should still be sane; the visual
    // "Pending clinician sign-off" text is inside a compressed stream
    // and isn't worth decoding here.
    expect(loaded.getPageCount()).toBe(1);
    expect(loaded.getSubject()).toBe('Acute Myocardial Infarction');
  });

  it('handles an empty Rx (no items) without crashing', async () => {
    const bytes = await buildRxPdf({ ...sample, items: [] });
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
  });

  it('handles a missing diagnosis without crashing', async () => {
    const bytes = await buildRxPdf({ ...sample, diagnosis: null });
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
    expect(loaded.getSubject()).toBe('Prescription');
  });
});

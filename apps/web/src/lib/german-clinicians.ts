/**
 * german-clinicians -- canonical directory of synthetic-but-realistic
 * German clinicians used across /app/appointments, Mörbius's
 * appointment-suggestion path, and the dashboard's "next visit" strip.
 *
 * Privacy: every clinician name is FICTIONAL. The clinic names + Stuttgart
 * addresses are based on real institutions (Klinikum Stuttgart,
 * Robert-Bosch-Krankenhaus, etc.) so the demo geography lands plausibly,
 * but the named doctors do not exist. CLAUDE.md s8 (no PHI) applies in
 * both directions -- no real patient OR clinician data.
 *
 * Insurance acceptance is a coarse-grained set keyed against
 * `apps/web/src/lib/insurance-plans.ts`. The Mörbius recommendation flow
 * filters by `acceptsInsurance` so the suggested clinician matches the
 * signed-in persona's plan.
 */

export type Specialty =
  | 'general-practice'
  | 'cardiology'
  | 'endocrinology'
  | 'oncology'
  | 'gynaecology'
  | 'dermatology'
  | 'neurology'
  | 'pulmonology'
  | 'psychiatry'
  | 'paediatrics'
  | 'surgery'
  | 'orthopaedics'
  | 'radiology';

export type InsurancePlanId =
  | 'aok-bw'
  | 'techniker'
  | 'barmer'
  | 'dak'
  | 'bkk-mobil'
  | 'kkh'
  | 'private';

export interface Clinician {
  id: string;
  /** Display label, e.g. "Dr. med. Anya Schneider". */
  name: string;
  /** Primary specialty -- drives the routing from Triage. */
  specialty: Specialty;
  /** Secondary specialties / sub-fellowship if any. */
  subspecialties?: string[];
  clinic: string;
  address: string;
  phone: string;
  /** Insurance plans accepted -- empty array means private-pay only. */
  acceptsInsurance: InsurancePlanId[];
  /** Spoken languages (ISO 639-1). */
  languages: ('de' | 'en' | 'fr' | 'it' | 'es' | 'tr')[];
  /** Average wait for the next free appointment, in days. */
  nextSlotDays: number;
  /** Tele-consult available? */
  telehealth: boolean;
  /** Mörbius rating 0..5 -- aggregated from the activity-sink + the
   *  per-clinician follow-up survey. Synthetic for the demo. */
  morbiusRating: number;
  /** Years in practice. */
  yearsExperience: number;
}

export const CLINICIANS: Clinician[] = [
  // ---- General practice / family medicine ----
  {
    id: 'cl-schneider-anya',
    name: 'Dr. med. Anya Schneider',
    specialty: 'general-practice',
    clinic: 'Praxis Schneider · Stuttgart-Mitte',
    address: 'Königstraße 32, 70173 Stuttgart',
    phone: '+49 711 1234 0101',
    acceptsInsurance: ['aok-bw', 'techniker', 'barmer', 'dak', 'bkk-mobil', 'kkh'],
    languages: ['de', 'en'],
    nextSlotDays: 3,
    telehealth: true,
    morbiusRating: 4.7,
    yearsExperience: 14,
  },
  {
    id: 'cl-mueller-jonas',
    name: 'Dr. med. Jonas Müller',
    specialty: 'general-practice',
    clinic: 'Hausarztpraxis Müller-Becker · Bad Cannstatt',
    address: 'Marktstraße 18, 70372 Stuttgart',
    phone: '+49 711 1234 0102',
    acceptsInsurance: ['aok-bw', 'techniker', 'barmer', 'private'],
    languages: ['de', 'en', 'tr'],
    nextSlotDays: 5,
    telehealth: true,
    morbiusRating: 4.5,
    yearsExperience: 22,
  },

  // ---- Cardiology ----
  {
    id: 'cl-koenig-helene',
    name: 'Dr. med. Helene König',
    specialty: 'cardiology',
    subspecialties: ['interventional', 'heart-failure'],
    clinic: 'Klinikum Stuttgart · Kardiologie',
    address: 'Kriegsbergstraße 60, 70174 Stuttgart',
    phone: '+49 711 278 30501',
    acceptsInsurance: ['aok-bw', 'techniker', 'barmer', 'dak', 'private'],
    languages: ['de', 'en', 'fr'],
    nextSlotDays: 12,
    telehealth: false,
    morbiusRating: 4.9,
    yearsExperience: 19,
  },
  {
    id: 'cl-richter-paul',
    name: 'Dr. med. Paul Richter',
    specialty: 'cardiology',
    subspecialties: ['preventive', 'lipidology'],
    clinic: 'Robert-Bosch-Krankenhaus · Kardiologie',
    address: 'Auerbachstraße 110, 70376 Stuttgart',
    phone: '+49 711 8101 3401',
    acceptsInsurance: ['techniker', 'barmer', 'bkk-mobil', 'private'],
    languages: ['de', 'en'],
    nextSlotDays: 18,
    telehealth: true,
    morbiusRating: 4.6,
    yearsExperience: 11,
  },

  // ---- Endocrinology (T2DM / PCOS / thyroid) ----
  {
    id: 'cl-fischer-elena',
    name: 'Dr. med. Elena Fischer',
    specialty: 'endocrinology',
    subspecialties: ['diabetes', 'thyroid'],
    clinic: 'Diabeteszentrum Stuttgart-West',
    address: 'Rotebühlstraße 87, 70178 Stuttgart',
    phone: '+49 711 1234 0301',
    acceptsInsurance: ['aok-bw', 'techniker', 'barmer', 'dak', 'bkk-mobil', 'kkh', 'private'],
    languages: ['de', 'en', 'it'],
    nextSlotDays: 9,
    telehealth: true,
    morbiusRating: 4.8,
    yearsExperience: 16,
  },

  // ---- Gynaecology (PCOS care, breast surveillance) ----
  {
    id: 'cl-bauer-clara',
    name: 'Dr. med. Clara Bauer',
    specialty: 'gynaecology',
    subspecialties: ['PCOS', 'reproductive-endocrinology'],
    clinic: 'Marienhospital · Frauenklinik',
    address: 'Böheimstraße 37, 70199 Stuttgart',
    phone: '+49 711 6489 2401',
    acceptsInsurance: ['aok-bw', 'techniker', 'barmer', 'dak', 'private'],
    languages: ['de', 'en'],
    nextSlotDays: 14,
    telehealth: true,
    morbiusRating: 4.7,
    yearsExperience: 13,
  },

  // ---- Oncology (breast-CA surveillance) ----
  {
    id: 'cl-weiss-magnus',
    name: 'Dr. med. Magnus Weiß',
    specialty: 'oncology',
    subspecialties: ['breast-oncology', 'survivorship'],
    clinic: 'Klinikum Stuttgart · Brustzentrum',
    address: 'Kriegsbergstraße 60, 70174 Stuttgart',
    phone: '+49 711 278 30901',
    acceptsInsurance: ['aok-bw', 'techniker', 'barmer', 'private'],
    languages: ['de', 'en'],
    nextSlotDays: 21,
    telehealth: false,
    morbiusRating: 4.9,
    yearsExperience: 24,
  },

  // ---- Neurology ----
  {
    id: 'cl-vogel-sophie',
    name: 'Dr. med. Sophie Vogel',
    specialty: 'neurology',
    subspecialties: ['headache', 'epilepsy'],
    clinic: 'Neurozentrum Stuttgart-Süd',
    address: 'Tübinger Straße 15, 70178 Stuttgart',
    phone: '+49 711 1234 0701',
    acceptsInsurance: ['techniker', 'barmer', 'dak', 'private'],
    languages: ['de', 'en'],
    nextSlotDays: 17,
    telehealth: true,
    morbiusRating: 4.6,
    yearsExperience: 12,
  },

  // ---- Dermatology ----
  {
    id: 'cl-hoffmann-luca',
    name: 'Dr. med. Luca Hoffmann',
    specialty: 'dermatology',
    subspecialties: ['dermatoscopy', 'acne'],
    clinic: 'Hautzentrum am Marktplatz',
    address: 'Marktplatz 1, 70173 Stuttgart',
    phone: '+49 711 1234 0801',
    acceptsInsurance: ['aok-bw', 'techniker', 'barmer', 'dak', 'kkh', 'private'],
    languages: ['de', 'en'],
    nextSlotDays: 7,
    telehealth: false,
    morbiusRating: 4.5,
    yearsExperience: 9,
  },

  // ---- Psychiatry ----
  {
    id: 'cl-koehler-aaron',
    name: 'Dr. med. Aaron Köhler',
    specialty: 'psychiatry',
    subspecialties: ['anxiety', 'CBT'],
    clinic: 'Praxis für Psychotherapie · Stuttgart-Ost',
    address: 'Werastraße 51, 70182 Stuttgart',
    phone: '+49 711 1234 0901',
    acceptsInsurance: ['techniker', 'barmer', 'private'],
    languages: ['de', 'en'],
    nextSlotDays: 28,
    telehealth: true,
    morbiusRating: 4.8,
    yearsExperience: 17,
  },

  // ---- Paediatrics ----
  {
    id: 'cl-becker-maya',
    name: 'Dr. med. Maya Becker',
    specialty: 'paediatrics',
    clinic: 'Kinder- und Jugendarztpraxis Bad Cannstatt',
    address: 'Pragstraße 22, 70372 Stuttgart',
    phone: '+49 711 1234 1001',
    acceptsInsurance: ['aok-bw', 'techniker', 'barmer', 'dak', 'bkk-mobil', 'kkh', 'private'],
    languages: ['de', 'en'],
    nextSlotDays: 4,
    telehealth: false,
    morbiusRating: 4.9,
    yearsExperience: 18,
  },

  // ---- Pulmonology ----
  {
    id: 'cl-wagner-noah',
    name: 'Dr. med. Noah Wagner',
    specialty: 'pulmonology',
    subspecialties: ['asthma', 'COPD'],
    clinic: 'Lungenpraxis Stuttgart-Vaihingen',
    address: 'Vollmoellerstraße 14, 70563 Stuttgart',
    phone: '+49 711 1234 1101',
    acceptsInsurance: ['aok-bw', 'techniker', 'barmer', 'private'],
    languages: ['de', 'en'],
    nextSlotDays: 11,
    telehealth: true,
    morbiusRating: 4.5,
    yearsExperience: 14,
  },
];

export function findClinicians(
  filter: {
    specialty?: Specialty;
    insurance?: InsurancePlanId;
    telehealth?: boolean;
    maxWaitDays?: number;
    language?: Clinician['languages'][number];
  } = {},
): Clinician[] {
  return CLINICIANS.filter((c) => {
    if (filter.specialty && c.specialty !== filter.specialty) return false;
    if (filter.insurance && !c.acceptsInsurance.includes(filter.insurance)) return false;
    if (filter.telehealth !== undefined && c.telehealth !== filter.telehealth) return false;
    if (filter.maxWaitDays !== undefined && c.nextSlotDays > filter.maxWaitDays) return false;
    if (filter.language && !c.languages.includes(filter.language)) return false;
    return true;
  }).sort((a, b) => b.morbiusRating - a.morbiusRating || a.nextSlotDays - b.nextSlotDays);
}

export function findClinicianById(id: string): Clinician | undefined {
  return CLINICIANS.find((c) => c.id === id);
}

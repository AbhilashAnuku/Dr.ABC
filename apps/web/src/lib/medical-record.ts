/**
 * Medical-record store — per-user, persisted to localStorage so the
 * Profile page actually keeps what the patient enters across sessions.
 *
 * Shape mirrors the FHIR R4 resources we'll back this with in V1
 * (Patient, AllergyIntolerance, Condition, MedicationStatement,
 * Immunization, FamilyMemberHistory). The keys here are deliberately
 * close to FHIR field names so the migration is mechanical.
 */

export interface AllergyEntry {
  id: string;
  substance: string;
  /** mild | moderate | severe — patient-reportable, not the FHIR criticality enum yet. */
  severity: 'mild' | 'moderate' | 'severe';
  reaction?: string;
}

export interface ConditionEntry {
  id: string;
  display: string;
  /** ICD-10 code if known. */
  icd10?: string;
  status: 'active' | 'resolved' | 'remission';
  onsetDate?: string;
  notes?: string;
}

export interface MedicationEntry {
  id: string;
  drug: string;
  dose: string;
  frequency: string;
  startedOn?: string;
}

export interface ImmunizationEntry {
  id: string;
  vaccine: string;
  date: string;
  lot?: string;
}

export interface FamilyHistoryEntry {
  id: string;
  relationship: string;
  condition: string;
  ageAtDiagnosis?: string;
}

export interface MedicalRecord {
  /** Foreign key — links to the User in auth. */
  userId: string;
  // Demographics
  fullName: string;
  preferredName?: string;
  birthDate?: string;
  sex: 'M' | 'F' | 'X';
  bloodType?: 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-' | '';
  weightKg?: string;
  heightCm?: string;
  // Contact
  phone?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  address?: string;
  // Lifestyle
  smoker: 'never' | 'former' | 'current' | '';
  alcohol: 'none' | 'occasional' | 'regular' | '';
  exerciseFrequency?: string;
  // Insurance
  insurancePayor?: string;
  insurancePlan?: string;
  insuranceMemberId?: string;
  // Medical lists
  allergies: AllergyEntry[];
  conditions: ConditionEntry[];
  medications: MedicationEntry[];
  immunizations: ImmunizationEntry[];
  familyHistory: FamilyHistoryEntry[];
  // Free-text
  notes?: string;
  updatedAt: number;
}

const STORAGE_PREFIX = 'dr-abc:medical-record:';

export function emptyRecord(userId: string, fullName = ''): MedicalRecord {
  return {
    userId,
    fullName,
    sex: 'X',
    smoker: '',
    alcohol: '',
    allergies: [],
    conditions: [],
    medications: [],
    immunizations: [],
    familyHistory: [],
    updatedAt: Date.now(),
  };
}

export function loadRecord(userId: string): MedicalRecord | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${userId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MedicalRecord;
  } catch {
    return null;
  }
}

export function saveRecord(record: MedicalRecord): void {
  if (typeof window === 'undefined') return;
  const next = { ...record, updatedAt: Date.now() };
  window.localStorage.setItem(`${STORAGE_PREFIX}${record.userId}`, JSON.stringify(next));
}

/**
 * Wipe every Mörbius local artifact for the given user.
 *
 * Removes: medical record, consult history, every per-consult
 * transcript + snapshot, narrator-seen marker, profile-prefill state.
 * Does NOT touch the auth session — sign-out is the caller's job.
 *
 * Destructive operation, gated by PIN / passkey via
 * DestructiveConfirm — never call this directly without re-auth.
 */
export function purgeUserData(userId: string): void {
  if (typeof window === 'undefined' || !userId) return;
  const ls = window.localStorage;
  const removeKeys: string[] = [];
  // Mass-key sweep so any future per-user prefix lands in the same
  // wipe without code changes here. Anything keyed by `:userId` or
  // `:<userId>:<consult>` goes.
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i);
    if (!k) continue;
    if (
      k === `${STORAGE_PREFIX}${userId}` ||
      k.startsWith(`dr-abc:consult-history:${userId}`) ||
      k.startsWith(`dr-abc:consult-turns:${userId}:`) ||
      k.startsWith(`dr-abc:consult-snapshot:${userId}:`) ||
      k === `dr-abc:narrator-seen:${userId}`
    ) {
      removeKeys.push(k);
    }
  }
  for (const k of removeKeys) ls.removeItem(k);
}

export function addRecordEntry<
  K extends 'allergies' | 'conditions' | 'medications' | 'immunizations' | 'familyHistory',
>(record: MedicalRecord, key: K, entry: MedicalRecord[K][number]): MedicalRecord {
  return { ...record, [key]: [...record[key], entry] };
}

export function removeRecordEntry<
  K extends 'allergies' | 'conditions' | 'medications' | 'immunizations' | 'familyHistory',
>(record: MedicalRecord, key: K, id: string): MedicalRecord {
  return { ...record, [key]: record[key].filter((e) => e.id !== id) };
}

export function newId(): string {
  return `e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

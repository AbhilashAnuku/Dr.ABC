import type { AllergyIntoleranceRow, ConditionRow, CoverageRow, PatientRow } from '@dr-abc/db';
import { BaseAgent } from '@dr-abc/morbius-core';
import { AgentKind, Intent, type OrchestratorEvent, type Task } from '@dr-abc/types';

/**
 * The unified Patient bundle the Profile Agent emits — flat-list FHIR
 * resources keyed by Patient.id, suitable for direct rendering or for
 * passing to the Diagnostic Agent as case context.
 */
export interface PatientBundle {
  patient: PatientRow;
  coverage: CoverageRow[];
  allergies: AllergyIntoleranceRow[];
  conditions: ConditionRow[];
}

export type ProfileAction =
  | { kind: 'read'; patientIdHash: string }
  | {
      kind: 'add-allergy';
      patientIdHash: string;
      substance: string;
      category: AllergyIntoleranceRow['category'];
      criticality?: AllergyIntoleranceRow['criticality'];
    }
  | {
      kind: 'add-condition';
      patientIdHash: string;
      display: string;
      code?: string;
      severity?: ConditionRow['severity'];
    };

export interface ProfileOutput {
  action: ProfileAction['kind'];
  bundle: PatientBundle | null;
  storeUsed: string;
  message: string;
}

/**
 * ProfileStore — the swappable surface for patient persistence.
 *
 *   V0 (this PR):  InMemoryProfileStore — synchronous Maps, fixture seed.
 *   V1 (Phase 4):  PgFhirProfileStore — Drizzle over Postgres, audited
 *                  via the Privacy Agent. Same interface; drop-in.
 */
export interface ProfileStore {
  readonly name: string;
  read(patientIdHash: string): Promise<PatientBundle | null>;
  addAllergy(input: {
    patientIdHash: string;
    substance: string;
    category: AllergyIntoleranceRow['category'];
    criticality?: AllergyIntoleranceRow['criticality'];
  }): Promise<AllergyIntoleranceRow>;
  addCondition(input: {
    patientIdHash: string;
    display: string;
    code?: string;
    severity?: ConditionRow['severity'];
  }): Promise<ConditionRow>;
}

// ---------------------------------------------------------------
//  In-memory implementation — V0
// ---------------------------------------------------------------
export class InMemoryProfileStore implements ProfileStore {
  readonly name = 'in-memory';
  private patients = new Map<string, PatientRow>();
  private coverages = new Map<string, CoverageRow[]>();
  private allergies = new Map<string, AllergyIntoleranceRow[]>();
  private conditions = new Map<string, ConditionRow[]>();

  constructor(seed?: PatientBundle[]) {
    for (const b of seed ?? []) this.installBundle(b);
  }

  private installBundle(b: PatientBundle): void {
    this.patients.set(b.patient.patientIdHash, b.patient);
    this.coverages.set(b.patient.id, [...b.coverage]);
    this.allergies.set(b.patient.id, [...b.allergies]);
    this.conditions.set(b.patient.id, [...b.conditions]);
  }

  async read(patientIdHash: string): Promise<PatientBundle | null> {
    const patient = this.patients.get(patientIdHash);
    if (!patient) return null;
    return {
      patient,
      coverage: this.coverages.get(patient.id) ?? [],
      allergies: this.allergies.get(patient.id) ?? [],
      conditions: this.conditions.get(patient.id) ?? [],
    };
  }

  async addAllergy(input: {
    patientIdHash: string;
    substance: string;
    category: AllergyIntoleranceRow['category'];
    criticality?: AllergyIntoleranceRow['criticality'];
  }): Promise<AllergyIntoleranceRow> {
    const patient = this.requirePatient(input.patientIdHash);
    const row: AllergyIntoleranceRow = {
      id: crypto.randomUUID(),
      patientId: patient.id,
      clinicalStatus: 'active',
      verificationStatus: 'confirmed',
      category: input.category,
      criticality: input.criticality ?? 'low',
      substance: input.substance,
      reactions: [],
      recordedAt: new Date(),
    };
    const list = this.allergies.get(patient.id) ?? [];
    list.push(row);
    this.allergies.set(patient.id, list);
    return row;
  }

  async addCondition(input: {
    patientIdHash: string;
    display: string;
    code?: string;
    severity?: ConditionRow['severity'];
  }): Promise<ConditionRow> {
    const patient = this.requirePatient(input.patientIdHash);
    const row: ConditionRow = {
      id: crypto.randomUUID(),
      patientId: patient.id,
      clinicalStatus: 'active',
      verificationStatus: 'confirmed',
      code: input.code ?? null,
      display: input.display,
      severity: input.severity ?? null,
      onsetDateTime: new Date(),
      notes: [],
      recordedAt: new Date(),
    };
    const list = this.conditions.get(patient.id) ?? [];
    list.push(row);
    this.conditions.set(patient.id, list);
    return row;
  }

  private requirePatient(patientIdHash: string): PatientRow {
    const p = this.patients.get(patientIdHash);
    if (!p) throw new Error(`Patient not found for hash ${patientIdHash}`);
    return p;
  }
}

// ---------------------------------------------------------------
//  Profile Agent
// ---------------------------------------------------------------
export interface ProfileInput {
  text?: string;
  action?: ProfileAction;
}

export class ProfileAgent extends BaseAgent<ProfileInput, ProfileOutput> {
  readonly kind = AgentKind.Profile;
  readonly version = '0.1.0';
  readonly minConfidence = 0.5;

  constructor(private store: ProfileStore) {
    super();
  }

  canHandle(task: Task): boolean {
    return task.intent === Intent.ProfileOp;
  }

  protected async reason(
    task: Task<ProfileInput>,
    emit: (e: OrchestratorEvent) => void,
  ): Promise<{
    data: ProfileOutput;
    confidence: number;
    evidence: string[];
    warnings: string[];
  }> {
    const action = this.resolveAction(task);

    emit({
      type: 'agent.token',
      agent: this.kind,
      token: `Resolving profile op: ${action.kind} via ${this.store.name}`,
    });

    if (action.kind === 'read') {
      const bundle = await this.store.read(action.patientIdHash);
      if (!bundle) {
        return {
          data: {
            action: 'read',
            bundle: null,
            storeUsed: this.store.name,
            message: `No patient profile found for hash ${action.patientIdHash.slice(0, 8)}…`,
          },
          confidence: 0.4,
          evidence: [],
          warnings: ['profile-not-found'],
        };
      }
      return {
        data: {
          action: 'read',
          bundle,
          storeUsed: this.store.name,
          message: `Loaded ${bundle.allergies.length} allergies, ${bundle.conditions.length} conditions, ${bundle.coverage.length} coverage records.`,
        },
        confidence: 0.92,
        evidence: [
          `patient:${bundle.patient.id}`,
          `allergies:${bundle.allergies.length}`,
          `conditions:${bundle.conditions.length}`,
        ],
        warnings: [],
      };
    }

    if (action.kind === 'add-allergy') {
      const row = await this.store.addAllergy(action);
      const bundle = await this.store.read(action.patientIdHash);
      return {
        data: {
          action: 'add-allergy',
          bundle,
          storeUsed: this.store.name,
          message: `Recorded allergy: ${row.substance} (${row.category}, ${row.criticality}).`,
        },
        confidence: 0.95,
        evidence: [`allergy:${row.id}`, `substance:${row.substance}`],
        warnings: [],
      };
    }

    // add-condition
    const row = await this.store.addCondition(action);
    const bundle = await this.store.read(action.patientIdHash);
    return {
      data: {
        action: 'add-condition',
        bundle,
        storeUsed: this.store.name,
        message: `Recorded condition: ${row.display}${row.code ? ` (${row.code})` : ''}.`,
      },
      confidence: 0.95,
      evidence: [`condition:${row.id}`, `display:${row.display}`],
      warnings: [],
    };
  }

  /**
   * V0: structured `action` on the payload wins. Otherwise default to a
   * read against `task.context.patientIdHash`. Free-text intent parsing
   * is a follow-up — this PR just wires the deterministic shape.
   */
  private resolveAction(task: Task<ProfileInput>): ProfileAction {
    const payload = task.payload;
    if (payload && typeof payload === 'object' && 'action' in payload && payload.action) {
      return payload.action;
    }
    const ctxHash = task.context.patientIdHash;
    if (ctxHash) {
      return { kind: 'read', patientIdHash: ctxHash };
    }
    throw new Error(
      'ProfileAgent invoked without an explicit action and no patientIdHash on the task context',
    );
  }
}

// ---------------------------------------------------------------
//  Seed bundle — for dev, smoke test, and demo.
//  All fields are synthetic. NO real PHI ever.
// ---------------------------------------------------------------
const seedPatientId = 'p_demo_001';
const seedHash = 'demo-hash-architect';

export const DEMO_BUNDLE: PatientBundle = {
  patient: {
    id: seedPatientId,
    patientIdHash: seedHash,
    displayName: 'Architect Demo Patient',
    gender: 'X',
    birthDate: '1990-04-25',
    active: true,
    preferredLanguage: 'en-US',
    fhirExtra: {
      telecom: [{ system: 'email', value: 'demo@dr-abc.local', use: 'home' }],
    },
    createdAt: new Date('2026-04-25T00:00:00Z'),
    updatedAt: new Date('2026-04-25T00:00:00Z'),
  },
  coverage: [
    {
      id: 'c_demo_001',
      patientId: seedPatientId,
      status: 'active',
      payor: 'DemoCare Insurance',
      subscriberId: 'DEMO-12345',
      fhirExtra: { plan: { name: 'DemoCare Gold' } },
      createdAt: new Date('2026-01-01T00:00:00Z'),
    },
  ],
  allergies: [
    {
      id: 'a_demo_001',
      patientId: seedPatientId,
      clinicalStatus: 'active',
      verificationStatus: 'confirmed',
      category: 'medication',
      criticality: 'high',
      substance: 'Penicillin',
      reactions: [{ manifestation: 'urticaria', severity: 'moderate' }],
      recordedAt: new Date('2025-08-12T00:00:00Z'),
    },
  ],
  conditions: [
    {
      id: 'cd_demo_001',
      patientId: seedPatientId,
      clinicalStatus: 'active',
      verificationStatus: 'confirmed',
      code: 'I10',
      display: 'Essential (primary) hypertension',
      severity: 'moderate',
      onsetDateTime: new Date('2024-06-15T00:00:00Z'),
      notes: ['well-controlled on lisinopril 10mg daily'],
      recordedAt: new Date('2024-06-15T00:00:00Z'),
    },
  ],
};

/** Convenience factory: returns a Profile Agent over the demo bundle. */
export function createDemoProfileAgent(): ProfileAgent {
  return new ProfileAgent(new InMemoryProfileStore([DEMO_BUNDLE]));
}

export const DEMO_PATIENT_HASH = seedHash;

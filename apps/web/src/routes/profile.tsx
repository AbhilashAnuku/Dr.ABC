import { Button, Card, Section as PageSection, cn } from '@dr-abc/ui';
import {
  AlertTriangle,
  Calendar,
  Download,
  FileText,
  Heart,
  HeartPulse,
  Home,
  Pill,
  Plus,
  Save,
  ShieldCheck,
  Syringe,
  Trash2,
  User as UserIcon,
  Users,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { DeviceConnect } from '../components/device-connect/device-connect.tsx';
import { InsuranceRecommenderCard } from '../components/insurance/insurance-recommender-card.tsx';
import { useAuth } from '../lib/auth.tsx';
import { type ConsultHistoryEntry, loadConsultHistory } from '../lib/consult-history.ts';
import { buildConsultsPdf } from '../lib/consults-pdf.ts';
import {
  type AllergyEntry,
  type ConditionEntry,
  type FamilyHistoryEntry,
  type ImmunizationEntry,
  type MedicalRecord,
  type MedicationEntry,
  addRecordEntry,
  emptyRecord,
  loadRecord,
  newId,
  removeRecordEntry,
  saveRecord,
} from '../lib/medical-record.ts';

/**
 * /app/profile — the patient's real medical record.
 *
 * Persisted per-user in localStorage (FHIR-shaped, see
 * lib/medical-record.ts). Patient + Doctor + Developer roles all see
 * this; Doctors get the same shape so they can demo the consult flow
 * with their own dummy record.
 */
export function ProfilePage() {
  const { user } = useAuth();
  const [record, setRecord] = useState<MedicalRecord | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    const existing = loadRecord(user.id);
    setRecord(existing ?? emptyRecord(user.id, user.name));
  }, [user]);

  if (!user || !record) return null;

  const persist = (next: MedicalRecord) => {
    setRecord(next);
    saveRecord(next);
    setSavedAt(Date.now());
  };

  const update = <K extends keyof MedicalRecord>(key: K, value: MedicalRecord[K]) => {
    persist({ ...record, [key]: value });
  };

  // Single-user mode: one header — chart-review framing for the demo
  // identity who owns + signs off every consult.
  const headerTitle = `Patient Record · ${record.fullName}`;
  const headerSub =
    'Chart used by every consultation. Auto-saves locally · the consult prefills from this on open.';

  return (
    <div className="space-y-6">
      <PageSection
        kicker="patient record · auto-saved · FHIR-shaped"
        title={headerTitle}
        description={headerSub}
      >
        {savedAt && (
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-bio-300">
            saved {new Date(savedAt).toLocaleTimeString()}
          </span>
        )}
      </PageSection>

      <DeviceConnect userId={user.id} />

      <RecentConsultsSection
        userId={user.id}
        patientName={record.fullName}
        recordSex={record.sex}
      />

      <Section icon={UserIcon} title="Demographics">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label="Full name"
            value={record.fullName}
            onChange={(v) => update('fullName', v)}
          />
          <Field
            label="Preferred name"
            value={record.preferredName ?? ''}
            onChange={(v) => update('preferredName', v)}
          />
          <Field
            label="Date of birth"
            type="date"
            value={record.birthDate ?? ''}
            onChange={(v) => update('birthDate', v)}
          />
          <SelectField
            label="Sex"
            value={record.sex}
            options={[
              { value: 'F', label: 'Female' },
              { value: 'M', label: 'Male' },
              { value: 'X', label: 'Other / not stated' },
            ]}
            onChange={(v) => update('sex', v as 'F' | 'M' | 'X')}
          />
          <SelectField
            label="Blood type"
            value={record.bloodType ?? ''}
            options={[
              { value: '', label: 'Unknown' },
              ...['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'].map((b) => ({
                value: b,
                label: b,
              })),
            ]}
            onChange={(v) => update('bloodType', v as MedicalRecord['bloodType'])}
          />
          <Field
            label="Weight (kg)"
            value={record.weightKg ?? ''}
            onChange={(v) => update('weightKg', v)}
            placeholder="80"
          />
          <Field
            label="Height (cm)"
            value={record.heightCm ?? ''}
            onChange={(v) => update('heightCm', v)}
            placeholder="178"
          />
        </div>
      </Section>

      <Section icon={Home} title="Contact + Emergency">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label="Phone"
            value={record.phone ?? ''}
            onChange={(v) => update('phone', v)}
            placeholder="+49 30 5550101"
          />
          <Field
            label="Address"
            value={record.address ?? ''}
            onChange={(v) => update('address', v)}
            placeholder="Friedrichstraße 100, 10117 Berlin"
          />
          <Field
            label="Emergency contact"
            value={record.emergencyContactName ?? ''}
            onChange={(v) => update('emergencyContactName', v)}
          />
          <Field
            label="Emergency phone"
            value={record.emergencyContactPhone ?? ''}
            onChange={(v) => update('emergencyContactPhone', v)}
          />
        </div>
      </Section>

      <Section icon={HeartPulse} title="Lifestyle">
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField
            label="Smoking status"
            value={record.smoker}
            options={[
              { value: '', label: '—' },
              { value: 'never', label: 'Never' },
              { value: 'former', label: 'Former' },
              { value: 'current', label: 'Current' },
            ]}
            onChange={(v) => update('smoker', v as MedicalRecord['smoker'])}
          />
          <SelectField
            label="Alcohol"
            value={record.alcohol}
            options={[
              { value: '', label: '—' },
              { value: 'none', label: 'None' },
              { value: 'occasional', label: 'Occasional' },
              { value: 'regular', label: 'Regular' },
            ]}
            onChange={(v) => update('alcohol', v as MedicalRecord['alcohol'])}
          />
          <Field
            label="Exercise (sessions/wk)"
            value={record.exerciseFrequency ?? ''}
            onChange={(v) => update('exerciseFrequency', v)}
            placeholder="3"
          />
        </div>
      </Section>

      <Section icon={AlertTriangle} title="Allergies + Intolerances">
        <ListEditor<AllergyEntry>
          items={record.allergies}
          onAdd={() =>
            persist(
              addRecordEntry(record, 'allergies', {
                id: newId(),
                substance: '',
                severity: 'moderate',
                reaction: '',
              }),
            )
          }
          onRemove={(id) => persist(removeRecordEntry(record, 'allergies', id))}
          onChange={(id, next) =>
            persist({
              ...record,
              allergies: record.allergies.map((a) => (a.id === id ? next : a)),
            })
          }
          render={(item, set) => (
            <>
              <Field
                label="Substance"
                value={item.substance}
                onChange={(v) => set({ ...item, substance: v })}
                placeholder="Penicillin"
              />
              <SelectField
                label="Severity"
                value={item.severity}
                options={[
                  { value: 'mild', label: 'Mild' },
                  { value: 'moderate', label: 'Moderate' },
                  { value: 'severe', label: 'Severe' },
                ]}
                onChange={(v) => set({ ...item, severity: v as AllergyEntry['severity'] })}
              />
              <Field
                label="Reaction"
                value={item.reaction ?? ''}
                onChange={(v) => set({ ...item, reaction: v })}
                placeholder="Urticaria"
              />
            </>
          )}
          empty="No known allergies. Add one if you've had a reaction to a drug, food, or environmental trigger."
          addLabel="Add allergy"
        />
      </Section>

      <Section icon={Heart} title="Conditions / Diagnoses">
        <ListEditor<ConditionEntry>
          items={record.conditions}
          onAdd={() =>
            persist(
              addRecordEntry(record, 'conditions', {
                id: newId(),
                display: '',
                status: 'active',
              }),
            )
          }
          onRemove={(id) => persist(removeRecordEntry(record, 'conditions', id))}
          onChange={(id, next) =>
            persist({
              ...record,
              conditions: record.conditions.map((c) => (c.id === id ? next : c)),
            })
          }
          render={(item, set) => (
            <>
              <Field
                label="Condition"
                value={item.display}
                onChange={(v) => set({ ...item, display: v })}
                placeholder="Essential hypertension"
              />
              <Field
                label="ICD-10"
                value={item.icd10 ?? ''}
                onChange={(v) => set({ ...item, icd10: v })}
                placeholder="I10"
              />
              <SelectField
                label="Status"
                value={item.status}
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'remission', label: 'Remission' },
                  { value: 'resolved', label: 'Resolved' },
                ]}
                onChange={(v) => set({ ...item, status: v as ConditionEntry['status'] })}
              />
              <Field
                label="Onset"
                type="date"
                value={item.onsetDate ?? ''}
                onChange={(v) => set({ ...item, onsetDate: v })}
              />
              <Field
                label="Notes"
                value={item.notes ?? ''}
                onChange={(v) => set({ ...item, notes: v })}
                placeholder="Well-controlled"
              />
            </>
          )}
          empty="No active diagnoses recorded."
          addLabel="Add condition"
        />
      </Section>

      <Section icon={Pill} title="Current Medications">
        <ListEditor<MedicationEntry>
          items={record.medications}
          onAdd={() =>
            persist(
              addRecordEntry(record, 'medications', {
                id: newId(),
                drug: '',
                dose: '',
                frequency: '',
              }),
            )
          }
          onRemove={(id) => persist(removeRecordEntry(record, 'medications', id))}
          onChange={(id, next) =>
            persist({
              ...record,
              medications: record.medications.map((m) => (m.id === id ? next : m)),
            })
          }
          render={(item, set) => (
            <>
              <Field
                label="Drug"
                value={item.drug}
                onChange={(v) => set({ ...item, drug: v })}
                placeholder="Lisinopril"
              />
              <Field
                label="Dose"
                value={item.dose}
                onChange={(v) => set({ ...item, dose: v })}
                placeholder="10 mg PO"
              />
              <Field
                label="Frequency"
                value={item.frequency}
                onChange={(v) => set({ ...item, frequency: v })}
                placeholder="once daily"
              />
              <Field
                label="Started on"
                type="date"
                value={item.startedOn ?? ''}
                onChange={(v) => set({ ...item, startedOn: v })}
              />
            </>
          )}
          empty="No current medications recorded."
          addLabel="Add medication"
        />
      </Section>

      <Section icon={Syringe} title="Immunizations">
        <ListEditor<ImmunizationEntry>
          items={record.immunizations}
          onAdd={() =>
            persist(
              addRecordEntry(record, 'immunizations', {
                id: newId(),
                vaccine: '',
                date: new Date().toISOString().slice(0, 10),
              }),
            )
          }
          onRemove={(id) => persist(removeRecordEntry(record, 'immunizations', id))}
          onChange={(id, next) =>
            persist({
              ...record,
              immunizations: record.immunizations.map((i) => (i.id === id ? next : i)),
            })
          }
          render={(item, set) => (
            <>
              <Field
                label="Vaccine"
                value={item.vaccine}
                onChange={(v) => set({ ...item, vaccine: v })}
                placeholder="Tetanus booster"
              />
              <Field
                label="Date"
                type="date"
                value={item.date}
                onChange={(v) => set({ ...item, date: v })}
              />
              <Field
                label="Lot #"
                value={item.lot ?? ''}
                onChange={(v) => set({ ...item, lot: v })}
              />
            </>
          )}
          empty="No immunizations recorded."
          addLabel="Add immunization"
        />
      </Section>

      <Section icon={Users} title="Family History">
        <ListEditor<FamilyHistoryEntry>
          items={record.familyHistory}
          onAdd={() =>
            persist(
              addRecordEntry(record, 'familyHistory', {
                id: newId(),
                relationship: '',
                condition: '',
              }),
            )
          }
          onRemove={(id) => persist(removeRecordEntry(record, 'familyHistory', id))}
          onChange={(id, next) =>
            persist({
              ...record,
              familyHistory: record.familyHistory.map((f) => (f.id === id ? next : f)),
            })
          }
          render={(item, set) => (
            <>
              <Field
                label="Relationship"
                value={item.relationship}
                onChange={(v) => set({ ...item, relationship: v })}
                placeholder="Father"
              />
              <Field
                label="Condition"
                value={item.condition}
                onChange={(v) => set({ ...item, condition: v })}
                placeholder="Type 2 diabetes"
              />
              <Field
                label="Age at dx"
                value={item.ageAtDiagnosis ?? ''}
                onChange={(v) => set({ ...item, ageAtDiagnosis: v })}
                placeholder="55"
              />
            </>
          )}
          empty="No family-history items recorded."
          addLabel="Add family member"
        />
      </Section>

      <Section icon={ShieldCheck} title="Insurance">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            label="Payor"
            value={record.insurancePayor ?? ''}
            onChange={(v) => update('insurancePayor', v)}
            placeholder="Techniker Krankenkasse"
          />
          <Field
            label="Plan"
            value={record.insurancePlan ?? ''}
            onChange={(v) => update('insurancePlan', v)}
            placeholder="Standard GKV"
          />
          <Field
            label="Member ID"
            value={record.insuranceMemberId ?? ''}
            onChange={(v) => update('insuranceMemberId', v)}
          />
        </div>

        {/* Mörbius's plan recommender -- reads the active conditions
            from the record above and scores AOK / Techniker / Barmer /
            DAK / BKK Mobil / KKH / PKV-Allianz across six axes. */}
        <div className="mt-4">
          <InsuranceRecommenderCard record={record} />
        </div>
      </Section>

      <Section icon={Calendar} title="Notes">
        <textarea
          rows={4}
          value={record.notes ?? ''}
          onChange={(e) => update('notes', e.target.value)}
          placeholder="Anything else your clinician should know — recent travel, stressors, dietary preferences, advance directives, …"
          className="w-full resize-none rounded-md border border-app-subtle bg-white/5 px-3 py-2 font-sans text-sm text-app-primary placeholder:text-app-faint/60 focus:border-quantum-400/60 focus:outline-none"
        />
        <div className="mt-3 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
            last updated {new Date(record.updatedAt).toLocaleString()}
          </span>
          <Button variant="ghost" onClick={() => persist(record)}>
            <Save className="mr-1.5 h-3.5 w-3.5" /> Save
          </Button>
        </div>
      </Section>

      {/* Wellness lives on its own /app/wellness route to avoid
          duplicating the records view. ProfilePage now renders the
          FHIR record + medical history only. The WellnessPage
          component continues to live in /app/wellness on its own. */}
    </div>
  );
}

// ============================================================
//  Sub-components
// ============================================================

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon?: typeof UserIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center gap-2">
        {Icon && <Icon className="h-4 w-4 text-quantum-400" />}
        <h2 className="font-display text-lg font-semibold text-app-primary">{title}</h2>
      </div>
      {children}
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'date';
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-app-faint">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="rounded-md border border-app-subtle bg-white/5 px-2.5 py-1.5 font-sans text-sm text-app-primary placeholder:text-app-faint/60 focus:border-quantum-400/60 focus:outline-none"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-app-faint">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-app-subtle bg-white/5 px-2.5 py-1.5 font-sans text-sm text-app-primary focus:border-quantum-400/60 focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-ink-950 text-app-primary">
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

interface ListEditorProps<T extends { id: string }> {
  items: T[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChange: (id: string, next: T) => void;
  render: (item: T, set: (next: T) => void) => ReactNode;
  empty: string;
  addLabel: string;
}

function ListEditor<T extends { id: string }>({
  items,
  onAdd,
  onRemove,
  onChange,
  render,
  empty,
  addLabel,
}: ListEditorProps<T>) {
  return (
    <div className="space-y-3">
      {items.length === 0 && <p className="font-sans text-xs text-app-faint">{empty}</p>}
      {items.map((item) => (
        <div key={item.id} className="rounded-lg border border-app-subtle bg-white/[0.02] p-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {render(item, (next) => onChange(item.id, next))}
          </div>
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => onRemove(item.id)}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/5 px-2 py-0.5',
                'font-mono text-[10px] uppercase tracking-[0.16em] text-red-300 hover:bg-red-500/15',
              )}
            >
              <Trash2 className="h-3 w-3" /> remove
            </button>
          </div>
        </div>
      ))}
      <Button variant="ghost" onClick={onAdd}>
        <Plus className="mr-1.5 h-3.5 w-3.5" /> {addLabel}
      </Button>
    </div>
  );
}

function RecentConsultsSection({
  userId,
  patientName,
  recordSex: _recordSex,
}: {
  userId: string;
  patientName: string;
  recordSex: 'F' | 'M' | 'X';
}) {
  const [consults, setConsults] = useState<ConsultHistoryEntry[]>([]);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    setConsults(loadConsultHistory(userId));
  }, [userId]);

  const last5 = useMemo(() => consults.slice(0, 5), [consults]);

  const downloadSummary = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const pdfBytes = await buildConsultsPdf({
        patientName,
        consults: last5,
      });
      const ab = new ArrayBuffer(pdfBytes.byteLength);
      new Uint8Array(ab).set(pdfBytes);
      const blob = new Blob([ab], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `morbius-consults-${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Section icon={FileText} title="Recent consults">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="font-sans text-xs text-app-muted">
          {consults.length === 0
            ? 'No consults logged yet — open the Consult page to record one.'
            : `${consults.length} consult${consults.length === 1 ? '' : 's'} on file. The summary PDF includes the most recent ${Math.min(5, consults.length)}.`}
        </p>
        <button
          type="button"
          onClick={downloadSummary}
          disabled={consults.length === 0 || downloading}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] transition',
            consults.length === 0
              ? 'cursor-not-allowed border-app-subtle text-app-faint opacity-50'
              : 'border-bio-500/40 bg-bio-500/10 text-bio-300 hover:bg-bio-500/20',
          )}
        >
          <Download className="h-3 w-3" /> {downloading ? 'building…' : 'save last 5 (PDF)'}
        </button>
      </div>
      {last5.length > 0 && (
        <ul className="space-y-2">
          {last5.map((c) => {
            const date = new Date(c.startedAt).toISOString().slice(0, 16).replace('T', ' ');
            const conf = c.topProb !== undefined ? ` · ${Math.round(c.topProb * 100)}%` : '';
            return (
              <li
                key={c.id}
                className="rounded-lg border border-app-subtle bg-white/[0.02] px-3 py-2"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
                    {date}
                  </span>
                  {c.prescriptionIssued && (
                    <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-bio-300">
                      Rx issued
                    </span>
                  )}
                </div>
                <div className="mt-1 truncate font-sans text-sm text-app-primary">
                  {c.complaint}
                </div>
                {c.topCondition && (
                  <div className="mt-0.5 font-sans text-xs text-app-muted">
                    → {c.topCondition}
                    {conf}
                    {c.specialty ? ` · ${c.specialty}` : ''}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

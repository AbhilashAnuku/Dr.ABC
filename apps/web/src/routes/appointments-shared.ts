/**
 * Shared shape + helpers between PatientAppointmentsPage (booking) and
 * DoctorAppointmentsPage (provider schedule). The two role surfaces are
 * different enough to be sibling components, but they need to agree on
 * the data shape so a doctor can see a patient's booking and vice
 * versa once a real backend lands.
 */

export type ApptType = 'gp' | 'specialist' | 'video' | 'follow-up';

export interface Appointment {
  id: string;
  type: ApptType;
  date: string;
  time: string;
  reason: string;
  notes?: string;
  status: 'upcoming' | 'past';
  clinician?: string;
  /** Used by the doctor view only — the patient initiating the booking. */
  patientName?: string;
  /** Doctor-side hint: did the patient show up. Defaults to undefined
   *  for upcoming items; doctor can flip it on past slots. */
  noShow?: boolean;
}

export const TYPE_TONE: Record<ApptType, string> = {
  gp: 'border-quantum-400/30 text-quantum-300',
  specialist: 'border-bio-500/30 text-bio-300',
  video: 'border-amber-500/30 text-amber-300',
  'follow-up': 'border-rose-500/30 text-rose-300',
};

/** Two seed slots so the page is never empty on a fresh login. */
export const PATIENT_SEED: Appointment[] = [
  {
    id: 'apt_1',
    type: 'gp',
    date: '2026-05-15',
    time: '10:30',
    reason: 'Annual check-up',
    status: 'upcoming',
    clinician: 'Dr. Schneider · Charité Mitte',
  },
  {
    id: 'apt_2',
    type: 'specialist',
    date: '2026-06-04',
    time: '14:00',
    reason: 'Follow-up: hypertension',
    status: 'upcoming',
    clinician: 'Dr. Müller · Cardiology',
  },
];

/** A full week of bookings + a couple of incoming requests so the
 *  doctor schedule grid has signal on first paint. */
export const DOCTOR_SEED: Appointment[] = [
  {
    id: 'apt_d1',
    type: 'gp',
    date: '2026-04-29',
    time: '09:00',
    reason: 'Annual check-up',
    patientName: 'Maya Becker',
    status: 'upcoming',
  },
  {
    id: 'apt_d2',
    type: 'follow-up',
    date: '2026-04-29',
    time: '10:30',
    reason: 'Hypertension follow-up',
    patientName: 'Arjun Patel',
    status: 'upcoming',
  },
  {
    id: 'apt_d3',
    type: 'specialist',
    date: '2026-04-30',
    time: '11:00',
    reason: 'Cardiology consult — chest pain workup',
    patientName: 'Sara Klein',
    status: 'upcoming',
  },
  {
    id: 'apt_d4',
    type: 'video',
    date: '2026-05-02',
    time: '15:30',
    reason: 'Telehealth · medication review',
    patientName: 'Lukas Weber',
    status: 'upcoming',
  },
  {
    id: 'apt_d5',
    type: 'gp',
    date: '2026-04-28',
    time: '08:30',
    reason: 'Sore throat',
    patientName: 'Elena Russo',
    status: 'upcoming',
  },
];

export const INPUT_CLS =
  'w-full rounded-lg border border-app-subtle bg-white/5 px-3 py-2 font-sans text-sm text-app-primary focus:border-quantum-400/60 focus:outline-none';
export const SELECT_CLS = INPUT_CLS;

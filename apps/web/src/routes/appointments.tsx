import { DoctorAppointmentsPage } from './appointments-doctor.tsx';

/**
 * Appointments — single demo user gets the richer doctor-style schedule
 * grid (7-day view + incoming queue + no-show tracker). The patient
 * booking variant is reachable from the dashboard quick-action when
 * needed but is no longer the default for this route.
 */
export function AppointmentsPage() {
  return <DoctorAppointmentsPage />;
}

import { Button, Card, cn } from '@dr-abc/ui';
import { CalendarClock, ChevronLeft, ChevronRight, FileText, UserX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { type Appointment, DOCTOR_SEED, TYPE_TONE } from './appointments-shared.ts';

/**
 * Doctor schedule view. Three panels:
 *   - 7-day schedule grid (week navigation, day columns, appointment
 *     cards stacked by time).
 *   - Incoming queue list (upcoming items ordered by date, with the
 *     patient name + a quick "open chart" link to /app/clinic).
 *   - No-show tracker (recently-past slots flagged for follow-up).
 */
export function DoctorAppointmentsPage() {
  const [appts, setAppts] = useState<Appointment[]>(DOCTOR_SEED);
  const [weekAnchor, setWeekAnchor] = useState<Date>(() => mondayOf(new Date('2026-04-28')));

  const weekDays = useMemo(() => buildWeek(weekAnchor), [weekAnchor]);
  const byDay = useMemo(() => groupByDay(appts, weekDays), [appts, weekDays]);
  const queue = useMemo(
    () => appts.filter((a) => a.status === 'upcoming').sort(byDateTime),
    [appts],
  );

  const flagNoShow = (id: string) => {
    setAppts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, noShow: true, status: 'past' as const } : a)),
    );
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-app-primary sm:text-4xl">
            Provider Schedule
          </h1>
          <p className="mt-2 font-sans text-sm text-app-muted">
            Your clinic week · incoming queue · no-show tracker. Tap a row to open the patient chart
            in /app/clinic.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setWeekAnchor(addDays(weekAnchor, -7))}>
            <ChevronLeft className="mr-1 h-4 w-4" /> Prev week
          </Button>
          <Button variant="ghost" onClick={() => setWeekAnchor(addDays(weekAnchor, 7))}>
            Next week <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </header>

      <Card className="p-0">
        <div className="grid grid-cols-7 divide-x divide-app-subtle">
          {weekDays.map((d) => (
            <div key={d.toISOString()} className="min-h-[260px] p-3">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="font-display text-sm font-semibold text-app-primary">
                  {d.toLocaleDateString(undefined, { weekday: 'short' })}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
                  {d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
              </div>
              <div className="space-y-1.5">
                {byDay
                  .get(toIsoDate(d))
                  ?.map((a) => (
                    <ScheduleCell key={a.id} appt={a} onNoShow={() => flagNoShow(a.id)} />
                  )) ?? <EmptyDay />}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold text-app-primary">
            <CalendarClock className="h-4 w-4 text-quantum-400" />
            Incoming queue
          </h2>
          {queue.length === 0 ? (
            <p className="font-sans text-sm text-app-muted">Nothing on the books. Quiet day.</p>
          ) : (
            <ul className="space-y-2">
              {queue.map((a) => (
                <QueueRow key={a.id} appt={a} />
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold text-app-primary">
            <UserX className="h-4 w-4 text-rose-400" />
            No-shows · last 7 days
          </h2>
          <NoShowList appts={appts} />
        </Card>
      </div>
    </div>
  );
}

function ScheduleCell({ appt, onNoShow }: { appt: Appointment; onNoShow: () => void }) {
  return (
    <Link href="/app/clinic">
      <div
        className={cn(
          'cursor-pointer rounded-md border bg-white/3 p-2 transition-colors hover:bg-white/8',
          'border-app-subtle',
        )}
      >
        <div className="flex items-baseline justify-between gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
            {appt.time}
          </span>
          <span
            className={cn(
              'rounded-full border px-1.5 font-mono text-[9px] uppercase tracking-[0.18em]',
              TYPE_TONE[appt.type],
            )}
          >
            {appt.type}
          </span>
        </div>
        <div className="mt-1 truncate font-sans text-xs font-semibold text-app-primary">
          {appt.patientName ?? 'Patient'}
        </div>
        <div className="mt-0.5 truncate font-sans text-[11px] text-app-secondary">
          {appt.reason}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onNoShow();
          }}
          className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-rose-400 hover:text-rose-300"
        >
          flag no-show
        </button>
      </div>
    </Link>
  );
}

function EmptyDay() {
  return (
    <p className="rounded-md border border-dashed border-app-subtle p-2 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
      open
    </p>
  );
}

function QueueRow({ appt }: { appt: Appointment }) {
  return (
    <li className="flex items-center justify-between rounded-lg border border-app-subtle bg-white/5 px-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-display text-sm font-semibold text-app-primary">
          {appt.patientName ?? 'Patient'}
          <span
            className={cn(
              'rounded-full border px-1.5 font-mono text-[9px] uppercase tracking-[0.18em]',
              TYPE_TONE[appt.type],
            )}
          >
            {appt.type}
          </span>
        </div>
        <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-app-muted">
          {appt.date} · {appt.time} · {appt.reason}
        </div>
      </div>
      <Link
        href="/app/clinic"
        className="inline-flex items-center gap-1 rounded-md border border-quantum-400/40 bg-quantum-500/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-quantum-300 hover:bg-quantum-500/20"
      >
        <FileText className="h-3 w-3" /> open chart
      </Link>
    </li>
  );
}

function NoShowList({ appts }: { appts: Appointment[] }) {
  const noShows = appts.filter((a) => a.noShow);
  if (noShows.length === 0) {
    return (
      <p className="font-sans text-sm text-app-muted">
        No flagged no-shows in the past week. Patients are showing up.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {noShows.map((a) => (
        <li
          key={a.id}
          className="rounded-lg border border-rose-400/30 bg-rose-500/5 px-3 py-2 font-sans text-sm text-app-secondary"
        >
          <span className="font-semibold text-app-primary">{a.patientName ?? 'Patient'}</span> ·{' '}
          {a.date} {a.time} · {a.reason}
        </li>
      ))}
    </ul>
  );
}

// ============ pure date helpers (kept tiny on purpose) ============

function mondayOf(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay() || 7; // Sun → 7 so Mon is the anchor
  if (day !== 1) x.setHours(-24 * (day - 1));
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function buildWeek(anchor: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(anchor, i));
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function groupByDay(appts: Appointment[], days: Date[]): Map<string, Appointment[]> {
  const m = new Map<string, Appointment[]>();
  for (const d of days) m.set(toIsoDate(d), []);
  for (const a of appts) {
    const list = m.get(a.date);
    if (list) list.push(a);
  }
  for (const list of m.values()) list.sort((x, y) => x.time.localeCompare(y.time));
  return m;
}

function byDateTime(a: Appointment, b: Appointment): number {
  return `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`);
}

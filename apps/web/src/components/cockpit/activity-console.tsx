import { Button, Card, cn } from '@dr-abc/ui';
import { ChevronDown, ChevronRight, Pause, Play, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { type ActivityRow, useActivityTail } from '../../lib/cockpit-events.ts';

type RoleFilter = 'all' | 'patient' | 'doctor' | 'student' | 'developer' | 'system';
type StatusFilter = 'all' | 'ok' | 'error';

const ROLE_TONE: Record<ActivityRow['role'], string> = {
  patient: 'border-quantum-400/30 text-quantum-300',
  doctor: 'border-bio-500/30 text-bio-300',
  student: 'border-amber-500/30 text-amber-300',
  developer: 'border-rose-500/30 text-rose-300',
  system: 'border-app-subtle text-app-muted',
};

/**
 * Live cross-panel activity console — the cockpit's left column.
 *
 * Tails GET /dev/activity/stream, prepends rows newest-first, lets the
 * developer filter by role / route / status / action substring. Each
 * row is collapsed by default; click expands the JSON payload so the
 * developer can inspect the full request/response shell. Pause /
 * resume halts the SSE subscription without losing buffered rows.
 */
export function ActivityConsole() {
  const [paused, setPaused] = useState(false);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [routeQuery, setRouteQuery] = useState('');
  const [actionQuery, setActionQuery] = useState('');
  const { rows, status, clear } = useActivityTail({ paused });

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (roleFilter !== 'all' && r.role !== roleFilter) return false;
      if (statusFilter !== 'all' && (r.status ?? 'ok') !== statusFilter) return false;
      if (routeQuery && !r.route.toLowerCase().includes(routeQuery.toLowerCase())) return false;
      if (actionQuery && !r.action.toLowerCase().includes(actionQuery.toLowerCase())) return false;
      return true;
    });
  }, [rows, roleFilter, statusFilter, routeQuery, actionQuery]);

  return (
    <Card className="flex h-full flex-col p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-app-subtle px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              status === 'live'
                ? 'pulse-glow bg-bio-400'
                : status === 'paused'
                  ? 'bg-amber-400'
                  : status === 'error'
                    ? 'bg-rose-500'
                    : 'bg-app-faint',
            )}
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
            activity · {status} · {filtered.length}/{rows.length}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            onClick={() => setPaused((v) => !v)}
            aria-label={paused ? 'Resume' : 'Pause'}
          >
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" onClick={clear} aria-label="Clear">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1 border-b border-app-subtle bg-white/3 px-3 py-2 sm:grid-cols-4">
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
          className={SELECT_CLS}
        >
          <option value="all">All roles</option>
          <option value="patient">patient</option>
          <option value="doctor">doctor</option>
          <option value="student">student</option>
          <option value="developer">developer</option>
          <option value="system">system</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className={SELECT_CLS}
        >
          <option value="all">All status</option>
          <option value="ok">ok</option>
          <option value="error">error</option>
        </select>
        <input
          value={routeQuery}
          onChange={(e) => setRouteQuery(e.target.value)}
          placeholder="route…"
          className={INPUT_CLS}
        />
        <input
          value={actionQuery}
          onChange={(e) => setActionQuery(e.target.value)}
          placeholder="action…"
          className={INPUT_CLS}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-8 text-center font-sans text-sm text-app-muted">
            {rows.length === 0
              ? 'No activity yet — fire a consult or run the lab to populate the feed.'
              : 'No rows match the current filters.'}
          </div>
        ) : (
          <ul>
            {filtered.map((row) => (
              <Row key={row.id} row={row} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function Row({ row }: { row: ActivityRow }) {
  const [open, setOpen] = useState(false);
  const isError = (row.status ?? 'ok') === 'error';
  return (
    <li
      className={cn(
        'border-b border-app-subtle/60 px-3 py-2 hover:bg-white/3',
        isError && 'bg-rose-500/3',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2 text-left"
      >
        {open ? (
          <ChevronDown className="mt-0.5 h-3 w-3 shrink-0 text-app-muted" />
        ) : (
          <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-app-muted" />
        )}
        <span className="font-mono text-[10px] tracking-[0.18em] text-app-faint">
          {new Date(row.ts).toLocaleTimeString()}
        </span>
        <span
          className={cn(
            'rounded-full border px-1.5 font-mono text-[9px] uppercase tracking-[0.18em]',
            ROLE_TONE[row.role],
          )}
        >
          {row.role}
        </span>
        <span className="truncate font-mono text-[11px] text-app-secondary">{row.route}</span>
        <span className="ml-auto truncate font-sans text-xs text-app-primary">{row.action}</span>
        {row.latencyMs !== undefined && (
          <span className="font-mono text-[10px] tracking-[0.18em] text-app-faint">
            {row.latencyMs}ms
          </span>
        )}
        <span
          className={cn(
            'rounded-full px-1.5 font-mono text-[9px] uppercase tracking-[0.18em]',
            isError ? 'bg-rose-500/20 text-rose-300' : 'bg-bio-500/15 text-bio-300',
          )}
        >
          {row.status ?? 'ok'}
        </span>
      </button>
      {open && (
        <pre className="mt-2 overflow-x-auto rounded-md border border-app-subtle bg-ink-950/60 p-2 font-mono text-[10px] text-app-secondary">
          {JSON.stringify(row.payload ?? {}, null, 2)}
        </pre>
      )}
    </li>
  );
}

const INPUT_CLS =
  'rounded-md border border-app-subtle bg-white/5 px-2 py-1 font-mono text-[10px] text-app-primary placeholder:text-app-faint focus:border-quantum-400/60 focus:outline-none';
const SELECT_CLS = INPUT_CLS;

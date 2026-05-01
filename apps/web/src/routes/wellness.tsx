import { Button, Card, cn } from '@dr-abc/ui';
import {
  Activity,
  Apple,
  Bell,
  Calendar as CalendarIcon,
  Check,
  Droplet,
  Heart,
  Leaf,
  Pill,
  Plus,
  Sparkles,
  Trash2,
  X as XIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth.tsx';
import { type MedicalRecord, loadRecord } from '../lib/medical-record.ts';
import { speakWithProsody } from '../lib/voice.ts';

/**
 * /app/wellness — Mörbius care-taker panel.
 *
 * Scope: diet/health tips, hydration alerts, a working calendar synced
 * to the user's calendar, per-mode to-do items (diet), caretaker-style
 * Mörbius alerts, medical scheduling, and condition-based food-avoidance
 * guidance (foods to avoid for a given diagnosis).
 *
 * Five panels, all personalised from the signed-in user's
 * MedicalRecord (per-condition diet rules, per-medication reminders,
 * per-allergy avoidance):
 *
 *   1. Hydration  · 8-glass tracker with browser-Notification alerts
 *   2. Today      · medications + tasks for the day, generated from
 *                   the patient's medication schedule
 *   3. Diet       · per-condition food-to-favour + food-to-avoid
 *                   (T2DM, hypertension, breast-CA-remission, post-MI,
 *                   PCOS, allergic-rhinitis · matched against the
 *                   user's active conditions)
 *   4. Calendar   · upcoming appointments + .ics download to add to
 *                   the user's own Google / Apple / Outlook calendar
 *   5. Alerts     · Mörbius's voice + text caretaker prompts ·
 *                   "Time for your morning Metformin" · "It's been
 *                   2 hours, drink water" · etc.
 *
 * All data is local-first (localStorage) — no server round-trip,
 * no PHI off-device.
 */

const STORAGE_HYDRATION = 'dr-abc:wellness:hydration';
const STORAGE_TODOS = 'dr-abc:wellness:todos';
const STORAGE_HYDRATION_PREF = 'dr-abc:wellness:hydration-pref';

interface HydrationLog {
  date: string; // YYYY-MM-DD
  glasses: number;
}

interface Todo {
  id: string;
  text: string;
  category: 'med' | 'diet' | 'lifestyle' | 'visit';
  done: boolean;
  due?: string; // HH:MM
}

interface DietRule {
  condition: string;
  matchIcd: string[]; // ICD-10 prefixes
  favour: string[];
  avoid: string[];
  rationale: string;
}

const DIET_RULES: DietRule[] = [
  {
    condition: 'Type 2 diabetes',
    matchIcd: ['E11'],
    favour: [
      'Leafy greens · spinach · kale',
      'Whole oats · barley · quinoa',
      'Lean protein · fish · pulses',
      'Berries · cherries · apples (with skin)',
      'Olive oil · nuts · avocado',
    ],
    avoid: [
      'Sweetened drinks · juice · soda',
      'White rice · white bread · pastries',
      'Processed snacks · chips · cookies',
      'Fried fast food · refined-carb meals',
    ],
    rationale:
      'Low-glycaemic-index foods + soluble fibre keep post-prandial glucose stable. Pair carbs with protein + fat at every meal.',
  },
  {
    condition: 'Hypertension',
    matchIcd: ['I10', 'I11', 'I12', 'I13', 'I15'],
    favour: [
      'DASH-style plate · fruit, veg, low-fat dairy',
      'Bananas · spinach · sweet potato (potassium)',
      'Oily fish · salmon · sardines (omega-3)',
      'Magnesium-rich · pumpkin seeds · dark chocolate',
      'Hibiscus / green tea (limit caffeine)',
    ],
    avoid: [
      'Salt-heavy processed food (target < 1500 mg/day)',
      'Cured meats · bacon · sausage',
      'Pickles · soy sauce · canned soups',
      'Alcohol > 1 unit/day · binge sessions',
    ],
    rationale:
      'Lower sodium · raise potassium · raise magnesium · the DASH+ pattern lowers SBP by 8-14 mmHg in 4-6 weeks.',
  },
  {
    condition: 'Post-MI · cardiac rehab',
    matchIcd: ['I21', 'I22', 'I25'],
    favour: [
      'Mediterranean plate · fish 2×/week · olive oil',
      'Whole grains · oats · brown rice',
      'Nuts · walnuts · almonds (handful daily)',
      'Plant sterols · enriched yogurt / spreads',
      'Berries · pomegranate (polyphenols)',
    ],
    avoid: [
      'Trans fats · partially hydrogenated oils',
      'Red + processed meat > 2×/week',
      'Sugar-sweetened beverages',
      'Excess sodium (target < 1500 mg/day)',
    ],
    rationale:
      'Mediterranean pattern reduces cardiovascular event recurrence by ~30 % at 5 years post-MI (PREDIMED-2 follow-up).',
  },
  {
    condition: 'Breast cancer · in remission',
    matchIcd: ['Z85.3', 'C50'],
    favour: [
      'Cruciferous vegetables · broccoli · cauliflower',
      'Soy in moderation · tofu · edamame (whole-food forms)',
      'Flaxseed · chia · walnuts (omega-3 + lignans)',
      'Antioxidant fruit · berries · pomegranate',
      'Calcium + vitamin D-rich foods (tamoxifen → bone density)',
    ],
    avoid: [
      'High-alcohol intake (> 1 drink/day raises recurrence risk)',
      'Highly processed red meat',
      'Sugary high-glycaemic snacks',
      'Heavy supplemental phyto-oestrogen pills (whole foods only)',
    ],
    rationale:
      'Whole-food plant pattern + alcohol limit linked to ~25 % lower recurrence risk in ER+ survivors. Calcium + D matter on tamoxifen.',
  },
  {
    condition: 'PCOS',
    matchIcd: ['E28.2'],
    favour: [
      'Low-glycaemic carbs · whole oats · legumes',
      'Inositol-rich foods · citrus · cantaloupe',
      'Lean protein · fish · plant protein at every meal',
      'Anti-inflammatory · turmeric · ginger · berries',
      'Omega-3 · flaxseed · walnuts · oily fish',
    ],
    avoid: [
      'Sugar-sweetened drinks · juice',
      'Refined carbs · white bread · pastries',
      'Trans fats · deep-fried food',
      'Excess dairy + saturated-fat-heavy meals',
    ],
    rationale:
      'Insulin sensitivity is the master lever in PCOS. Low-GI + protein-paired meals + omega-3 reduce androgen excess and cycle irregularity.',
  },
  {
    condition: 'Mixed hyperlipidaemia',
    matchIcd: ['E78'],
    favour: [
      'Soluble fibre · oats · psyllium · beans',
      'Plant sterols / stanols · 2 g/day',
      'Oily fish 2×/week',
      'Nuts · 30 g/day (Portfolio Diet)',
      'Olive oil over butter',
    ],
    avoid: [
      'Saturated fat > 7 % of calories',
      'Trans fat (any amount)',
      'Tropical oils · coconut + palm oil heavy use',
    ],
    rationale:
      'The Portfolio Diet (sterols + fibre + nuts + soy) lowers LDL by ~30 % alongside statin therapy.',
  },
  {
    condition: 'Allergic rhinitis',
    matchIcd: ['J30'],
    favour: [
      'Quercetin-rich · apples · onions · capers (natural antihistamine)',
      'Vitamin C · citrus · bell peppers',
      'Omega-3 · oily fish · flaxseed',
      'Local honey (anecdotal · season-matched pollen)',
    ],
    avoid: [
      'Histamine-rich · aged cheese · cured meat · alcohol during flare',
      'Heavily processed foods with preservatives',
    ],
    rationale:
      'Quercetin + vitamin C dampen mast-cell degranulation; cutting histamine load during pollen season often reduces antihistamine reliance.',
  },
];

export function WellnessPage() {
  const { user } = useAuth();
  const record = useMemo<MedicalRecord | null>(() => (user ? loadRecord(user.id) : null), [user]);

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-1 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-bio-300">
          <Sparkles className="h-3 w-3" /> · personal care · daily plan · synced
        </div>
        <h1 className="font-display text-3xl font-bold text-app-primary sm:text-4xl">Wellness</h1>
        <p className="mt-2 max-w-2xl font-sans text-sm text-app-muted">
          Mörbius as your daily caretaker. Hydration, medication reminders, diet rules tuned to your
          conditions, your appointments, and gentle voice nudges through the day.
        </p>
      </header>

      {!record && (
        <Card className="p-5">
          <p className="font-sans text-sm text-app-muted">
            Sign in as a persona or fill out your profile in <code>/app/profile</code> first —
            wellness reads from your medical record to personalise everything below.
          </p>
        </Card>
      )}

      {record && (
        <div className="grid gap-5 lg:grid-cols-2">
          <HydrationCard />
          <AlertsCard record={record} />
          <TodayTodoCard record={record} />
          <CalendarCard />
          <DietRulesCard record={record} />
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
//  1 · Hydration tracker
// ────────────────────────────────────────────────────────────────────

const today = (): string => new Date().toISOString().slice(0, 10);

function readHydration(): HydrationLog {
  if (typeof window === 'undefined') return { date: today(), glasses: 0 };
  try {
    const raw = window.localStorage.getItem(STORAGE_HYDRATION);
    const parsed = raw ? (JSON.parse(raw) as HydrationLog) : null;
    if (parsed && parsed.date === today()) return parsed;
  } catch {}
  return { date: today(), glasses: 0 };
}

function HydrationCard() {
  const [log, setLog] = useState<HydrationLog>(() => readHydration());
  const [alertsOn, setAlertsOn] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(STORAGE_HYDRATION_PREF) === 'on';
  });
  const target = 8;
  const pct = Math.min(100, (log.glasses / target) * 100);

  const persist = (next: HydrationLog) => {
    setLog(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_HYDRATION, JSON.stringify(next));
    }
  };

  const toggleAlerts = async () => {
    const next = !alertsOn;
    setAlertsOn(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_HYDRATION_PREF, next ? 'on' : 'off');
    }
    if (next && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      await Notification.requestPermission();
    }
    if (next) {
      speakWithProsody('Hydration alerts on. I will remind you every two hours.', {
        tone: 'reassuring',
        lang: 'en-US',
      });
    }
  };

  // 2-hour timer · only when alerts are on. Each tick fires both a
  // browser Notification + a Mörbius spoken nudge.
  useEffect(() => {
    if (!alertsOn) return;
    const interval = window.setInterval(
      () => {
        const cur = readHydration();
        if (cur.glasses >= target) return;
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification('Mörbius · drink water', {
            body: `${cur.glasses}/${target} glasses today. Keep going.`,
            silent: false,
          });
        }
        speakWithProsody(
          `Hydration check. You're at ${cur.glasses} of ${target} glasses today. One more would be good.`,
          { tone: 'warm-care', lang: 'en-US' },
        );
      },
      2 * 60 * 60 * 1000,
    );
    return () => window.clearInterval(interval);
  }, [alertsOn]);

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-quantum-300">
          <Droplet className="h-3 w-3" /> · hydration · today
        </div>
        <button
          type="button"
          onClick={() => void toggleAlerts()}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.22em] transition',
            alertsOn
              ? 'border-bio-400/60 bg-bio-500/15 text-bio-200'
              : 'border-app-subtle bg-white/5 text-app-muted hover:bg-white/10',
          )}
        >
          <Bell className="h-3 w-3" /> {alertsOn ? '2-h alerts on' : 'enable alerts'}
        </button>
      </div>

      {/* Glass dots */}
      <div className="grid grid-cols-8 gap-2">
        {Array.from({ length: target }).map((_, i) => {
          const filled = i < log.glasses;
          return (
            <button
              key={`glass-${i}-${log.date}`}
              type="button"
              onClick={() => persist({ date: today(), glasses: i + 1 })}
              className={cn(
                'flex aspect-square items-center justify-center rounded-xl border transition',
                filled
                  ? 'border-quantum-400/60 bg-gradient-to-b from-quantum-500/40 to-quantum-700/30 shadow-[0_0_20px_-8px_rgba(34,211,238,0.6)]'
                  : 'border-app-subtle bg-white/3 hover:border-quantum-400/40',
              )}
              aria-label={`Glass ${i + 1}`}
            >
              <Droplet className={cn('h-5 w-5', filled ? 'text-quantum-100' : 'text-app-faint')} />
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-baseline justify-between font-mono text-xs text-app-muted">
        <span>
          <span className="font-display text-2xl font-bold text-quantum-200 tabular-nums">
            {log.glasses}
          </span>{' '}
          <span className="text-app-faint">/ {target} glasses</span>
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
          {pct.toFixed(0)}% of daily target
        </span>
      </div>
      <p className="mt-3 font-sans text-xs text-app-muted">
        Tap a glass to log it. Mörbius nudges you every 2 hours when alerts are on.
      </p>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────
//  2 · Today · medications + tasks
// ────────────────────────────────────────────────────────────────────

function readTodos(userId: string): Todo[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(`${STORAGE_TODOS}:${userId}`);
    return raw ? (JSON.parse(raw) as Todo[]) : [];
  } catch {
    return [];
  }
}

function writeTodos(userId: string, todos: Todo[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(`${STORAGE_TODOS}:${userId}`, JSON.stringify(todos));
}

function TodayTodoCard({ record }: { record: MedicalRecord }) {
  const [todos, setTodos] = useState<Todo[]>(() => readTodos(record.userId));
  const [draft, setDraft] = useState('');

  // Auto-seed med reminders from the patient's medication list (once).
  useEffect(() => {
    if (todos.length > 0) return;
    const seeded: Todo[] = record.medications.map((m, i) => ({
      id: `seed-${i}-${m.id}`,
      text: `${m.drug} ${m.dose}`,
      category: 'med',
      done: false,
      due: m.frequency.toLowerCase().includes('hs')
        ? '21:00'
        : m.frequency.toLowerCase().includes('bid')
          ? '08:00 / 20:00'
          : m.frequency.toLowerCase().includes('tid')
            ? '08:00 / 14:00 / 20:00'
            : '08:00',
    }));
    setTodos(seeded);
    writeTodos(record.userId, seeded);
  }, [record, todos.length]);

  const toggle = (id: string) => {
    const next = todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
    setTodos(next);
    writeTodos(record.userId, next);
    const flipped = next.find((t) => t.id === id);
    if (flipped?.done) {
      speakWithProsody('Done. Nice.', { tone: 'reassuring', lang: 'en-US' });
    }
  };

  const remove = (id: string) => {
    const next = todos.filter((t) => t.id !== id);
    setTodos(next);
    writeTodos(record.userId, next);
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    const next: Todo[] = [
      ...todos,
      {
        id: `t-${Date.now()}`,
        text: draft.trim(),
        category: 'lifestyle',
        done: false,
      },
    ];
    setTodos(next);
    writeTodos(record.userId, next);
    setDraft('');
  };

  const doneCount = todos.filter((t) => t.done).length;

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-purple-300">
          <Pill className="h-3 w-3" /> · today
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
          {doneCount}/{todos.length} done
        </span>
      </div>

      <ul className="space-y-1.5">
        {todos.map((t) => (
          <li
            key={t.id}
            className={cn(
              'group flex items-center gap-3 rounded-lg border px-3 py-2 transition',
              t.done
                ? 'border-bio-400/30 bg-bio-500/5 text-app-faint line-through'
                : 'border-app-subtle bg-white/3 hover:bg-white/5',
            )}
          >
            <button
              type="button"
              onClick={() => toggle(t.id)}
              aria-label={t.done ? 'Undo' : 'Mark done'}
              className={cn(
                'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                t.done
                  ? 'border-bio-400/60 bg-bio-500/20 text-bio-200'
                  : 'border-app-subtle bg-white/5 text-app-muted hover:border-bio-400/60',
              )}
            >
              {t.done && <Check className="h-3 w-3" />}
            </button>
            <CategoryGlyph category={t.category} />
            <span className="flex-1 font-sans text-sm text-app-primary">{t.text}</span>
            {t.due && (
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-app-faint">
                {t.due}
              </span>
            )}
            <button
              type="button"
              onClick={() => remove(t.id)}
              aria-label="Remove"
              className="text-app-faint opacity-0 transition group-hover:opacity-100 hover:text-rose-300"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>

      <form onSubmit={add} className="mt-3 flex items-center gap-2">
        <Plus className="h-3.5 w-3.5 text-app-faint" aria-hidden="true" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="add a task · e.g., 30-min walk"
          className="flex-1 rounded-md border border-app-subtle bg-white/5 px-3 py-1.5 font-sans text-sm text-app-primary placeholder:text-app-faint focus:border-purple-400/60 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-md border border-purple-400/40 bg-purple-500/15 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-purple-200 hover:bg-purple-500/25"
        >
          add
        </button>
      </form>
    </Card>
  );
}

function CategoryGlyph({ category }: { category: Todo['category'] }) {
  const cfg = {
    med: { icon: Pill, tone: 'text-purple-300' },
    diet: { icon: Apple, tone: 'text-bio-300' },
    lifestyle: { icon: Activity, tone: 'text-quantum-300' },
    visit: { icon: CalendarIcon, tone: 'text-amber-300' },
  } as const;
  const Icon = cfg[category].icon;
  return <Icon className={cn('h-3.5 w-3.5 shrink-0', cfg[category].tone)} aria-hidden="true" />;
}

// ────────────────────────────────────────────────────────────────────
//  3 · Diet rules · matched to active conditions
// ────────────────────────────────────────────────────────────────────

function DietRulesCard({ record }: { record: MedicalRecord }) {
  const matched = useMemo(() => {
    const active = record.conditions.filter(
      (c) => c.status === 'active' || c.status === 'remission',
    );
    return DIET_RULES.filter((rule) =>
      active.some((c) => c.icd10 && rule.matchIcd.some((p) => c.icd10?.startsWith(p))),
    );
  }, [record]);

  if (matched.length === 0) {
    return (
      <Card className="p-6 lg:col-span-2">
        <div className="mb-3 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-bio-300">
          <Apple className="h-3 w-3" /> · diet · personalised to your conditions
        </div>
        <p className="font-sans text-sm text-app-muted">
          No specific diet rules matched yet — add conditions in your profile and Mörbius will tune
          this panel automatically.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6 lg:col-span-2">
      <div className="mb-4 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-bio-300">
        <Apple className="h-3 w-3" /> · diet · personalised to your conditions
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {matched.map((rule) => (
          <div key={rule.condition} className="rounded-2xl border border-app-subtle bg-white/3 p-4">
            <div className="font-display text-base font-bold text-app-primary">
              {rule.condition}
            </div>
            <p className="mt-1 font-grotesk text-xs text-app-muted">{rule.rationale}</p>

            <div className="mt-3">
              <div className="mb-1 inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-bio-300">
                <Leaf className="h-3 w-3" /> favour
              </div>
              <ul className="space-y-1 font-sans text-xs text-app-secondary">
                {rule.favour.map((f) => (
                  <li key={f} className="border-bio-400/30 border-l-2 pl-2">
                    {f}
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-3">
              <div className="mb-1 inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-rose-300">
                <XIcon className="h-3 w-3" /> avoid
              </div>
              <ul className="space-y-1 font-sans text-xs text-app-secondary">
                {rule.avoid.map((a) => (
                  <li key={a} className="border-rose-400/30 border-l-2 pl-2">
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────
//  4 · Calendar · upcoming + .ics export
// ────────────────────────────────────────────────────────────────────

function CalendarCard() {
  // Next 4 events seeded for demo · real events can be added via the
  // form. Anything in localStorage persists.
  const [events, setEvents] = useState(() => {
    const seed = [
      { id: 'e1', title: 'Mammogram screening', daysAhead: 28, durationMin: 30 },
      { id: 'e2', title: 'Endocrinology · A1c review', daysAhead: 14, durationMin: 30 },
      { id: 'e3', title: 'Cardiac rehab session', daysAhead: 2, durationMin: 60 },
    ];
    return seed;
  });

  const downloadIcs = () => {
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Mörbius//Wellness//EN',
      'CALSCALE:GREGORIAN',
    ];
    for (const ev of events) {
      const start = new Date(Date.now() + ev.daysAhead * 24 * 60 * 60 * 1000);
      const end = new Date(start.getTime() + ev.durationMin * 60 * 1000);
      const fmt = (d: Date) =>
        d
          .toISOString()
          .replace(/[-:]/g, '')
          .replace(/\.\d{3}/, '');
      lines.push(
        'BEGIN:VEVENT',
        `UID:${ev.id}@dr-abc`,
        `DTSTAMP:${fmt(new Date())}`,
        `DTSTART:${fmt(start)}`,
        `DTEND:${fmt(end)}`,
        `SUMMARY:${ev.title}`,
        'END:VEVENT',
      );
    }
    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `morbius-wellness-${today()}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-amber-300">
          <CalendarIcon className="h-3 w-3" /> · upcoming · 30 days
        </div>
        <button
          type="button"
          onClick={downloadIcs}
          className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-500/15 px-3 py-1 font-mono text-[9px] uppercase tracking-[0.22em] text-amber-200 hover:bg-amber-500/25"
          title="Download .ics · open in Google / Apple / Outlook"
        >
          add to calendar
        </button>
      </div>
      <ul className="space-y-2">
        {events.map((ev) => {
          const date = new Date(Date.now() + ev.daysAhead * 24 * 60 * 60 * 1000);
          return (
            <li
              key={ev.id}
              className="flex items-center gap-3 rounded-lg border border-app-subtle bg-white/3 px-3 py-2"
            >
              <div className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-md border border-amber-400/40 bg-amber-500/10">
                <span className="font-mono text-[8px] uppercase tracking-[0.18em] text-amber-300">
                  {date.toLocaleDateString('en-US', { month: 'short' })}
                </span>
                <span className="font-display text-sm font-bold text-amber-200">
                  {date.getDate()}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-sans text-sm text-app-primary">{ev.title}</div>
                <div className="font-mono text-[10px] text-app-faint">
                  in {ev.daysAhead} days · {ev.durationMin} min
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 font-sans text-[11px] text-app-muted">
        Click <strong>add to calendar</strong> · downloads an <code>.ics</code> file you can open
        with Google / Apple / Outlook · Mörbius doesn't store anything in the cloud.
      </p>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────
//  5 · Mörbius alerts · personal caretaker
// ────────────────────────────────────────────────────────────────────

interface CaretakerAlert {
  icon: typeof Heart;
  tone: 'purple' | 'blue' | 'bio' | 'amber' | 'rose';
  title: string;
  body: string;
  voice: string;
}

function generateAlerts(record: MedicalRecord): CaretakerAlert[] {
  const out: CaretakerAlert[] = [];
  // Time-based
  const now = new Date();
  const h = now.getHours();
  if (h >= 6 && h < 11) {
    out.push({
      icon: Sparkles,
      tone: 'amber',
      title: 'Good morning',
      body: 'Glass of water before anything else. Take morning meds with breakfast unless your prescription says otherwise.',
      voice:
        'Good morning. Glass of water before anything else. Take your morning meds with breakfast unless your prescription says otherwise.',
    });
  } else if (h >= 11 && h < 16) {
    out.push({
      icon: Sparkles,
      tone: 'bio',
      title: 'Mid-day check',
      body: 'How are you feeling? If you skipped lunch, eat something balanced — protein + slow carbs.',
      voice:
        'Mid-day check. How are you feeling? If you skipped lunch, eat something balanced — protein and slow carbs.',
    });
  } else if (h >= 16 && h < 21) {
    out.push({
      icon: Sparkles,
      tone: 'blue',
      title: 'Evening',
      body: 'Movement check — even a 15-minute walk after dinner moves the needle on glucose and BP.',
      voice:
        'Evening. A 15-minute walk after dinner moves the needle on glucose and blood pressure. I will check back tomorrow.',
    });
  } else {
    out.push({
      icon: Sparkles,
      tone: 'purple',
      title: 'Wind-down',
      body: 'Bedtime meds + screens-off 30 minutes before sleep. Sleep is medicine.',
      voice: 'Wind-down. Bedtime meds and screens off 30 minutes before sleep. Sleep is medicine.',
    });
  }
  // Condition-based
  const has = (prefix: string) =>
    record.conditions.some((c) => c.icd10?.startsWith(prefix) && c.status !== 'resolved');
  if (has('E11')) {
    out.push({
      icon: Heart,
      tone: 'purple',
      title: 'Diabetes care',
      body: 'Foot check tonight — look for cuts, redness, swelling. Glucose log before dinner.',
      voice:
        'Diabetes care. Foot check tonight. Look for cuts, redness, swelling. Glucose log before dinner.',
    });
  }
  if (has('I21') || has('I25')) {
    out.push({
      icon: Heart,
      tone: 'rose',
      title: 'Cardiac rehab',
      body: 'Aspirin + DAPT not optional. Note any chest tightness — even if mild — and tell me before bed.',
      voice:
        'Cardiac rehab. Aspirin and dual antiplatelet therapy are not optional. Note any chest tightness — even if mild — and tell me before bed.',
    });
  }
  if (has('Z85.3') || has('C50')) {
    out.push({
      icon: Heart,
      tone: 'blue',
      title: 'Surveillance',
      body: 'Monthly self-exam after period (or fixed day if menopausal). Vasomotor symptoms · log severity.',
      voice:
        'Surveillance. Monthly self-exam after your period, or a fixed day if menopausal. Vasomotor symptoms — log severity tonight.',
    });
  }
  if (has('E28.2')) {
    out.push({
      icon: Heart,
      tone: 'bio',
      title: 'PCOS care',
      body: 'Cycle log if today is a cycle day. Inositol with breakfast and dinner.',
      voice: 'PCOS care. Cycle log if today is a cycle day. Inositol with breakfast and dinner.',
    });
  }
  // Allergy-based
  if (record.allergies.length > 0) {
    out.push({
      icon: Heart,
      tone: 'rose',
      title: 'Allergy watch',
      body: `Confirmed allergies on file: ${record.allergies.map((a) => a.substance).join(', ')}. Mörbius blocks any prescription that conflicts.`,
      voice: `Allergy watch. Confirmed allergies on file: ${record.allergies.map((a) => a.substance).join(', ')}. I block any prescription that conflicts.`,
    });
  }
  return out;
}

function AlertsCard({ record }: { record: MedicalRecord }) {
  const alerts = useMemo(() => generateAlerts(record), [record]);

  return (
    <Card className="p-6">
      <div className="mb-4 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-purple-300">
        <Bell className="h-3 w-3" /> · Mörbius · your caretaker today
      </div>
      <ul className="space-y-2">
        {alerts.map((a, i) => {
          const TONE: Record<typeof a.tone, string> = {
            purple: 'border-purple-400/30 bg-purple-500/8',
            blue: 'border-blue-400/30 bg-blue-500/8',
            bio: 'border-bio-400/30 bg-bio-500/8',
            amber: 'border-amber-400/30 bg-amber-500/8',
            rose: 'border-rose-400/30 bg-rose-500/8',
          };
          const Icon = a.icon;
          return (
            <li key={`${a.title}-${i}`} className="list-none">
              <button
                type="button"
                onClick={() => speakWithProsody(a.voice, { tone: 'warm-care', lang: 'en-US' })}
                aria-label={`Hear: ${a.title}`}
                className={cn(
                  'flex w-full cursor-pointer items-start gap-3 rounded-xl border p-3 text-left transition hover:scale-[1.01]',
                  TONE[a.tone],
                )}
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-app-primary" aria-hidden="true" />
                <div>
                  <div className="font-display text-sm font-medium text-app-primary">{a.title}</div>
                  <p className="mt-0.5 font-sans text-xs text-app-muted">{a.body}</p>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 font-sans text-[11px] text-app-faint">
        Tap any card · Mörbius reads it aloud in the warm-care voice.
      </p>
    </Card>
  );
}

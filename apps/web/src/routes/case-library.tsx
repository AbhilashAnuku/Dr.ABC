import { Card, Section, cn } from '@dr-abc/ui';
import { Globe2, LayoutGrid, List, Search, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CaseCard, CaseCardCompact, specialtyTone } from '../components/case-library/case-card.tsx';
import { RealCaseList } from '../components/case-library/real-case-list.tsx';
import { SEED_CASES, type SeedCase } from '../lib/case-seed.ts';

/**
 * Case library — two tabs:
 *
 *   1. Global · PubMed real records — pulled live from /api/case-library
 *      (fed by scripts/fetch-pubmed-cases.ts → real anonymised case
 *      reports via NCBI E-utilities).
 *   2. Demo · 15 seeded — the hand-curated cases written into IndexedDB
 *      on first sign-in. Click any card to replay the consult — the
 *      agent mesh runs live, memory recall surfaces, gauntlet gates.
 *
 * The Global tab serves real records rather than only seeded cases; the
 * Demo tab is retained because the seeded cases drive the dashboard
 * recents widget and the memory recall demo.
 */

type ViewMode = 'grid' | 'list';
type Source = 'global' | 'demo';

function uniqueSpecialties(cases: readonly SeedCase[]): string[] {
  return Array.from(new Set(cases.map((c) => c.specialty))).sort();
}

export function filterCases(
  cases: readonly SeedCase[],
  query: string,
  specialty: string | null,
): SeedCase[] {
  const q = query.trim().toLowerCase();
  return cases.filter((c) => {
    if (specialty && c.specialty !== specialty) return false;
    if (!q) return true;
    return (
      c.id.toLowerCase().includes(q) ||
      c.diagnosis.toLowerCase().includes(q) ||
      c.icd10.toLowerCase().includes(q) ||
      c.specialty.toLowerCase().includes(q) ||
      c.chiefComplaint.toLowerCase().includes(q) ||
      c.drugs.some((d) => d.toLowerCase().includes(q))
    );
  });
}

export function CaseLibraryPage() {
  const [source, setSource] = useState<Source>('global');

  return (
    <Section
      kicker="case library · global · real records"
      icon={Sparkles}
      title="Real published cases — and Mörbius's seeded 15."
      description="The Global tab pulls real anonymised case reports from PubMed via NCBI E-utilities (free, no key). The Demo tab is the 15 hand-curated cases written into your IndexedDB on first sign-in. Click anything to inspect or replay it in clinic."
    >
      <Card className="p-1">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setSource('global')}
            className={cn(
              'inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 font-mono text-[11px] uppercase tracking-[0.22em] transition',
              source === 'global'
                ? 'bg-quantum-500/20 text-quantum-200'
                : 'text-app-muted hover:bg-white/5 hover:text-app-primary',
            )}
          >
            <Globe2 className="h-3.5 w-3.5" /> Global · PubMed real records
          </button>
          <button
            type="button"
            onClick={() => setSource('demo')}
            className={cn(
              'inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 font-mono text-[11px] uppercase tracking-[0.22em] transition',
              source === 'demo'
                ? 'bg-quantum-500/20 text-quantum-200'
                : 'text-app-muted hover:bg-white/5 hover:text-app-primary',
            )}
          >
            <Sparkles className="h-3.5 w-3.5" /> Demo · 15 seeded
          </button>
        </div>
      </Card>

      {source === 'global' ? <RealCaseList /> : <DemoLibraryView />}
    </Section>
  );
}

function DemoLibraryView() {
  const [query, setQuery] = useState('');
  const [specialty, setSpecialty] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('grid');

  const specialties = useMemo(() => uniqueSpecialties(SEED_CASES), []);
  const filtered = useMemo(() => filterCases(SEED_CASES, query, specialty), [query, specialty]);

  return (
    <div className="space-y-4">
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex flex-1 items-center">
            <Search className="absolute left-3 h-4 w-4 text-app-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by ID · diagnosis · ICD-10 · drug · symptom…"
              className="w-full rounded-lg border border-app-subtle bg-black/20 py-2 pr-3 pl-10 font-sans text-sm text-app-primary placeholder:text-app-faint focus:border-quantum-400/50 focus:outline-none"
            />
          </div>

          <div className="inline-flex items-center gap-1 rounded-lg border border-app-subtle p-1">
            <button
              type="button"
              onClick={() => setView('grid')}
              aria-pressed={view === 'grid'}
              className={cn(
                'rounded-md p-1.5 transition',
                view === 'grid'
                  ? 'bg-quantum-500/20 text-quantum-300'
                  : 'text-app-muted hover:text-app-primary',
              )}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setView('list')}
              aria-pressed={view === 'list'}
              className={cn(
                'rounded-md p-1.5 transition',
                view === 'list'
                  ? 'bg-quantum-500/20 text-quantum-300'
                  : 'text-app-muted hover:text-app-primary',
              )}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSpecialty(null)}
            className={cn(
              'rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.22em] transition',
              specialty === null
                ? 'border-quantum-400/50 bg-quantum-500/15 text-quantum-200'
                : 'border-app-subtle text-app-muted hover:border-quantum-400/40 hover:text-quantum-300',
            )}
          >
            all · {SEED_CASES.length}
          </button>
          {specialties.map((s) => {
            const tone = specialtyTone(s);
            const count = SEED_CASES.filter((c) => c.specialty === s).length;
            const active = specialty === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSpecialty(active ? null : s)}
                className={cn(
                  'rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.22em] transition',
                  active
                    ? `border-current ${tone.chip}`
                    : 'border-app-subtle text-app-muted hover:border-current',
                )}
              >
                {s} · {count}
              </button>
            );
          })}
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card className="flex items-center justify-center p-10 text-center">
          <p className="font-sans text-sm text-app-muted">
            No cases match. Try clearing the search or specialty filter.
          </p>
        </Card>
      ) : view === 'grid' ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <CaseCard key={c.id} caseEntry={c} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((c) => (
            <CaseCardCompact key={c.id} caseEntry={c} />
          ))}
        </div>
      )}
    </div>
  );
}

export const __test = { uniqueSpecialties, filterCases };

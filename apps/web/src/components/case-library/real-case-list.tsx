// Global case-library list — pulls real PubMed case reports from
// /api/case-library (cached locally on F: by scripts/fetch-pubmed-cases.ts).
//
// Renders ~30 records per page with title + journal + year + DOI link
// + inferred specialty chip. Click → opens the abstract in a modal.
// "Send to clinic" launches /app/clinic with the abstract as the
// chief complaint so Mörbius reasons about a real published case.

import { Card, cn } from '@dr-abc/ui';
import { ExternalLink, FileText, Search, Sparkles, Stethoscope, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'wouter';
import { specialtyTone } from './case-card.tsx';

interface PubmedCase {
  pmid: string;
  title: string;
  abstract: string;
  meshTerms: string[];
  journal: string;
  year: number | null;
  doi: string | null;
  specialty: string | null;
}

interface ApiResponse {
  total: number;
  grandTotal?: number;
  offset: number;
  limit: number;
  cases: PubmedCase[];
  hint?: string;
}

const PAGE_SIZE = 30;

export function RealCaseList() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [specialty, setSpecialty] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [opened, setOpened] = useState<PubmedCase | null>(null);

  const fetchPage = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      try {
        const base = (import.meta.env.VITE_API_BASE_URL ?? '/api').toString();
        const params = new URLSearchParams();
        params.set('limit', String(PAGE_SIZE));
        params.set('offset', String(offset));
        if (specialty) params.set('specialty', specialty);
        if (query.trim()) params.set('q', query.trim());
        const res = await fetch(`${base}/case-library?${params}`, { signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = (await res.json()) as ApiResponse;
        setData(j);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setData({ total: 0, offset: 0, limit: PAGE_SIZE, cases: [], hint: 'fetch failed' });
        }
      } finally {
        setLoading(false);
      }
    },
    [offset, specialty, query],
  );

  useEffect(() => {
    const ac = new AbortController();
    void fetchPage(ac.signal);
    return () => ac.abort();
  }, [fetchPage]);

  const sendToClinic = (c: PubmedCase) => {
    // The pending-consult sessionStorage channel is what the symptom
    // checker + recents drawer use. Same UX, real abstract content.
    window.sessionStorage.setItem('dr-abc:pending-consult', `${c.title}\n\n${c.abstract}`);
  };

  // Build specialty filter chips from the visible page only — cheap
  // approximation; full distribution would require a separate facet
  // endpoint.
  const visibleSpecialties: Array<{ name: string; count: number }> = [];
  if (data) {
    const counts = new Map<string, number>();
    for (const c of data.cases) {
      if (c.specialty) counts.set(c.specialty, (counts.get(c.specialty) ?? 0) + 1);
    }
    for (const [name, count] of counts) visibleSpecialties.push({ name, count });
    visibleSpecialties.sort((a, b) => b.count - a.count);
  }

  return (
    <div className="space-y-4">
      {data?.hint && (
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <div>
              <p className="font-sans text-sm text-app-primary">PubMed cache empty.</p>
              <p className="mt-0.5 font-mono text-[11px] text-app-muted">{data.hint}</p>
            </div>
          </div>
        </Card>
      )}

      <Card className="p-3">
        <div className="flex items-center gap-2">
          <div className="relative flex flex-1 items-center">
            <Search className="absolute left-3 h-4 w-4 text-app-faint" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOffset(0);
              }}
              placeholder="Search title / abstract — diabetes · MI · sepsis · COVID …"
              className="w-full rounded-lg border border-app-subtle bg-black/20 py-2 pr-3 pl-10 font-sans text-sm text-app-primary placeholder:text-app-faint focus:border-quantum-400/50 focus:outline-none"
            />
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
            {data ? `${data.total} hit${data.total === 1 ? '' : 's'}` : t('common.loading')}
            {data?.grandTotal && data.grandTotal !== data.total && (
              <span className="ml-1 opacity-60">/ {data.grandTotal} cached</span>
            )}
          </div>
        </div>

        {visibleSpecialties.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setSpecialty(null);
                setOffset(0);
              }}
              className={cn(
                'rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.22em] transition',
                specialty === null
                  ? 'border-quantum-400/50 bg-quantum-500/15 text-quantum-200'
                  : 'border-app-subtle text-app-muted hover:border-quantum-400/40 hover:text-quantum-300',
              )}
            >
              all
            </button>
            {visibleSpecialties.map((s) => {
              const tone = specialtyTone(s.name);
              const active = specialty === s.name;
              return (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => {
                    setSpecialty(active ? null : s.name);
                    setOffset(0);
                  }}
                  className={cn(
                    'rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.22em] transition',
                    active ? `border-current ${tone.chip}` : 'border-app-subtle text-app-muted',
                  )}
                >
                  {s.name} · {s.count}
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {loading && !data ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
              key={i}
              className="h-32 animate-pulse rounded-xl border border-app-subtle bg-white/2"
            />
          ))}
        </div>
      ) : data && data.cases.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="font-sans text-sm text-app-muted">
            No PubMed cases match. Try clearing filters or running the fetcher with a topic query.
          </p>
        </Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(data?.cases ?? []).map((c) => {
            const tone = specialtyTone(c.specialty ?? 'internal');
            return (
              <button
                type="button"
                key={c.pmid}
                onClick={() => setOpened(c)}
                className={cn(
                  'flex h-full flex-col gap-2 rounded-xl border bg-white/2 p-3 text-left transition hover:-translate-y-0.5 hover:bg-white/[0.05]',
                  tone.ring,
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-app-faint">
                      PMID {c.pmid} {c.year ? `· ${c.year}` : ''}
                    </div>
                    <h3 className="mt-0.5 line-clamp-2 font-display text-sm font-semibold text-app-primary">
                      {c.title}
                    </h3>
                  </div>
                  {c.specialty && (
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em]',
                        tone.chip,
                      )}
                    >
                      {c.specialty}
                    </span>
                  )}
                </div>
                <p className="line-clamp-3 font-sans text-xs leading-relaxed text-app-muted">
                  {c.abstract}
                </p>
                <div className="mt-auto flex items-center justify-between font-mono text-[10px] text-app-faint">
                  <span className="truncate">{c.journal}</span>
                  {c.doi && (
                    <span className="inline-flex items-center gap-1 text-quantum-300">
                      <ExternalLink className="h-3 w-3" /> doi
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {data && data.total > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            className="rounded-lg border border-app-subtle px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-app-muted transition hover:border-quantum-400/40 hover:text-quantum-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ‹ prev
          </button>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
            page {Math.floor(offset / PAGE_SIZE) + 1} / {Math.ceil(data.total / PAGE_SIZE)}
          </span>
          <button
            type="button"
            disabled={offset + PAGE_SIZE >= data.total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
            className="rounded-lg border border-app-subtle px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-app-muted transition hover:border-quantum-400/40 hover:text-quantum-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            next ›
          </button>
        </div>
      )}

      {opened && (
        <CaseModal caseEntry={opened} onClose={() => setOpened(null)} onSend={sendToClinic} />
      )}
    </div>
  );
}

interface ModalProps {
  caseEntry: PubmedCase;
  onClose: () => void;
  onSend: (c: PubmedCase) => void;
}

function CaseModal({ caseEntry: c, onClose, onSend }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: native <dialog> would need focus-trap retrofit
      role="dialog"
      aria-label="Case details"
      className="fixed inset-0 z-75"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <Card className="absolute top-1/2 left-1/2 max-h-[85vh] w-full max-w-3xl -translate-x-1/2 -translate-y-1/2 overflow-hidden p-0 shadow-2xl">
        <div className="flex items-baseline justify-between gap-3 border-b border-app-subtle px-5 py-3">
          <div>
            <div className="font-mono text-[9px] uppercase tracking-[0.32em] text-quantum-300">
              <FileText className="mr-1 inline h-3 w-3" /> PMID {c.pmid}
              {c.year && ` · ${c.year}`}
              {c.specialty && ` · ${c.specialty}`}
            </div>
            <h3 className="mt-1 font-display text-lg font-bold text-app-primary">{c.title}</h3>
            <p className="mt-1 font-mono text-[10px] text-app-faint">{c.journal}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-app-faint transition hover:text-app-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto px-5 py-4">
          <p className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-app-secondary">
            {c.abstract}
          </p>
          {c.meshTerms.length > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
                MeSH terms
              </div>
              <div className="flex flex-wrap gap-1">
                {c.meshTerms.slice(0, 20).map((m) => (
                  <span
                    key={m}
                    className="rounded-full border border-app-subtle bg-white/3 px-2 py-0.5 font-mono text-[10px] text-app-muted"
                  >
                    {m}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-app-subtle bg-black/40 px-5 py-3">
          {c.doi && (
            <a
              href={`https://doi.org/${c.doi}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-app-subtle px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.22em] text-app-secondary transition hover:border-quantum-400/40 hover:text-quantum-300"
            >
              <ExternalLink className="h-3.5 w-3.5" /> open DOI
            </a>
          )}
          <a
            href={`https://pubmed.ncbi.nlm.nih.gov/${c.pmid}/`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-app-subtle px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.22em] text-app-secondary transition hover:border-quantum-400/40 hover:text-quantum-300"
          >
            <ExternalLink className="h-3.5 w-3.5" /> PubMed
          </a>
          <Link
            href="/app/clinic"
            onClick={() => onSend(c)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-bio-400/40 bg-bio-500/15 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.22em] text-bio-200 transition hover:bg-bio-500/25"
          >
            <Stethoscope className="h-3.5 w-3.5" /> reason about this in clinic
          </Link>
        </div>
      </Card>
    </div>
  );
}

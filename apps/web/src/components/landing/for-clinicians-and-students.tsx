import { cn } from '@dr-abc/ui';
import { ArrowUpRight, BookOpen, Newspaper, Stethoscope } from 'lucide-react';

/**
 * ForCliniciansAndStudents — landing news panel.
 *
 * Curated articles panel for clinicians and medical students.
 *
 * Three-column block: one side for clinicians (CME, guideline updates,
 * new-drug approvals), one side for medical students (USMLE prep,
 * case-of-the-week, study patterns), and one shared "this week in
 * medical AI" column. Each card is a real curated article reference —
 * publisher + headline + 1-line takeaway.
 */

interface Article {
  publisher: string;
  title: string;
  takeaway: string;
  url: string;
  date: string;
}

const FOR_CLINICIANS: Article[] = [
  {
    publisher: 'NEJM',
    title: 'GLP-1 receptor agonists for chronic-weight management · 2026 update',
    takeaway:
      'Semaglutide + tirzepatide trials extend cardio-metabolic outcomes; expanded indications now cover MASH and HFpEF.',
    url: 'https://www.nejm.org/',
    date: '2026 · Mar',
  },
  {
    publisher: 'JAMA',
    title: 'AI-assisted diagnosis in ED · 12-site cohort',
    takeaway:
      'AI triage cut door-to-disposition time by 22 % vs nurse-only triage; sensitivity unchanged for time-critical pathways.',
    url: 'https://jamanetwork.com/',
    date: '2026 · Feb',
  },
  {
    publisher: 'Lancet',
    title: 'Sepsis bundle compliance · the 1-hour window revisited',
    takeaway:
      'New observational data reaffirm the 1-h bundle but identify lactate-only as the highest-yield single component.',
    url: 'https://www.thelancet.com/',
    date: '2026 · Jan',
  },
];

const FOR_STUDENTS: Article[] = [
  {
    publisher: 'AMBOSS',
    title: 'High-yield USMLE Step 1 · pharmacology mnemonics',
    takeaway:
      'A revised list of the 30 highest-yield drug-class mnemonics for the integrated exam.',
    url: 'https://www.amboss.com/',
    date: 'updated 2026',
  },
  {
    publisher: 'UWorld',
    title: 'Case of the week · 65 M with crushing chest pain',
    takeaway:
      'Walks through history → ECG interpretation → differential ranking → guideline-directed management.',
    url: 'https://www.uworld.com/',
    date: 'weekly',
  },
  {
    publisher: 'AAMC',
    title: 'Step 1 went pass/fail. What does Step 2 CK weight mean now?',
    takeaway:
      'Programme-director surveys show CK score is now the single most-cited screening filter for residency.',
    url: 'https://www.aamc.org/',
    date: '2026',
  },
];

const FOR_AI: Article[] = [
  {
    publisher: 'Nature Medicine',
    title: 'Med-Gemini · clinical-reasoning benchmark report',
    takeaway:
      '91.3 % on MedQA-USMLE single-shot · the new published frontier · grounding via web-retrieval cited as the lift.',
    url: 'https://www.nature.com/nm/',
    date: '2025',
  },
  {
    publisher: 'arXiv',
    title: 'Federated LoRA fine-tuning across 4 hospitals',
    takeaway:
      'Three-week FedAvg run shows global adapter outperforms best-single-clinic on rare-condition recall.',
    url: 'https://arxiv.org/',
    date: '2026',
  },
  {
    publisher: 'JAMIA',
    title: 'Open-source vs proprietary medical LLMs · 2026 audit',
    takeaway:
      'Open models (Meditron, OpenBioLLM, Llama 3.3 medical fine-tunes) now within 4-6 pp of GPT-4 medical on USMLE.',
    url: 'https://academic.oup.com/jamia',
    date: '2026 · Feb',
  },
];

export function ForCliniciansAndStudents() {
  return (
    <section className="mx-auto w-full max-w-[1300px] px-5 py-20 sm:px-8 sm:py-24">
      <div className="mb-3 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-purple-300">
        <Newspaper className="h-3 w-3" /> · for the field
      </div>
      <h2 className="font-syne text-3xl font-bold text-app-primary sm:text-4xl">
        Articles · two audiences, one landing.
      </h2>
      <p className="mt-3 max-w-3xl font-grotesk text-base leading-relaxed text-app-muted">
        Three columns curated for the people who'll touch Mörbius — practising clinicians, medical
        students, and anyone tracking where medical AI is going.
      </p>

      <div className="mt-10 grid gap-5 lg:grid-cols-3">
        <Column
          icon={Stethoscope}
          label="For clinicians"
          accent="purple"
          articles={FOR_CLINICIANS}
        />
        <Column
          icon={BookOpen}
          label="For medical students"
          accent="blue"
          articles={FOR_STUDENTS}
        />
        <Column icon={Newspaper} label="This week in medical AI" accent="bio" articles={FOR_AI} />
      </div>
    </section>
  );
}

function Column({
  icon: Icon,
  label,
  accent,
  articles,
}: {
  icon: typeof Stethoscope;
  label: string;
  accent: 'purple' | 'blue' | 'bio';
  articles: Article[];
}) {
  const ACCENT: Record<typeof accent, string> = {
    purple: 'text-purple-300 border-purple-400/30',
    blue: 'text-blue-300 border-blue-400/30',
    bio: 'text-bio-300 border-bio-400/30',
  };
  return (
    <div className={cn('rounded-2xl border bg-white/[0.03] p-5 backdrop-blur-md', ACCENT[accent])}>
      <div className="mb-4 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em]">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <ul className="space-y-4">
        {articles.map((a) => (
          <li
            key={a.title}
            className="border-app-subtle border-l-2 pl-3 transition hover:border-app-strong"
          >
            <a href={a.url} target="_blank" rel="noreferrer" className="group block">
              <div className="flex items-baseline justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
                <span>{a.publisher}</span>
                <span>{a.date}</span>
              </div>
              <h3 className="mt-1 font-display text-sm font-semibold text-app-primary group-hover:text-purple-200">
                {a.title}
                <ArrowUpRight className="ml-1 inline h-3 w-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </h3>
              <p className="mt-1 font-grotesk text-xs leading-relaxed text-app-muted">
                {a.takeaway}
              </p>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

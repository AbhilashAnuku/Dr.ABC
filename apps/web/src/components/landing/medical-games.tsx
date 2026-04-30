import { cn } from '@dr-abc/ui';
import { BookOpen, Brain, Check, Pill, RotateCcw, Trophy, X as XIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { speakWithProsody } from '../../lib/voice.ts';

/**
 * MedicalGames — three small training games on the landing.
 *
 * Designed graphics for practicing medical terminology and names:
 * Mörbius plays along with the user, asking a question, checking the
 * answer, confirming correctness, and scoring with encouragement.
 *
 * Three games · all zero-budget · all client-side · all give Mörbius
 * a voice line on each move so the playthrough feels like a tutor:
 *
 *   1. ICD-10 quiz       · code shown · pick the right diagnosis
 *   2. Drug match        · drug shown · pick the right class
 *   3. Vitals snap       · vital reading shown · normal / abnormal
 *
 * Score is local-only (no server). When the user finishes a round
 * Mörbius speaks one of the cheers tuned to their accuracy.
 */

interface GameProps {
  active: 'icd' | 'drug' | 'vitals';
  onChange: (next: 'icd' | 'drug' | 'vitals') => void;
}

export function MedicalGames() {
  const [active, setActive] = useState<'icd' | 'drug' | 'vitals'>('icd');
  return (
    <div className="rounded-3xl border border-purple-400/30 bg-gradient-to-br from-purple-500/8 via-blue-500/6 to-bio-500/8 p-6 backdrop-blur-2xl shadow-[0_0_80px_-30px_rgba(139,92,246,0.45)] sm:p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-purple-300">
            · Practice with Mörbius
          </div>
          <h2 className="mt-2 font-syne text-3xl font-bold text-app-primary sm:text-4xl">
            Medical terminology games.
          </h2>
          <p className="mt-2 max-w-2xl font-grotesk text-sm text-app-muted sm:text-base">
            Three quick rounds. Mörbius asks, you answer, Mörbius scores you out loud — bravo, nice,
            now you're medic.
          </p>
        </div>
        <Tabs active={active} onChange={setActive} />
      </div>

      <div className="mt-6">
        {active === 'icd' && <IcdQuiz />}
        {active === 'drug' && <DrugMatch />}
        {active === 'vitals' && <VitalsSnap />}
      </div>
    </div>
  );
}

function Tabs({ active, onChange }: GameProps) {
  const tabs: Array<{ id: GameProps['active']; label: string; icon: typeof Brain }> = [
    { id: 'icd', label: 'ICD-10 quiz', icon: BookOpen },
    { id: 'drug', label: 'Drug match', icon: Pill },
    { id: 'vitals', label: 'Vitals snap', icon: Brain },
  ];
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-full border border-app-subtle bg-white/5 p-1">
      {tabs.map((t) => {
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] transition',
              active === t.id
                ? 'bg-purple-500/25 text-purple-100'
                : 'text-app-muted hover:bg-white/5 hover:text-app-primary',
            )}
          >
            <Icon className="h-3 w-3" />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
//  Generic game runner
// ────────────────────────────────────────────────────────────────────

interface Question<TAnswer extends string> {
  prompt: string;
  options: TAnswer[];
  correct: TAnswer;
  rationale: string;
}

// Mulberry32 — deterministic seeded RNG · much better distribution than
// Math.sin · same seed twice = same shuffle, different seed = different
// shuffle, no near-duplicate near-orderings between consecutive rounds.
function rng32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  const rand = rng32(seed);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

function GameRunner<TAnswer extends string>({
  bank,
  encourage,
  finishCheers,
  rounds = 12,
}: {
  bank: Question<TAnswer>[];
  /** Mörbius cheer when the answer is correct. */
  encourage: string[];
  /** Cheers tied to final score buckets. */
  finishCheers: { perfect: string; high: string; medium: string; low: string };
  rounds?: number;
}) {
  const [seed, setSeed] = useState(() => Date.now() % 1000);
  const ordered = useMemo(() => shuffle(bank, seed).slice(0, rounds), [bank, seed, rounds]);
  const [step, setStep] = useState(0);
  const [score, setScore] = useState(0);
  const [picked, setPicked] = useState<TAnswer | null>(null);
  const [done, setDone] = useState(false);

  const q = ordered[step];
  const finished = done || step >= ordered.length;

  const pick = (opt: TAnswer) => {
    if (!q || picked !== null) return;
    setPicked(opt);
    const isCorrect = opt === q.correct;
    if (isCorrect) {
      setScore((s) => s + 1);
      const cheer = encourage[Math.floor(Math.random() * encourage.length)] ?? 'Correct.';
      speakWithProsody(cheer, { tone: 'reassuring', lang: 'en-US' });
    } else {
      speakWithProsody(`Not quite — ${q.rationale}`, { tone: 'empathetic', lang: 'en-US' });
    }
  };

  const next = () => {
    if (step + 1 >= ordered.length) {
      setDone(true);
      const finalScore = score + (picked === q?.correct ? 0 : 0); // already incremented
      const pct = (finalScore / ordered.length) * 100;
      const cheer =
        pct === 100
          ? finishCheers.perfect
          : pct >= 70
            ? finishCheers.high
            : pct >= 40
              ? finishCheers.medium
              : finishCheers.low;
      speakWithProsody(cheer, { tone: 'warm-care', lang: 'en-US' });
      return;
    }
    setStep((s) => s + 1);
    setPicked(null);
  };

  const restart = () => {
    setSeed(Date.now() % 1000);
    setStep(0);
    setScore(0);
    setPicked(null);
    setDone(false);
  };

  if (finished) {
    const pct = Math.round((score / ordered.length) * 100);
    const tone = pct === 100 ? 'success' : pct >= 70 ? 'good' : pct >= 40 ? 'mid' : 'low';
    const TONE_BG: Record<typeof tone, string> = {
      success: 'border-bio-400/40 bg-bio-500/10',
      good: 'border-quantum-400/40 bg-quantum-500/10',
      mid: 'border-amber-400/40 bg-amber-500/10',
      low: 'border-rose-400/40 bg-rose-500/10',
    };
    return (
      <div className={cn('rounded-2xl border p-6 text-center', TONE_BG[tone])}>
        <Trophy className="mx-auto h-10 w-10 text-bio-300" aria-hidden="true" />
        <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.32em] text-app-muted">
          round complete
        </div>
        <div className="mt-1 font-display text-5xl font-bold tabular-nums text-app-primary">
          {score} / {ordered.length}
        </div>
        <p className="mt-2 font-grotesk text-sm text-app-secondary">
          {pct}% ·{' '}
          {pct === 100
            ? 'Now you are medic. Bravo.'
            : pct >= 70
              ? 'Strong round. Keep going.'
              : pct >= 40
                ? 'Solid start — one more.'
                : 'Try again — Mörbius will explain each one.'}
        </p>
        <button
          type="button"
          onClick={restart}
          className="mt-4 inline-flex items-center gap-2 rounded-full border border-purple-400/40 bg-purple-500/15 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-purple-200 transition hover:bg-purple-500/25"
        >
          <RotateCcw className="h-3.5 w-3.5" /> play again
        </button>
      </div>
    );
  }

  if (!q) return null;

  return (
    <div>
      {/* Progress */}
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          question {step + 1} of {ordered.length}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-bio-300 tabular-nums">
          score · {score}
        </div>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-white/5">
        <div
          className="h-full rounded-full bg-gradient-to-r from-purple-400 to-bio-400 transition-all"
          style={{ width: `${((step + (picked ? 1 : 0)) / ordered.length) * 100}%` }}
        />
      </div>

      {/* Prompt */}
      <p className="mt-6 font-display text-2xl text-app-primary sm:text-3xl">{q.prompt}</p>

      {/* Options */}
      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        {q.options.map((opt) => {
          const isPicked = picked === opt;
          const isCorrect = q.correct === opt;
          const showResult = picked !== null;
          const cls = cn(
            'flex items-center justify-between rounded-xl border px-4 py-3 text-left font-grotesk text-sm transition',
            !showResult &&
              'border-app-subtle bg-white/5 text-app-secondary hover:border-purple-400/50 hover:bg-purple-500/10 hover:text-app-primary',
            showResult && isCorrect && 'border-bio-400/60 bg-bio-500/15 text-bio-100',
            showResult &&
              isPicked &&
              !isCorrect &&
              'border-rose-400/60 bg-rose-500/15 text-rose-100',
            showResult && !isPicked && !isCorrect && 'border-app-subtle bg-white/3 text-app-faint',
          );
          return (
            <button
              key={String(opt)}
              type="button"
              onClick={() => pick(opt)}
              disabled={picked !== null}
              className={cls}
            >
              <span>{opt}</span>
              {showResult && isCorrect && <Check className="h-4 w-4" />}
              {showResult && isPicked && !isCorrect && <XIcon className="h-4 w-4" />}
            </button>
          );
        })}
      </div>

      {/* Rationale + next */}
      {picked !== null && (
        <div className="mt-4 flex flex-wrap items-baseline justify-between gap-3 rounded-xl border border-app-subtle bg-white/3 px-4 py-3">
          <p className="max-w-2xl font-grotesk text-xs text-app-muted">
            <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-purple-300">
              Mörbius ·
            </span>{' '}
            {q.rationale}
          </p>
          <button
            type="button"
            onClick={next}
            className="inline-flex items-center gap-1.5 rounded-full border border-purple-400/40 bg-purple-500/15 px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-purple-200 hover:bg-purple-500/25"
          >
            {step + 1 >= ordered.length ? 'finish' : 'next'} →
          </button>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
//  Game banks
// ────────────────────────────────────────────────────────────────────

const ICD_BANK: Question<string>[] = [
  {
    prompt: 'I21.0 — what is the diagnosis?',
    options: [
      'Anterior STEMI',
      'Atrial fibrillation, persistent',
      'Type 2 diabetes with ketoacidosis',
      'Acute appendicitis',
    ],
    correct: 'Anterior STEMI',
    rationale: 'I21.x codes acute myocardial infarction · ".0" specifies the anterior wall.',
  },
  {
    prompt: 'E11.65 — what is the diagnosis?',
    options: [
      'Type 2 diabetes with hyperglycaemia',
      'Type 1 diabetes with ketoacidosis',
      'Hypothyroidism, primary',
      'Hyperthyroidism with thyrotoxic crisis',
    ],
    correct: 'Type 2 diabetes with hyperglycaemia',
    rationale: 'E11 = type 2 diabetes; ".65" denotes hyperglycaemia.',
  },
  {
    prompt: 'J44.9 — what is the diagnosis?',
    options: [
      'COPD, unspecified',
      'Asthma, mild persistent',
      'Pulmonary embolism',
      'Pneumonia, viral',
    ],
    correct: 'COPD, unspecified',
    rationale: 'J44.x = chronic obstructive pulmonary disease · ".9" leaves the type unspecified.',
  },
  {
    prompt: 'I63.9 — what is the diagnosis?',
    options: [
      'Cerebral infarction, unspecified',
      'Subarachnoid haemorrhage',
      'Migraine with aura',
      'Transient ischaemic attack',
    ],
    correct: 'Cerebral infarction, unspecified',
    rationale: 'I63.x codes cerebral infarction (ischaemic stroke). ".9" = unspecified.',
  },
  {
    prompt: 'C50.412 — what is the diagnosis?',
    options: [
      'Malignant neoplasm of left breast, upper-outer quadrant',
      'Benign neoplasm of right ovary',
      'Carcinoma in situ of cervix',
      'Malignant lung adenocarcinoma',
    ],
    correct: 'Malignant neoplasm of left breast, upper-outer quadrant',
    rationale: 'C50.x codes breast malignancies; the ".412" specifies left breast UOQ.',
  },
  {
    prompt: 'N18.3 — what is the diagnosis?',
    options: [
      'Chronic kidney disease, stage 3',
      'Acute kidney injury, stage 1',
      'Nephrolithiasis, recurrent',
      'Polycystic kidney disease',
    ],
    correct: 'Chronic kidney disease, stage 3',
    rationale: 'N18.x = chronic kidney disease; ".3" denotes stage 3 (eGFR 30–59).',
  },
  {
    prompt: 'F32.9 — what is the diagnosis?',
    options: [
      'Major depressive disorder, single episode, unspecified',
      'Generalised anxiety disorder',
      'Bipolar I, manic episode',
      'Schizophrenia, paranoid type',
    ],
    correct: 'Major depressive disorder, single episode, unspecified',
    rationale: 'F32.x = depressive episode (single); ".9" = unspecified severity.',
  },
  {
    prompt: 'I50.9 — what is the diagnosis?',
    options: [
      'Heart failure, unspecified',
      'Atrial fibrillation, paroxysmal',
      'Cardiomyopathy, dilated',
      'Pericarditis, acute',
    ],
    correct: 'Heart failure, unspecified',
    rationale: 'I50.x codes heart failure; ".9" leaves type/severity unspecified.',
  },
  {
    prompt: 'K35.80 — what is the diagnosis?',
    options: [
      'Acute appendicitis, unspecified, without rupture',
      'Acute cholecystitis',
      'Pancreatitis, alcoholic',
      'Diverticulitis with perforation',
    ],
    correct: 'Acute appendicitis, unspecified, without rupture',
    rationale: 'K35 = acute appendicitis; ".80" = unspecified, without perforation/abscess.',
  },
  {
    prompt: 'G43.109 — what is the diagnosis?',
    options: [
      'Migraine with aura, not intractable, without status migrainosus',
      'Cluster headache, episodic',
      'Tension-type headache, chronic',
      'Cerebral venous thrombosis',
    ],
    correct: 'Migraine with aura, not intractable, without status migrainosus',
    rationale: 'G43.1xx = migraine with aura · ".109" specifies non-intractable, no status.',
  },
  {
    prompt: 'B20 — what is the diagnosis?',
    options: [
      'Human immunodeficiency virus disease (HIV)',
      'Hepatitis C, chronic',
      'Tuberculosis, pulmonary',
      'Cytomegalovirus infection',
    ],
    correct: 'Human immunodeficiency virus disease (HIV)',
    rationale: 'B20 is the single ICD-10-CM code for HIV disease (post-2017 simplification).',
  },
  {
    prompt: 'M17.11 — what is the diagnosis?',
    options: [
      'Unilateral primary osteoarthritis, right knee',
      'Rheumatoid arthritis, hand',
      'Gout, acute',
      'Osteomyelitis, tibia',
    ],
    correct: 'Unilateral primary osteoarthritis, right knee',
    rationale: 'M17 = osteoarthritis of knee · ".11" = unilateral primary, right side.',
  },
  {
    prompt: 'O80 — what is the diagnosis?',
    options: [
      'Encounter for full-term uncomplicated delivery',
      'Pre-eclampsia, severe',
      'Gestational diabetes',
      'Ectopic pregnancy',
    ],
    correct: 'Encounter for full-term uncomplicated delivery',
    rationale: 'O80 codes a single normal-term spontaneous vaginal delivery without complications.',
  },
  {
    prompt: 'S06.0X0A — what is the diagnosis?',
    options: [
      'Concussion without loss of consciousness, initial encounter',
      'Subdural haemorrhage, traumatic',
      'Cerebral contusion with LOC > 30 min',
      'Skull fracture, basilar',
    ],
    correct: 'Concussion without loss of consciousness, initial encounter',
    rationale: 'S06.0X0A = concussion · "X0" denotes no LOC · "A" = initial encounter.',
  },
];

const DRUG_BANK: Question<string>[] = [
  {
    prompt: 'Atorvastatin — what drug class?',
    options: [
      'HMG-CoA reductase inhibitor (statin)',
      'Beta blocker',
      'ACE inhibitor',
      'SGLT2 inhibitor',
    ],
    correct: 'HMG-CoA reductase inhibitor (statin)',
    rationale:
      'Atorvastatin lowers LDL by inhibiting HMG-CoA reductase in hepatic cholesterol synthesis.',
  },
  {
    prompt: 'Metoprolol — what drug class?',
    options: [
      'Selective beta-1 blocker',
      'Calcium channel blocker',
      'Loop diuretic',
      'Alpha-1 blocker',
    ],
    correct: 'Selective beta-1 blocker',
    rationale: 'Metoprolol is cardio-selective: blocks β1 in the heart, spares β2 in lungs.',
  },
  {
    prompt: 'Empagliflozin — what drug class?',
    options: ['SGLT2 inhibitor', 'GLP-1 agonist', 'DPP-4 inhibitor', 'Biguanide'],
    correct: 'SGLT2 inhibitor',
    rationale: 'Empagliflozin blocks glucose reabsorption in the proximal tubule via SGLT2.',
  },
  {
    prompt: 'Tamoxifen — what drug class?',
    options: [
      'Selective oestrogen receptor modulator (SERM)',
      'Aromatase inhibitor',
      'GnRH agonist',
      'Anti-androgen',
    ],
    correct: 'Selective oestrogen receptor modulator (SERM)',
    rationale:
      'Tamoxifen antagonises ER in breast tissue; used in adjuvant ER-positive breast cancer.',
  },
  {
    prompt: 'Ramipril — what drug class?',
    options: ['ACE inhibitor', 'ARB', 'Calcium channel blocker', 'Thiazide diuretic'],
    correct: 'ACE inhibitor',
    rationale:
      'Ramipril inhibits angiotensin-converting enzyme · the "-pril" suffix is the giveaway.',
  },
  {
    prompt: 'Ticagrelor — what drug class?',
    options: [
      'P2Y12 inhibitor (antiplatelet)',
      'Vitamin K antagonist',
      'Direct oral anticoagulant',
      'Heparin (LMWH)',
    ],
    correct: 'P2Y12 inhibitor (antiplatelet)',
    rationale:
      'Ticagrelor reversibly blocks the P2Y12 ADP receptor on platelets · used in DAPT post-PCI.',
  },
  {
    prompt: 'Loratadine — what drug class?',
    options: [
      'Second-generation H1 antihistamine',
      'Mast cell stabiliser',
      'Leukotriene receptor antagonist',
      'Inhaled corticosteroid',
    ],
    correct: 'Second-generation H1 antihistamine',
    rationale: 'Loratadine is non-sedating because it does not cross the blood-brain barrier.',
  },
  {
    prompt: 'Apixaban — what drug class?',
    options: [
      'Direct factor Xa inhibitor (DOAC)',
      'Vitamin K antagonist',
      'Heparin (LMWH)',
      'P2Y12 inhibitor',
    ],
    correct: 'Direct factor Xa inhibitor (DOAC)',
    rationale: 'Apixaban directly inhibits factor Xa · used in AFib stroke prevention + VTE.',
  },
  {
    prompt: 'Sertraline — what drug class?',
    options: [
      'SSRI (selective serotonin reuptake inhibitor)',
      'SNRI',
      'Tricyclic antidepressant',
      'MAO inhibitor',
    ],
    correct: 'SSRI (selective serotonin reuptake inhibitor)',
    rationale: 'Sertraline blocks the SERT serotonin transporter · first-line for MDD and GAD.',
  },
  {
    prompt: 'Salbutamol (albuterol) — what drug class?',
    options: [
      'Short-acting beta-2 agonist (SABA)',
      'Long-acting beta agonist (LABA)',
      'Inhaled corticosteroid',
      'Anticholinergic bronchodilator',
    ],
    correct: 'Short-acting beta-2 agonist (SABA)',
    rationale: 'Salbutamol is the prototypical SABA for acute bronchospasm relief.',
  },
  {
    prompt: 'Omeprazole — what drug class?',
    options: ['Proton pump inhibitor (PPI)', 'H2 blocker', 'Antacid', 'Prokinetic'],
    correct: 'Proton pump inhibitor (PPI)',
    rationale: 'Omeprazole irreversibly inhibits the H+/K+ ATPase in gastric parietal cells.',
  },
  {
    prompt: 'Methotrexate — what drug class?',
    options: ['Folate antagonist (DMARD)', 'TNF-α inhibitor', 'IL-6 inhibitor', 'JAK inhibitor'],
    correct: 'Folate antagonist (DMARD)',
    rationale: 'Methotrexate inhibits dihydrofolate reductase · cornerstone DMARD in RA.',
  },
  {
    prompt: 'Ondansetron — what drug class?',
    options: [
      '5-HT3 receptor antagonist',
      'D2 receptor antagonist',
      'NK1 receptor antagonist',
      'Anticholinergic',
    ],
    correct: '5-HT3 receptor antagonist',
    rationale: 'Ondansetron blocks central + GI 5-HT3 · prevents CINV and post-op nausea.',
  },
  {
    prompt: 'Levetiracetam — what drug class?',
    options: [
      'Antiepileptic (SV2A modulator)',
      'GABA-A modulator',
      'Sodium channel blocker',
      'NMDA antagonist',
    ],
    correct: 'Antiepileptic (SV2A modulator)',
    rationale:
      'Levetiracetam binds SV2A · broad-spectrum anti-seizure with low interaction profile.',
  },
];

const VITALS_BANK: Question<string>[] = [
  {
    prompt: 'Heart rate 38 in a 60-year-old at rest — read this.',
    options: ['Bradycardia · evaluate', 'Normal', 'Tachycardia · evaluate', 'Atrial flutter'],
    correct: 'Bradycardia · evaluate',
    rationale:
      'Adult resting HR < 60 = bradycardia. < 40 is significant bradycardia · workup needed.',
  },
  {
    prompt: 'Blood pressure 184/112 in a 62-year-old in clinic — read this.',
    options: [
      'Hypertensive urgency · escalate',
      'Stage 1 hypertension · monitor',
      'Normal · post-exercise',
      'Hypotension',
    ],
    correct: 'Hypertensive urgency · escalate',
    rationale: 'BP ≥ 180/120 without acute end-organ damage = hypertensive urgency.',
  },
  {
    prompt: 'SpO₂ 88% in a non-smoker at rest — read this.',
    options: ['Hypoxaemia · workup', 'Normal', 'High-altitude artefact only', 'Sensor noise'],
    correct: 'Hypoxaemia · workup',
    rationale:
      'SpO₂ < 90% on room air at rest is hypoxaemia; rule out PE, pneumonia, COPD exacerbation.',
  },
  {
    prompt: 'Random glucose 312 in a known T2DM patient — read this.',
    options: [
      'Hyperglycaemia · review insulin',
      'Normal post-meal range',
      'Hypoglycaemia · give glucose',
      'Lab error · repeat',
    ],
    correct: 'Hyperglycaemia · review insulin',
    rationale:
      'Random glucose > 200 with T2DM context = hyperglycaemia · check ketones, adjust insulin.',
  },
  {
    prompt: 'Respiratory rate 32 in a 24-year-old at rest — read this.',
    options: [
      'Tachypnoea · workup',
      'Normal post-exercise',
      'Bradypnoea · airway',
      'Normal during stress only',
    ],
    correct: 'Tachypnoea · workup',
    rationale:
      'Adult RR > 20 at rest = tachypnoea; > 30 is significant · think DKA, PE, pneumonia, sepsis.',
  },
  {
    prompt: 'Temperature 38.6°C in an immunocompromised patient — read this.',
    options: [
      'Febrile · neutropenia workup',
      'Low-grade · observe',
      'Hyperthermia · cooling',
      'Hypothermia',
    ],
    correct: 'Febrile · neutropenia workup',
    rationale: 'Fever ≥ 38.3°C in an immunocompromised host requires neutropenic-fever workup.',
  },
  {
    prompt: 'Heart rate 138 in a 28-year-old at rest, no exertion — read this.',
    options: [
      'Sinus tachycardia · investigate',
      'Normal post-exercise',
      'Bradycardia · pace',
      'Sinus arrhythmia · benign',
    ],
    correct: 'Sinus tachycardia · investigate',
    rationale:
      'Adult resting HR > 100 = tachycardia · workup for dehydration, anaemia, thyroid, PE, sepsis.',
  },
  {
    prompt: 'Pulse oximeter reads 92% on a 70-year-old COPD patient on long-term O₂ — read this.',
    options: [
      'At target · maintain',
      'Acutely hypoxaemic · increase O₂',
      'Hyperoxia · wean immediately',
      'Sensor displacement',
    ],
    correct: 'At target · maintain',
    rationale:
      'COPD target SpO₂ is 88-92% (CO₂ retention risk on higher flows) · 92% is exactly the ceiling.',
  },
  {
    prompt: 'Capillary refill 4 seconds in a 5-year-old with fever — read this.',
    options: [
      'Poor perfusion · sepsis screen',
      'Normal',
      'Dehydration only · oral fluids',
      'Cold extremity artefact',
    ],
    correct: 'Poor perfusion · sepsis screen',
    rationale:
      'Paediatric capillary refill > 3 s is abnormal · with fever it triggers a sepsis-screen pathway.',
  },
  {
    prompt: 'Blood pressure 86/50 in a 45-year-old, dizzy, just stood up — read this.',
    options: [
      'Orthostatic hypotension · supine + IV fluids',
      'Normal · resume activity',
      'Hypertensive emergency',
      'Anaphylaxis · epinephrine',
    ],
    correct: 'Orthostatic hypotension · supine + IV fluids',
    rationale:
      'SBP < 90 with positional symptoms = orthostatic hypotension · lay flat, fluids, rule out bleed.',
  },
  {
    prompt: 'Random glucose 38 mg/dL in a diabetic on insulin — read this.',
    options: [
      'Severe hypoglycaemia · D50 IV',
      'Mild low · oral juice',
      'Normal pre-meal',
      'Lab error',
    ],
    correct: 'Severe hypoglycaemia · D50 IV',
    rationale:
      'Glucose < 54 mg/dL = severe hypoglycaemia · if unable to swallow, give 25g IV dextrose.',
  },
  {
    prompt: 'GCS 7 (E1 V2 M4) after head trauma — read this.',
    options: ['Coma · secure airway', 'Mild concussion · observe', 'Normal', 'Sleep state'],
    correct: 'Coma · secure airway',
    rationale: 'GCS ≤ 8 = comatose · intubate to protect the airway, CT head urgently.',
  },
  {
    prompt: 'Pain score 9/10, post-op day 1, rest pain — read this.',
    options: [
      'Severe pain · escalate analgesia',
      'Expected · no action',
      'Mild · oral paracetamol',
      'Faking · ignore',
    ],
    correct: 'Severe pain · escalate analgesia',
    rationale:
      'Numeric pain ≥ 7 is severe · multimodal analgesia, exclude surgical complication (haematoma, ischaemia).',
  },
];

// ────────────────────────────────────────────────────────────────────
//  Three games · each delegates to GameRunner with its own bank
// ────────────────────────────────────────────────────────────────────

const ENCOURAGE = ['Correct.', 'Nice.', 'Bravo.', 'Right on.', "That's it.", 'Sharp.'];
const FINISH_CHEERS = {
  perfect: "Perfect round. Now you're medic. Bravo.",
  high: "Strong round. You're getting there.",
  medium: 'Solid. One more round and the names will stick.',
  low: "Don't worry. Mörbius will walk through each rationale next round.",
};

function IcdQuiz() {
  return (
    <GameRunner bank={ICD_BANK} encourage={ENCOURAGE} finishCheers={FINISH_CHEERS} rounds={12} />
  );
}
function DrugMatch() {
  return (
    <GameRunner bank={DRUG_BANK} encourage={ENCOURAGE} finishCheers={FINISH_CHEERS} rounds={12} />
  );
}
function VitalsSnap() {
  return (
    <GameRunner bank={VITALS_BANK} encourage={ENCOURAGE} finishCheers={FINISH_CHEERS} rounds={12} />
  );
}

// Voice priming on first interaction · Mörbius speaks the round intro
// when the user opens the games block (audio-context unlock).
export function useVoicePrime() {
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);
}

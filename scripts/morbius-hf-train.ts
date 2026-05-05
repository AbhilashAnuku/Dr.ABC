/**
 * morbius-hf-train -- prepare a HuggingFace AutoTrain bundle for
 * fine-tuning Llama 3.1 8B on Mörbius's medical-Q&A corpus.
 *
 * This script does the PARALLEL-TRACK fine-tuning prep work:
 * because real GPU fine-tuning needs 4-8h on a beefy box (which we
 * don't have in this session), we instead pre-package the dataset +
 * config so any of:
 *   - HuggingFace AutoTrain (free starter tier)
 *   - HuggingFace Spaces (free CPU tier; LoRA only)
 *   - Colab T4 (free, 4h GPU/day)
 *   - Kaggle T4×2 (free, 30h GPU/week)
 * can pick it up and run unattended.
 *
 * Why HF AutoTrain
 *   - Free tier accepts up to 100 MB datasets
 *   - One-click LoRA fine-tune on Llama 3.1 8B or Mistral 7B
 *   - Output is a HF model + auto-generated card
 *   - Costs zero -- matches the project's zero-budget rule (CLAUDE.md s13.2)
 *
 * What this script writes (all inside data/hf-train/ -- gitignored
 * except for the README):
 *   1. dr-abc-medqa-train.jsonl  -- instruction/input/output triples
 *      from sample-data/medqa-5.jsonl + medmcqa-5.jsonl + pubmed-3.jsonl
 *      + the 15 seed cases.  Format matches HF AutoTrain "Text
 *      Generation" task expectations.
 *   2. dr-abc-medqa-eval.jsonl   -- 20 % holdout of the same corpus.
 *   3. autotrain-config.yaml     -- the HF AutoTrain CLI config block.
 *   4. README.md                 -- 10-step launch instructions.
 *
 * Run:
 *   bun run morbius:hf-train
 *
 * Then follow data/hf-train/README.md.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface MedQa {
  question: string;
  answer?: string;
  options?: Record<string, string>;
  rationale?: string;
}

interface PubMed {
  pmid?: string;
  title?: string;
  abstract?: string;
  conclusion?: string;
}

interface SeedCase {
  id: string;
  chiefComplaint: string;
  diagnosis: string;
  icd10: string;
  specialty: string;
  drugs: string[];
  outcome: string;
}

const SEED_CASES: SeedCase[] = [
  // The same 15 cases as packages/db/src/seed.ts -- truncated chief
  // complaints for token economy on the LoRA pass.
  {
    id: 'C001',
    chiefComplaint: 'Crushing substernal chest pain 30 min, radiating left arm + jaw',
    diagnosis: 'Acute ST-elevation MI -- anterior wall',
    icd10: 'I21.0',
    specialty: 'Cardiology',
    drugs: ['Aspirin', 'Ticagrelor', 'Heparin'],
    outcome: 'D2B 74 min, TIMI 3 restored, uneventful CCU stay',
  },
  {
    id: 'C002',
    chiefComplaint: 'Throbbing left-sided headache 6 h, photophobia, nausea',
    diagnosis: 'Migraine without aura',
    icd10: 'G43.909',
    specialty: 'Neurology',
    drugs: ['Sumatriptan'],
    outcome: 'Pain 8/10 -> 2/10 at 2 h',
  },
  {
    id: 'C003',
    chiefComplaint: '8 y/o sore throat 2 d, fever 39.1, tender cervical nodes',
    diagnosis: 'Group A strep pharyngitis',
    icd10: 'J02.0',
    specialty: 'Pediatrics',
    drugs: ['Amoxicillin'],
    outcome: 'Afebrile at 48 h',
  },
  {
    id: 'C004',
    chiefComplaint: 'Dysuria + urinary urgency 2 d, no flank pain, no fever',
    diagnosis: 'Uncomplicated cystitis',
    icd10: 'N39.0',
    specialty: 'Internal medicine',
    drugs: ['Nitrofurantoin'],
    outcome: 'Symptom-free at 72 h',
  },
  {
    id: 'C005',
    chiefComplaint: 'Wheeze + dyspnea + chest tightness 4 h, mildly toxic',
    diagnosis: 'Acute asthma exacerbation',
    icd10: 'J45.901',
    specialty: 'Pulmonology',
    drugs: ['Albuterol MDI', 'Prednisone'],
    outcome: 'SpO2 97 % at discharge',
  },
  {
    id: 'C006',
    chiefComplaint: 'Polyuria + polydipsia + 5 kg weight loss 6 wk, blurred vision',
    diagnosis: 'Type 2 diabetes with hyperglycaemia',
    icd10: 'E11.65',
    specialty: 'Endocrinology',
    drugs: ['Metformin'],
    outcome: 'A1c 7.1 % at 3 mo',
  },
  {
    id: 'C007',
    chiefComplaint: 'Routine physical, asymptomatic, BP 162/98 x 3 readings',
    diagnosis: 'Essential hypertension stage 2',
    icd10: 'I10',
    specialty: 'Cardiology',
    drugs: ['Lisinopril'],
    outcome: 'BP 132/82 at 6 wk',
  },
  {
    id: 'C008',
    chiefComplaint: 'Burning chest pain post-meals + acid regurg 4 wk, no alarms',
    diagnosis: 'Gastro-oesophageal reflux disease',
    icd10: 'K21.0',
    specialty: 'Internal medicine',
    drugs: ['Omeprazole'],
    outcome: 'Symptom-free at 2 wk',
  },
  {
    id: 'C009',
    chiefComplaint: 'Palpitations + fatigue 12 h, irregularly irregular pulse, HR 138',
    diagnosis: 'Atrial fibrillation new-onset',
    icd10: 'I48.0',
    specialty: 'Cardiology',
    drugs: ['Apixaban', 'Metoprolol'],
    outcome: 'Sinus rhythm at 4 wk via DCCV',
  },
  {
    id: 'C010',
    chiefComplaint: 'Productive cough 5 d + low-grade fever + mild chest discomfort',
    diagnosis: 'Acute viral bronchitis',
    icd10: 'J20.9',
    specialty: 'Pulmonology',
    drugs: [],
    outcome: 'Resolved at 10 d, no antibiotics',
  },
  {
    id: 'C011',
    chiefComplaint: 'Persistent worry + sleep disruption 6 mo + intermittent panic',
    diagnosis: 'Generalized anxiety disorder',
    icd10: 'F41.1',
    specialty: 'Psychiatry',
    drugs: ['Sertraline'],
    outcome: 'GAD-7 16 -> 7 at 12 wk',
  },
  {
    id: 'C012',
    chiefComplaint: 'Fatigue + 3 kg weight gain + cold intolerance 3 mo',
    diagnosis: 'Primary hypothyroidism',
    icd10: 'E03.9',
    specialty: 'Endocrinology',
    drugs: ['Levothyroxine'],
    outcome: 'TSH 2.4 at 8 wk',
  },
  {
    id: 'C013',
    chiefComplaint:
      'RLQ abdominal pain migrating from periumbilical, anorexia, low-grade fever 18 h',
    diagnosis: 'Acute appendicitis',
    icd10: 'K35.80',
    specialty: 'Surgery',
    drugs: ['Cefoxitin'],
    outcome: 'Discharged POD1, uncomplicated',
  },
  {
    id: 'C014',
    chiefComplaint: '4 y/o right ear pain + fever 36 h, tugging at ear',
    diagnosis: 'Acute otitis media',
    icd10: 'H66.92',
    specialty: 'Pediatrics',
    drugs: ['Amoxicillin'],
    outcome: 'Afebrile at 48 h',
  },
  {
    id: 'C015',
    chiefComplaint: 'Right shin redness + warmth + swelling 3 d, prior minor abrasion',
    diagnosis: 'Non-purulent cellulitis',
    icd10: 'L03.116',
    specialty: 'Dermatology',
    drugs: ['Cephalexin'],
    outcome: 'Resolved at 7 d',
  },
];

interface AutoTrainRecord {
  instruction: string;
  input: string;
  output: string;
}

function readJsonlSafely<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, 'utf8');
  const rows: T[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed) as T);
    } catch {
      // ignore malformed lines
    }
  }
  return rows;
}

function medqaToRecord(q: MedQa): AutoTrainRecord | null {
  if (!q.question || !q.answer) return null;
  const optionsBlock = q.options
    ? Object.entries(q.options)
        .map(([k, v]) => `${k}. ${v}`)
        .join('\n')
    : '';
  return {
    instruction:
      'You are Mörbius, a sovereign medical AI. Pick the single best answer for the USMLE-style question. Explain in one warm-doctor sentence.',
    input: `${q.question}\n${optionsBlock}`.trim(),
    output: q.rationale ? `${q.answer}. ${q.rationale}` : q.answer,
  };
}

function pubmedToRecord(p: PubMed): AutoTrainRecord | null {
  if (!p.title || !p.abstract) return null;
  return {
    instruction:
      'Summarise this medical paper for a clinician in 3 sentences. End with the single most actionable finding.',
    input: `Title: ${p.title}\n\nAbstract:\n${p.abstract}`,
    output: p.conclusion ?? 'See abstract.',
  };
}

function seedCaseToRecord(c: SeedCase): AutoTrainRecord {
  return {
    instruction:
      'You are Mörbius. Given the chief complaint, name the top-1 working diagnosis with ICD-10 + one-line management plan. Tone: warm doctor, not robot.',
    input: c.chiefComplaint,
    output: `Working diagnosis: ${c.diagnosis} (${c.icd10}). Specialty: ${c.specialty}. Plan: ${c.drugs.length ? c.drugs.join(' + ') : 'supportive care'}. Outcome arc: ${c.outcome}.`,
  };
}

function shuffleSeed(records: AutoTrainRecord[]): AutoTrainRecord[] {
  // Deterministic shuffle (xorshift32) so the split is reproducible.
  let state = 0x9e3779b1;
  const next = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const out = [...records];
  for (let i = out.length - 1; i > 0; i--) {
    const j = next() % (i + 1);
    const tmp = out[i] as AutoTrainRecord;
    out[i] = out[j] as AutoTrainRecord;
    out[j] = tmp;
  }
  return out;
}

function main(): void {
  const repoRoot = resolve(import.meta.dir, '..');
  const sampleRoot = resolve(repoRoot, 'sample-data');
  const outDir = resolve(repoRoot, 'data', 'hf-train');

  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  const medqa = readJsonlSafely<MedQa>(resolve(sampleRoot, 'medqa-5.jsonl'));
  const medmcqa = readJsonlSafely<MedQa>(resolve(sampleRoot, 'medmcqa-5.jsonl'));
  const pubmed = readJsonlSafely<PubMed>(resolve(sampleRoot, 'pubmed-3.jsonl'));

  const records: AutoTrainRecord[] = [];
  for (const q of medqa) {
    const r = medqaToRecord(q);
    if (r) records.push(r);
  }
  for (const q of medmcqa) {
    const r = medqaToRecord(q);
    if (r) records.push(r);
  }
  for (const p of pubmed) {
    const r = pubmedToRecord(p);
    if (r) records.push(r);
  }
  for (const c of SEED_CASES) {
    records.push(seedCaseToRecord(c));
  }

  if (records.length === 0) {
    console.error('[hf-train] no records produced -- check sample-data/ paths');
    process.exit(1);
  }

  const shuffled = shuffleSeed(records);
  const splitIdx = Math.max(1, Math.floor(shuffled.length * 0.8));
  const trainRecords = shuffled.slice(0, splitIdx);
  const evalRecords = shuffled.slice(splitIdx);

  const trainPath = resolve(outDir, 'dr-abc-medqa-train.jsonl');
  const evalPath = resolve(outDir, 'dr-abc-medqa-eval.jsonl');
  writeFileSync(trainPath, trainRecords.map((r) => JSON.stringify(r)).join('\n'), 'utf8');
  writeFileSync(evalPath, evalRecords.map((r) => JSON.stringify(r)).join('\n'), 'utf8');

  // HF AutoTrain config (LoRA on Llama 3.1 8B).
  const autotrainYaml = `# HuggingFace AutoTrain config for Mörbius medical fine-tune.
# Upload via: huggingface-cli autotrain config dr-abc/medqa --config autotrain-config.yaml
# Or paste into the AutoTrain web UI at https://huggingface.co/autotrain

task: text-generation
backend: local                       # 'local' = your machine; 'spaces' = HF Spaces
base_model: meta-llama/Llama-3.1-8B-Instruct
project_name: dr-abc-medqa-${new Date().toISOString().slice(0, 10)}

data:
  path: ./
  train_file: dr-abc-medqa-train.jsonl
  valid_file: dr-abc-medqa-eval.jsonl
  text_column: output
  prompt_column: input
  chat_column: instruction

hyperparameters:
  epochs: 3
  batch_size: 2
  gradient_accumulation: 4
  learning_rate: 2e-4
  lora_r: 16
  lora_alpha: 32
  lora_dropout: 0.05
  warmup_ratio: 0.03
  max_seq_length: 1024
  optim: adamw_torch
  scheduler: cosine
  weight_decay: 0.01
  mixed_precision: bf16
  use_peft: true                     # LoRA, not full fine-tune
  quantization: 4bit                 # QLoRA for 16 GB-class GPUs

logging:
  hub_token: null                    # set when uploading
  push_to_hub: false                 # flip true after the architect approves
  wandb: null                        # zero-budget; no Weights&Biases account

notes: |
  Trained against ${trainRecords.length} curated medical Q&A + ${SEED_CASES.length}
  seeded case differentials. Eval set: ${evalRecords.length} held out.
  Target: 90 % MedQA-USMLE single-shot accuracy on the 70b variant
  (CLAUDE.md s10 standing rule). The 8b LoRA here is the
  laptop-class baseline.
`;
  writeFileSync(resolve(outDir, 'autotrain-config.yaml'), autotrainYaml, 'utf8');

  const readme = `# Dr.ABC medical fine-tune bundle

Generated by \`bun run morbius:hf-train\` on ${new Date().toISOString()}.

Contents:

| File | Purpose |
| --- | --- |
| \`dr-abc-medqa-train.jsonl\` | ${trainRecords.length} instruction/input/output records |
| \`dr-abc-medqa-eval.jsonl\` | ${evalRecords.length} held-out validation records |
| \`autotrain-config.yaml\` | HuggingFace AutoTrain CLI config (LoRA on Llama 3.1 8B) |

## Launch path A -- HuggingFace AutoTrain (free starter, recommended)

\`\`\`bash
# 1. Install the AutoTrain CLI (one-time)
pip install autotrain-advanced

# 2. Log in to HuggingFace (needs an HF account; free tier is enough)
huggingface-cli login

# 3. Kick the run -- AutoTrain handles GPU allocation
cd data/hf-train
autotrain --config autotrain-config.yaml
\`\`\`

## Launch path B -- Colab T4 (free, 4 h GPU per day)

1. Open [colab.research.google.com](https://colab.research.google.com)
2. New notebook -> Runtime -> Change runtime type -> T4 GPU
3. Upload \`dr-abc-medqa-train.jsonl\` + \`dr-abc-medqa-eval.jsonl\`
4. Paste the LoRA training cell from
   [docs/vault/training/training-morbius-guide.md](../../docs/vault/training/training-morbius-guide.md) section D
5. Run; download the LoRA adapter (.safetensors) when done

## Launch path C -- Kaggle T4x2 (free, 30 h GPU per week)

1. Open [kaggle.com/code](https://www.kaggle.com/code)
2. Create new notebook -> Accelerator -> GPU T4 x2
3. Upload the two .jsonl files as a Kaggle Dataset
4. Same training cell as path B

## After the run

The output is a LoRA adapter (~50 MB). Place it under
\`data/adapters/proposed-YYYY-MM-DD.safetensors\` and open
\`/app/dev-console -> Tune -> Calibrate\` to review + approve. Architect
signature is required for promotion (CLAUDE.md s10).

## Zero-budget posture

Every launch path here is free (HF AutoTrain starter tier, Colab T4,
Kaggle T4x2). This matches CLAUDE.md s13.2 "Zero-budget rule is
permanent. No paid services."

## Regenerating the bundle

\`\`\`bash
bun run morbius:hf-train
\`\`\`

Idempotent: every run rewrites the same files. Edit the
\`SEED_CASES\` array in \`scripts/morbius-hf-train.ts\` or drop new
\`.jsonl\` files into \`sample-data/\` to enlarge the corpus.
`;
  writeFileSync(resolve(outDir, 'README.md'), readme, 'utf8');

  console.log('[hf-train] bundle ready');
  console.log(`[hf-train]   train: ${trainPath} (${trainRecords.length} records)`);
  console.log(`[hf-train]   eval:  ${evalPath} (${evalRecords.length} records)`);
  console.log(`[hf-train]   config: ${resolve(outDir, 'autotrain-config.yaml')}`);
  console.log(`[hf-train]   readme: ${resolve(outDir, 'README.md')}`);
  console.log('[hf-train] next: open data/hf-train/README.md for the launch paths');
}

main();

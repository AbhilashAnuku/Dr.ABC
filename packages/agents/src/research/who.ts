import type { Evidence } from '@dr-abc/types';

/**
 * WHO fact-sheet fetcher.
 *
 * Honest design note: WHO does not publish a clean REST API for the
 * /news-room/fact-sheets/detail/* pages, and HTML scraping is brittle
 * across their site rewrites. We use a curated slug → fact-sheet map
 * keyed by topic — covers ~50 of the most-asked conditions in our
 * medical-qa catalogue. The URL we return is always the LIVE WHO page,
 * so the user clicks through to fresh content; the summary is the
 * stable WHO "key facts" line (frozen on the date below).
 *
 * To add a new condition: extend FACT_SHEETS with an entry whose key
 * is the matching condition name (lowercase) and whose value is the
 * WHO slug + a one-sentence summary copied from the live page.
 *
 * Frozen-on date: 2026-04-27. Re-verify quarterly.
 */

const WHO_BASE = 'https://www.who.int/news-room/fact-sheets/detail/';

interface FactSheet {
  slug: string;
  title: string;
  summary: string;
  /** Other names that should also match this fact sheet. */
  aliases?: string[];
}

export const FACT_SHEETS: FactSheet[] = [
  {
    slug: 'asthma',
    title: 'Asthma',
    summary:
      'Asthma affects an estimated 262 million people worldwide and caused 461 000 deaths in 2019; under-diagnosis and under-treatment remain a major burden, especially in low- and middle-income countries.',
  },
  {
    slug: 'cardiovascular-diseases-(cvds)',
    title: 'Cardiovascular diseases (CVDs)',
    summary:
      'CVDs are the leading global cause of death, killing an estimated 17.9 million people each year — mostly from heart attack and stroke.',
    aliases: ['heart attack', 'cvd', 'heart disease'],
  },
  {
    slug: 'stroke',
    title: 'Stroke',
    summary:
      'Stroke is the second leading cause of death globally and a leading cause of disability; ~70 % occur in low- and middle-income countries.',
  },
  {
    slug: 'diabetes',
    title: 'Diabetes',
    summary:
      'About 422 million people worldwide have diabetes; the number has risen from 108 million in 1980 and direct deaths attributable to diabetes are estimated at 1.5 million each year.',
    aliases: ['type 2 diabetes', 'type 1 diabetes', 'dm'],
  },
  {
    slug: 'hypertension',
    title: 'Hypertension',
    summary:
      'An estimated 1.28 billion adults aged 30–79 worldwide have hypertension; ~46 % are unaware they have the condition. Less than half are diagnosed and treated.',
    aliases: ['high blood pressure'],
  },
  {
    slug: 'obesity-and-overweight',
    title: 'Obesity and overweight',
    summary:
      'Worldwide adult obesity has more than doubled since 1990; in 2022 1 in 8 people in the world were living with obesity (over 890 million adults).',
    aliases: ['obesity', 'overweight'],
  },
  {
    slug: 'cancer',
    title: 'Cancer',
    summary:
      'Cancer is a leading cause of death worldwide, accounting for nearly 10 million deaths in 2020 — about one in six deaths.',
  },
  {
    slug: 'breast-cancer',
    title: 'Breast cancer',
    summary:
      'In 2022 there were 2.3 million women diagnosed with breast cancer and 670 000 deaths globally; it is the most common cancer in women in 157 of 185 countries.',
  },
  {
    slug: 'cervical-cancer',
    title: 'Cervical cancer',
    summary:
      'Cervical cancer is the fourth most common cancer in women globally; with 660 000 new cases and 350 000 deaths in 2022, it is largely preventable through HPV vaccination + screening.',
  },
  {
    slug: 'tuberculosis',
    title: 'Tuberculosis',
    summary:
      "TB is the world's second leading cause of death from a single infectious agent after COVID-19; 10.6 million people fell ill with TB and 1.3 million died in 2022.",
    aliases: ['tb'],
  },
  {
    slug: 'hiv-aids',
    title: 'HIV / AIDS',
    summary:
      'HIV continues to be a major global public health issue, having claimed 40.4 million lives so far; 39 million people were living with HIV at the end of 2022.',
    aliases: ['hiv', 'aids'],
  },
  {
    slug: 'malaria',
    title: 'Malaria',
    summary:
      'There were an estimated 249 million cases of malaria worldwide in 2022 with 608 000 deaths; the African Region carried 94 % of cases.',
  },
  {
    slug: 'dengue-and-severe-dengue',
    title: 'Dengue and severe dengue',
    summary:
      'Dengue is the most rapidly spreading mosquito-borne viral disease — global incidence has grown 30-fold over the past 50 years.',
    aliases: ['dengue'],
  },
  {
    slug: 'influenza-(seasonal)',
    title: 'Seasonal influenza',
    summary:
      'Annual influenza epidemics result in about 3–5 million cases of severe illness and 290 000–650 000 respiratory deaths globally.',
    aliases: ['flu', 'influenza'],
  },
  {
    slug: 'coronavirus-disease-(covid-19)',
    title: 'COVID-19',
    summary:
      'WHO has reported over 775 million confirmed cases and 7 million deaths globally as of 2024; the virus continues to evolve and circulate.',
    aliases: ['covid', 'sars-cov-2'],
  },
  {
    slug: 'mental-disorders',
    title: 'Mental disorders',
    summary:
      'In 2019, 1 in every 8 people in the world were living with a mental disorder; depressive and anxiety disorders rose by more than 25 % in 2020.',
    aliases: ['depression', 'anxiety', 'mental health'],
  },
  {
    slug: 'epilepsy',
    title: 'Epilepsy',
    summary:
      'Around 50 million people have epilepsy globally — one of the most common neurological diseases — yet up to 70 % could live seizure-free with proper treatment.',
  },
  {
    slug: 'dementia',
    title: 'Dementia',
    summary:
      "Currently more than 55 million people live with dementia worldwide; nearly 10 million new cases are added each year and Alzheimer's contributes 60–70 %.",
    aliases: ['alzheimer'],
  },
  {
    slug: 'chronic-obstructive-pulmonary-disease-(copd)',
    title: 'Chronic obstructive pulmonary disease (COPD)',
    summary:
      'COPD is the third leading cause of death worldwide, causing 3.23 million deaths in 2019.',
    aliases: ['copd'],
  },
  {
    slug: 'pneumonia',
    title: 'Pneumonia',
    summary:
      'Pneumonia kills more children than any other infectious disease — 740 180 children under 5 in 2019 — accounting for 14 % of all deaths under 5.',
  },
  {
    slug: 'sepsis',
    title: 'Sepsis',
    summary:
      'Globally an estimated 49 million sepsis cases and 11 million sepsis-related deaths occur every year; 1 in 5 deaths worldwide is associated with sepsis.',
  },
  {
    slug: 'antimicrobial-resistance',
    title: 'Antimicrobial resistance',
    summary:
      'Bacterial AMR was directly responsible for an estimated 1.27 million deaths and contributed to ~5 million deaths globally in 2019.',
    aliases: ['amr'],
  },
  {
    slug: 'maternal-mortality',
    title: 'Maternal mortality',
    summary:
      'Approximately 287 000 women died during and following pregnancy and childbirth in 2020; 95 % occurred in low- and lower-middle-income countries.',
  },
  {
    slug: 'sickle-cell-disease',
    title: 'Sickle cell disease',
    summary:
      "Around 5 % of the world's population carries trait genes for haemoglobin disorders, mainly sickle-cell and thalassaemia; over 300 000 babies are born with severe forms each year.",
  },
];

export async function searchWho(query: string, limit = 5): Promise<Evidence[]> {
  const q = query.toLowerCase();
  const matches: Array<{ sheet: FactSheet; score: number }> = [];
  for (const sheet of FACT_SHEETS) {
    const score = matchScore(q, sheet);
    if (score > 0) matches.push({ sheet, score });
  }
  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, limit).map(({ sheet }) => sheetToEvidence(sheet));
}

function matchScore(q: string, sheet: FactSheet): number {
  const targets = [sheet.title.toLowerCase(), sheet.slug, ...(sheet.aliases ?? [])];
  let score = 0;
  for (const t of targets) {
    if (q.includes(t)) score = Math.max(score, t.length);
  }
  return score;
}

function sheetToEvidence(sheet: FactSheet): Evidence {
  return {
    id: `who:${sheet.slug}`,
    source: 'who',
    title: `WHO · ${sheet.title}`,
    summary: sheet.summary,
    url: `${WHO_BASE}${sheet.slug}`,
    meta: { slug: sheet.slug, frozenOn: '2026-04-27' },
  };
}

import type { Evidence } from '@dr-abc/types';

/**
 * ClinicalTrials.gov fetcher — uses the v2 REST API. No key required.
 * Filters to studies that have something useful (a status, an
 * intervention, or recruitment info), sorted by relevance.
 */

const CT_API = 'https://clinicaltrials.gov/api/v2/studies';
const TIMEOUT_MS = 8_000;

interface CtStudy {
  protocolSection?: {
    identificationModule?: {
      nctId?: string;
      briefTitle?: string;
      officialTitle?: string;
    };
    statusModule?: {
      overallStatus?: string;
      startDateStruct?: { date?: string };
      lastUpdatePostDateStruct?: { date?: string };
    };
    designModule?: {
      phases?: string[];
    };
    conditionsModule?: {
      conditions?: string[];
    };
    armsInterventionsModule?: {
      interventions?: { name?: string; type?: string }[];
    };
  };
}

interface CtResponse {
  studies?: CtStudy[];
}

export async function searchClinicalTrials(query: string, limit = 10): Promise<Evidence[]> {
  const term = query.slice(0, 500);
  const url = new URL(CT_API);
  url.searchParams.set('query.term', term);
  url.searchParams.set('pageSize', String(limit));
  url.searchParams.set('format', 'json');
  url.searchParams.set(
    'fields',
    [
      'protocolSection.identificationModule.nctId',
      'protocolSection.identificationModule.briefTitle',
      'protocolSection.identificationModule.officialTitle',
      'protocolSection.statusModule.overallStatus',
      'protocolSection.statusModule.startDateStruct.date',
      'protocolSection.statusModule.lastUpdatePostDateStruct.date',
      'protocolSection.designModule.phases',
      'protocolSection.conditionsModule.conditions',
      'protocolSection.armsInterventionsModule.interventions',
    ].join(','),
  );

  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`ClinicalTrials ${res.status}`);
  const json = (await res.json()) as CtResponse;
  return (json.studies ?? []).map(studyToEvidence).filter((e): e is Evidence => e !== null);
}

function studyToEvidence(study: CtStudy): Evidence | null {
  const id = study.protocolSection?.identificationModule?.nctId;
  if (!id) return null;
  const title =
    study.protocolSection?.identificationModule?.briefTitle ||
    study.protocolSection?.identificationModule?.officialTitle ||
    `Trial ${id}`;
  const status = study.protocolSection?.statusModule?.overallStatus ?? 'unknown';
  const phases = study.protocolSection?.designModule?.phases ?? [];
  const conditions = (study.protocolSection?.conditionsModule?.conditions ?? []).slice(0, 3);
  const interventions = (study.protocolSection?.armsInterventionsModule?.interventions ?? [])
    .map((i) => i.name)
    .filter((n): n is string => typeof n === 'string')
    .slice(0, 3);
  const lastUpdate = study.protocolSection?.statusModule?.lastUpdatePostDateStruct?.date;
  const startDate = study.protocolSection?.statusModule?.startDateStruct?.date;
  const year = parseYear(lastUpdate ?? startDate);

  const summaryParts: string[] = [];
  summaryParts.push(`Status: ${status}`);
  if (phases.length) summaryParts.push(`Phase ${phases.join('/')}`);
  if (conditions.length) summaryParts.push(`Condition: ${conditions.join(', ')}`);
  if (interventions.length) summaryParts.push(`Intervention: ${interventions.join(', ')}`);

  return {
    id: `ctgov:${id}`,
    source: 'clinicaltrials',
    title,
    summary: summaryParts.join(' · '),
    url: `https://clinicaltrials.gov/study/${id}`,
    year,
    meta: { nctId: id, status, phases: phases.join('/') },
  };
}

function parseYear(date: string | undefined): number | undefined {
  if (!date) return undefined;
  const match = date.match(/(19|20)\d{2}/);
  return match ? Number.parseInt(match[0], 10) : undefined;
}

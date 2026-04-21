import { AgentKind } from '@dr-abc/types';
import { SpecialistAgent } from './base.ts';
import { SPECIALTY_PROMPTS } from './prompts.ts';

export class OncologyAgent extends SpecialistAgent {
  readonly kind = AgentKind.Oncology;
  readonly specialtyPrompt = SPECIALTY_PROMPTS.oncology;
}

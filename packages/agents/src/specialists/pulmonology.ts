import { AgentKind } from '@dr-abc/types';
import { SpecialistAgent } from './base.ts';
import { SPECIALTY_PROMPTS } from './prompts.ts';

export class PulmonologyAgent extends SpecialistAgent {
  readonly kind = AgentKind.Pulmonology;
  readonly specialtyPrompt = SPECIALTY_PROMPTS.pulmonology;
}

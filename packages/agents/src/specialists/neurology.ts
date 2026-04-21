import { AgentKind } from '@dr-abc/types';
import { SpecialistAgent } from './base.ts';
import { SPECIALTY_PROMPTS } from './prompts.ts';

export class NeurologyAgent extends SpecialistAgent {
  readonly kind = AgentKind.Neurology;
  readonly specialtyPrompt = SPECIALTY_PROMPTS.neurology;
}

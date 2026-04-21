import { AgentKind } from '@dr-abc/types';
import { SpecialistAgent } from './base.ts';
import { SPECIALTY_PROMPTS } from './prompts.ts';

export class CardiologyAgent extends SpecialistAgent {
  readonly kind = AgentKind.Cardiology;
  readonly specialtyPrompt = SPECIALTY_PROMPTS.cardiology;
}

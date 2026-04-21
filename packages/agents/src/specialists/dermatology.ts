import { AgentKind } from '@dr-abc/types';
import { SpecialistAgent } from './base.ts';
import { SPECIALTY_PROMPTS } from './prompts.ts';

export class DermatologyAgent extends SpecialistAgent {
  readonly kind = AgentKind.Dermatology;
  readonly specialtyPrompt = SPECIALTY_PROMPTS.dermatology;
}

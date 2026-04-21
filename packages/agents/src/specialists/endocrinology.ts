import { AgentKind } from '@dr-abc/types';
import { SpecialistAgent } from './base.ts';
import { SPECIALTY_PROMPTS } from './prompts.ts';

export class EndocrinologyAgent extends SpecialistAgent {
  readonly kind = AgentKind.Endocrinology;
  readonly specialtyPrompt = SPECIALTY_PROMPTS.endocrinology;
}

/**
 * @dr-abc/ui — the Mörbius design system.
 *
 * Bioluminescent medical-noir primitives — composed in
 * `apps/web/` and (eventually) `apps/desktop/`.
 *
 * Composition rule of thumb: if a component knows about agent kinds
 * or orchestrator events, it lives here. If it knows about HTTP / SSE,
 * it stays in apps/web/.
 */
export { cn } from './cn.ts';
// v0.7 audit slice 3 — typography vertical rhythm primitives.
export { Body, Caption, H1, H2, H3, H4 } from './components/typography.tsx';
// v0.7 audit slice 6 — page-level vertical-rhythm wrapper.
export { Section, type SectionProps } from './components/section.tsx';
// v0.7 audit slice 2 — primitives. Replaces the ad-hoc Tailwind-string
// patterns that drifted across multiple files.
export { Modal, type ModalProps } from './components/modal.tsx';
export { Pill, type PillProps, type PillSize, type PillTone } from './components/pill.tsx';
export { Stat, type StatProps } from './components/stat.tsx';
export {
  TextField,
  type TextFieldProps,
  type TextFieldSize,
} from './components/text-field.tsx';
export {
  CLINICAL_TINTS,
  motion,
  palette,
  radius,
  shadow,
  space,
  type,
  zIndex,
  type ClinicalTint,
  type PaletteFamily,
  type PaletteStep,
} from './tokens.ts';
export { AgentBadge, type AgentBadgeProps } from './components/agent-badge.tsx';
export {
  Button,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from './components/button.tsx';
export {
  Card,
  type CardDensity,
  type CardProps,
  type CardTone,
} from './components/card.tsx';
export { ConfidenceBar, type ConfidenceBarProps } from './components/confidence-bar.tsx';
export { ConsultInput, type ConsultInputProps } from './components/input.tsx';
export { EvidenceChip, type EvidenceChipProps } from './components/evidence-chip.tsx';
export { PulseDot, type PulseDotProps } from './components/pulse-dot.tsx';
export { Trace, type TraceProps } from './components/trace.tsx';

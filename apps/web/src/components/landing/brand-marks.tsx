import type { SVGProps } from 'react';

/**
 * BrandMarks — inline monochrome SVGs for the trusted-by marquee.
 *
 * All marks are simplified to their canonical glyph (no full wordmark
 * artwork) so each renders as a single-colour <path> via `currentColor`,
 * keeping the strip uniform across themes (the parent decides the hue).
 * Sources are public — Wikimedia / official press kits / simpleicons.
 *
 * Each export is a React component named after the brand. Add a new
 * mark by appending to this file + adding it to BRAND_MARKS in landing.
 */

type Props = SVGProps<SVGSVGElement> & { title?: string };

function base({ title, children, ...rest }: Props & { children: React.ReactNode }) {
  return (
    <svg
      role="img"
      aria-label={title}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      fill="currentColor"
      {...rest}
    >
      <title>{title}</title>
      {children}
    </svg>
  );
}

export function OpenAIMark(p: Props) {
  return base({
    ...p,
    title: p.title ?? 'OpenAI',
    children: (
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.205 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.142-.08 4.774-2.757a.795.795 0 0 0 .392-.681v-6.737l2.018 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.488 4.493zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.778 2.756a.795.795 0 0 0 .79 0l5.842-3.37v2.33a.072.072 0 0 1-.029.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.787A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.787a4.49 4.49 0 0 1-.676 8.105v-5.677a.79.79 0 0 0-.407-.667zm2.01-3.023-.142-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
    ),
  });
}

export function AnthropicMark(p: Props) {
  return base({
    ...p,
    title: p.title ?? 'Anthropic',
    children: (
      <path d="M13.827 3.52h3.603L24 20.480h-3.603zM6.155 3.52h3.685l6.637 16.96h-3.748L11.378 16.99H4.31l-1.351 3.49H0zm.79 9.87h4.768L9.348 7.155z" />
    ),
  });
}

export function NvidiaMark(p: Props) {
  return base({
    ...p,
    title: p.title ?? 'NVIDIA',
    children: (
      <path d="M8.948 8.798v-1.43a6 6 0 0 1 .424-.018c3.922-.124 6.493 3.374 6.493 3.374s-2.774 3.851-5.75 3.851c-.398 0-.787-.064-1.158-.185v-4.346c1.528.185 1.836.857 2.748 2.385l2.04-1.714s-1.49-1.954-3.997-1.954c-.273 0-.532.018-.8.037m0-4.726v2.138l.424-.027c5.45-.185 9.01 4.47 9.01 4.47s-4.08 4.964-8.33 4.964c-.379 0-.74-.036-1.095-.1v1.323c.3.036.605.064.92.064 3.957 0 6.82-2.022 9.593-4.41.46.37 2.34 1.262 2.728 1.65-2.638 2.21-8.79 3.992-12.26 3.992-.336 0-.66-.018-.978-.054v1.86H24V4.072zm0 10.31v1.13c-3.659-.652-4.674-4.456-4.674-4.456s1.756-1.943 4.674-2.258v1.236h-.006c-1.53-.185-2.732 1.245-2.732 1.245s.677 2.42 2.738 3.103M2.971 10.781s2.165-3.197 6.49-3.526V6.094C4.673 6.475 0 10.527 0 10.527s2.647 7.652 8.948 8.246v-1.227C4.323 16.96 2.971 10.781 2.971 10.781" />
    ),
  });
}

export function HuggingFaceMark(p: Props) {
  return base({
    ...p,
    title: p.title ?? 'Hugging Face',
    children: (
      <path d="M18.92 15.39c-.06-.06-.11-.04-.17-.04-.06 0-.16-.02-.16-.06 0 0-.18.6-.4.95-.21.34-.78 1.04-.94 1.13-.16.1-.31-.04-.31-.04-.18-.13-.16-.27-.07-.4l.04-.04c.13-.13.18-.18.18-.27v-.04c.04-.18.18-.42.27-.55.13-.18.36-.37.54-.55.18-.18.36-.37.54-.55.49-.55.71-1.13.45-1.13-.13 0-.4.18-.7.42-.31.27-.62.62-.85.94-.27.34-.49.7-.62 1.04-.13.34-.18.66-.13.94.06.27.18.55.4.78.21.21.49.4.75.4.27 0 .58-.13.85-.4.27-.27.49-.7.7-1.13.18-.4.36-.78.45-1.13.07-.31.07-.6 0-.79zM6 15.39c.06-.06.11-.04.18-.04.06 0 .16-.02.16-.06 0 0 .18.6.4.95.2.34.78 1.04.94 1.13.16.1.3-.04.3-.04.18-.13.16-.27.07-.4l-.04-.04c-.13-.13-.18-.18-.18-.27v-.04c-.04-.18-.18-.42-.27-.55-.13-.18-.36-.37-.54-.55-.18-.18-.36-.37-.54-.55-.49-.55-.71-1.13-.45-1.13.13 0 .4.18.7.42.31.27.62.62.85.94.27.34.49.7.62 1.04.13.34.18.66.13.94-.06.27-.18.55-.4.78-.21.21-.49.4-.75.4-.27 0-.58-.13-.85-.4-.27-.27-.49-.7-.7-1.13-.18-.4-.36-.78-.45-1.13-.07-.31-.07-.6 0-.79zM12 0C5.37 0 0 5.37 0 12s5.37 12 12 12 12-5.37 12-12S18.63 0 12 0zm-1.5 9.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm3 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM12 18.5c-3 0-5-2-5-5a.5.5 0 0 1 1 0c0 2 1.5 4 4 4s4-2 4-4a.5.5 0 0 1 1 0c0 3-2 5-5 5z" />
    ),
  });
}

export function PyTorchMark(p: Props) {
  return base({
    ...p,
    title: p.title ?? 'PyTorch',
    children: (
      <path d="M12.005 0L4.952 7.053a9.969 9.969 0 0 0 0 14.082c3.882 3.883 10.146 3.883 14.028 0 3.882-3.882 3.882-10.146 0-14.027L17.385 5.51 16.31 6.585l1.65 1.651a8.426 8.426 0 0 1 0 11.927c-3.286 3.287-8.587 3.287-11.873 0-3.287-3.286-3.287-8.587 0-11.873l4.394-4.394 1.523 1.523V0zM15.5 4.665a1.034 1.034 0 1 0 0 2.068 1.034 1.034 0 0 0 0-2.068z" />
    ),
  });
}

export function MonaiMark(p: Props) {
  return base({
    ...p,
    title: p.title ?? 'MONAI',
    children: (
      <>
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M7 13c2-3 5-3 5 0 0 3 3 3 5 0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <circle cx="12" cy="12" r="1.6" />
      </>
    ),
  });
}

export function OllamaMark(p: Props) {
  return base({
    ...p,
    title: p.title ?? 'Ollama',
    children: (
      <path d="M12 2C7.5 2 4 5.5 4 10v6c0 .55.45 1 1 1h2v3a1 1 0 0 0 2 0v-3h6v3a1 1 0 0 0 2 0v-3h2c.55 0 1-.45 1-1v-6c0-4.5-3.5-8-8-8zm-3 7.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM10 14.5h4a1 1 0 0 1 0 2h-4a1 1 0 0 1 0-2z" />
    ),
  });
}

export function PubMedMark(p: Props) {
  return base({
    ...p,
    title: p.title ?? 'PubMed',
    children: (
      <>
        <rect
          x="3"
          y="4"
          width="18"
          height="16"
          rx="2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <path
          d="M7 9h10M7 12h10M7 15h6"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <circle cx="17" cy="15" r="1.6" fill="currentColor" />
      </>
    ),
  });
}

export function FHIRMark(p: Props) {
  return base({
    ...p,
    title: p.title ?? 'FHIR R4',
    children: <path d="M12 2L2 19h20L12 2zm0 4l6 11H6l6-11zm-1 4v3h2v-3h-2zm0 4v2h2v-2h-2z" />,
  });
}

export function SRHMark(p: Props) {
  return base({
    ...p,
    title: p.title ?? 'SRH University Stuttgart',
    children: (
      <>
        <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M8 8h4a2 2 0 0 1 0 4H8zM8 12h6l2 4M16 8v4"
          stroke="currentColor"
          strokeWidth="1.6"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </>
    ),
  });
}

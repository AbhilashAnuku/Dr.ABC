/**
 * MorbiusMark — the unique-look bot face we paint into the floating
 * launcher button (and anywhere else we want a fast non-WebGL avatar).
 *
 * Geometric medical-noir vibe: rounded helmet silhouette in deep ink,
 * a single horizontal cyan visor with a soft scanning bar, twin chin
 * vents, and an animated outer pulse-ring. Pure SVG + CSS — no GPU,
 * no network, no Three.js. Render-cost is a single repaint.
 */

interface Props {
  size?: number;
  /** When true the eye visor pulses faster (chat overlay open). */
  active?: boolean;
  /** When true the visor switches to bio-emerald (mic listening). */
  listening?: boolean;
  /** When true the scan-bar accelerates (Mörbius speaking). */
  speaking?: boolean;
  className?: string;
}

const VISOR_CYAN = '#38bdf8';
const VISOR_EMERALD = '#10b981';
const INK = '#0a1628';
const OUTLINE = 'rgba(56, 189, 248, 0.55)';

export function MorbiusMark({
  size = 32,
  active = false,
  listening = false,
  speaking = false,
  className,
}: Props) {
  const visor = listening ? VISOR_EMERALD : VISOR_CYAN;
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Mörbius"
    >
      <title>Mörbius</title>
      <defs>
        <radialGradient id="mb-halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={visor} stopOpacity="0.55" />
          <stop offset="60%" stopColor={visor} stopOpacity="0.12" />
          <stop offset="100%" stopColor={visor} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="mb-helmet" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#0e1d33" />
          <stop offset="100%" stopColor={INK} />
        </linearGradient>
        <linearGradient id="mb-visor" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={visor} stopOpacity="0.15" />
          <stop offset="50%" stopColor={visor} stopOpacity="1" />
          <stop offset="100%" stopColor={visor} stopOpacity="0.15" />
        </linearGradient>
        <clipPath id="mb-visor-clip">
          <rect x="14" y="26" width="36" height="9" rx="3" />
        </clipPath>
      </defs>

      {/* Outer aura — only when active so the closed launcher stays calm */}
      {active && <circle cx="32" cy="32" r="30" fill="url(#mb-halo)" className="mb-pulse" />}

      {/* Helmet silhouette — rounded keystone with chamfered jaw */}
      <path
        d="M16 12
           C16 6, 22 4, 32 4
           C42 4, 48 6, 48 12
           L48 38
           C48 44, 44 48, 38 50
           L36 56 L28 56 L26 50
           C20 48, 16 44, 16 38
           Z"
        fill="url(#mb-helmet)"
        stroke={OUTLINE}
        strokeWidth="1"
      />

      {/* Antenna nub */}
      <line
        x1="32"
        y1="4"
        x2="32"
        y2="0.5"
        stroke={visor}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle cx="32" cy="0.5" r="1.4" fill={visor} />

      {/* Visor cavity */}
      <rect x="14" y="26" width="36" height="9" rx="3" fill="#020613" />
      <rect x="14" y="26" width="36" height="9" rx="3" fill="url(#mb-visor)" opacity="0.85" />

      {/* Scanning bar inside visor */}
      <g clipPath="url(#mb-visor-clip)">
        <rect
          x="-8"
          y="26"
          width="14"
          height="9"
          fill={visor}
          opacity="0.95"
          className={speaking ? 'mb-scan-fast' : 'mb-scan'}
        />
      </g>

      {/* Pinpoint pupil dots — give the face a focal direction */}
      <circle cx="24" cy="30.5" r="1.4" fill="#e6f7ff" opacity="0.95" />
      <circle cx="40" cy="30.5" r="1.4" fill="#e6f7ff" opacity="0.95" />

      {/* Twin chin vents */}
      <rect x="26" y="42" width="3" height="5" rx="1" fill={visor} opacity="0.55" />
      <rect x="35" y="42" width="3" height="5" rx="1" fill={visor} opacity="0.55" />

      {/* Cheek ridges */}
      <path
        d="M16 30 L13 34 M48 30 L51 34"
        stroke={OUTLINE}
        strokeWidth="0.8"
        strokeLinecap="round"
      />

      <style>{`
        .mb-pulse {
          transform-origin: 32px 32px;
          animation: mb-pulse 1.8s ease-out infinite;
        }
        @keyframes mb-pulse {
          0%   { opacity: 0.85; transform: scale(0.85); }
          70%  { opacity: 0.18; transform: scale(1.1); }
          100% { opacity: 0;    transform: scale(1.18); }
        }
        .mb-scan {
          animation: mb-scan 3.2s linear infinite;
        }
        .mb-scan-fast {
          animation: mb-scan 0.8s linear infinite;
        }
        @keyframes mb-scan {
          0%   { transform: translateX(0); }
          100% { transform: translateX(58px); }
        }
      `}</style>
    </svg>
  );
}

import { Canvas, useFrame } from '@react-three/fiber';
import { Mic, Pause, Play, X as XIcon } from 'lucide-react';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { MORBIUS_QA, type QaEntry, findAnswer } from '../lib/morbius-qa.ts';
import { isMorbiusSpeaking, speakWithProsody } from '../lib/voice.ts';

/**
 * MorbiusFullscreen — Mörbius cinema-mode immersive overlay.
 *
 * A full-screen speaking mode: particles drifting in a void with
 * cuboids and shapes slowly shifting and wobbling, lit by purple,
 * blue, white, and dark glows.
 *
 * Composition:
 *   · Full-viewport dark void with aurora gradient backdrop
 *   · 600 drifting particles in 3D space (Three.js · GPU-accelerated)
 *   · 4 translucent wobbling cuboids slowly rotating around centre
 *   · Centre pulsing core that scales with TTS audio (voice-reactive)
 *   · Two counter-rotating glow rings (purple + blue)
 *   · 15 defense-Q&A chips along the bottom
 *   · Close button (top-right) + ESC + click-outside-to-dismiss
 *
 * Triggered from <MorbiusIntroCard>'s "Mörbius · cinema mode" button
 * via createPortal to document.body (escapes Card's transform-trap).
 */

const INTRO_TEXT =
  "I am Mörbius. A sovereign multi-agent medical AI built for the architect's subject K-2472 at SRH University Stuttgart. Five brains run in parallel inside me — retrieval, agentic reasoning, medical knowledge, persistent memory, and self-learning. My base model is Llama 3.3 70 billion Instruct. My Secure Pass, safety floor, and Mörbius Secure Protocol guarantee that my single stated goal — save at least one human life — overrides any confidence calculation. Ask me anything.";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function MorbiusFullscreen({ open, onClose }: Props) {
  const [state, setState] = useState<'idle' | 'speaking'>('idle');
  const [shownText, setShownText] = useState('');
  const [activeQA, setActiveQA] = useState<QaEntry | null>(null);
  const [askInput, setAskInput] = useState('');
  const [audioLevel, setAudioLevel] = useState(0); // 0..1, drives the core scale
  const speakSeqRef = useRef(0);

  // Track audio level in a ref so the typing tick can read it without
  // re-creating the timer chain each frame. The state version triggers
  // the visual reactivity; the ref is the same number for the streamer.
  const audioLevelRef = useRef(0);
  audioLevelRef.current = audioLevel;

  // Stream text in pace with the spoken cadence. The streaming rate
  // adapts to audio amplitude — when Mörbius is mid-syllable (high
  // amplitude), 2 chars per tick land; between words (low amplitude),
  // 1 char. Keeps the typing accurately in step with the talking tone.
  // Effective cadence ≈ 60-90 words/min, matching the warm-doctor TTS
  // rate. Cancels cleanly via the sequence id.
  const streamText = useMemo(
    () => (text: string, seq: number) => {
      setShownText('');
      let i = 0;
      const tick = () => {
        if (seq !== speakSeqRef.current) return;
        // Charsper tick = 1 at quiet, 2 at speaking peak. Interval = 22ms
        // base, scaled to 32ms when audio is low (typing slows between
        // words to match the speaker's natural pause).
        const amp = audioLevelRef.current;
        const charsPerTick = amp > 0.45 ? 2 : 1;
        const intervalMs = amp > 0.45 ? 22 : 34;
        i += charsPerTick;
        setShownText(text.slice(0, i));
        if (i < text.length) {
          window.setTimeout(tick, intervalMs);
        }
      };
      tick();
    },
    [],
  );

  // Animate the audioLevel ref while speaking — proxies for real audio
  // amplitude since browser SpeechSynthesis doesn't expose a buffer.
  // We sample isMorbiusSpeaking() at 30 Hz and modulate a sine wave.
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    let t = 0;
    const tick = () => {
      t += 0.05;
      const speaking = isMorbiusSpeaking();
      if (speaking) {
        const base = 0.5 + Math.sin(t * 7) * 0.18 + Math.sin(t * 11) * 0.1;
        setAudioLevel(Math.max(0, Math.min(1, base + Math.random() * 0.08)));
      } else {
        setAudioLevel((a) => a * 0.92); // decay
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const launch = () => {
    if (typeof window === 'undefined') return;
    const seq = ++speakSeqRef.current;
    setState('speaking');
    setActiveQA(null);
    streamText(INTRO_TEXT, seq);
    speakWithProsody(INTRO_TEXT, { lang: 'en-US' });
    const poll = window.setInterval(() => {
      if (seq !== speakSeqRef.current) {
        window.clearInterval(poll);
        return;
      }
      if (!isMorbiusSpeaking()) {
        window.clearInterval(poll);
        setState((s) => (s === 'speaking' ? 'idle' : s));
      }
    }, 400);
  };

  const speakQA = (qa: QaEntry) => {
    const seq = ++speakSeqRef.current;
    setState('speaking');
    setActiveQA(qa);
    streamText(qa.a, seq);
    speakWithProsody(qa.a, { lang: 'en-US' });
    const poll = window.setInterval(() => {
      if (seq !== speakSeqRef.current) {
        window.clearInterval(poll);
        return;
      }
      if (!isMorbiusSpeaking()) {
        window.clearInterval(poll);
        setState((s) => (s === 'speaking' ? 'idle' : s));
      }
    }, 400);
  };

  const stop = () => {
    speakSeqRef.current++;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setState('idle');
  };

  const ask = (e: React.FormEvent) => {
    e.preventDefault();
    const q = askInput.trim();
    if (!q) return;
    const match = findAnswer(q);
    speakQA(
      match ?? {
        id: 'fallback',
        q,
        a: "That's a question I do not have a pre-canned answer for. Try one of the chips below — what is Mörbius, why multi-agent, why local-first, accuracy, bias, or safety.",
        keys: [],
      },
    );
    setAskInput('');
  };

  // ESC + click-outside dismiss
  // biome-ignore lint/correctness/useExhaustiveDependencies: stop() is a stable closure over speakSeqRef
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stop();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Cancel speech on close
  // biome-ignore lint/correctness/useExhaustiveDependencies: stop() is a stable closure
  useEffect(() => {
    if (!open) {
      stop();
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black/95 backdrop-blur-sm">
      {/* Aurora backdrop · purple → blue → black */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 50% 40%, rgba(139, 92, 246, 0.32) 0%, rgba(59, 130, 246, 0.18) 40%, transparent 75%), radial-gradient(ellipse 60% 50% at 30% 80%, rgba(168, 85, 247, 0.22) 0%, transparent 60%), radial-gradient(ellipse 70% 50% at 70% 20%, rgba(34, 211, 238, 0.16) 0%, transparent 60%)',
        }}
      />

      {/* 3D scene · particles + wobbling cuboids */}
      <div className="absolute inset-0">
        <Suspense fallback={null}>
          <Canvas camera={{ position: [0, 0, 6], fov: 50 }} dpr={[1, 2]}>
            <ambientLight intensity={0.3} />
            <pointLight position={[0, 0, 4]} intensity={1.4} color="#a78bfa" />
            <pointLight position={[3, 2, 0]} intensity={0.9} color="#60a5fa" />
            <pointLight position={[-3, -2, 0]} intensity={0.7} color="#22d3ee" />
            <ParticleField count={600} />
            <WobblingCuboid position={[0, 0, 0]} size={1.2} color="#a78bfa" speed={0.4} />
            <WobblingCuboid position={[2.4, 1.2, -1]} size={0.6} color="#60a5fa" speed={0.6} />
            <WobblingCuboid position={[-2.4, -1.2, -1]} size={0.7} color="#c084fc" speed={0.5} />
            <WobblingCuboid position={[1.6, -1.6, -2]} size={0.4} color="#22d3ee" speed={0.7} />
            <CoreOrb audioLevel={audioLevel} />
            {/* Particle-and-waveform shape that bounces with the voice.
                Two concentric audio-reactive waveform rings drawn around
                the core — the inner one pulses tight to the syllable
                cadence, the outer one swells/contracts on word
                boundaries. Both fade out when audio is silent. */}
            <AudioWaveformRing
              radius={1.7}
              segments={144}
              audioLevel={audioLevel}
              color="#c4b5fd"
              speed={1.0}
              amplitudeScale={0.35}
            />
            <AudioWaveformRing
              radius={2.15}
              segments={96}
              audioLevel={audioLevel}
              color="#60a5fa"
              speed={-0.7}
              amplitudeScale={0.22}
            />
          </Canvas>
        </Suspense>
      </div>

      {/* Top bar · close + state */}
      <header className="relative z-10 flex items-center justify-between px-6 py-5 sm:px-10 sm:py-7">
        <div className="inline-flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.42em] text-purple-200">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${state === 'speaking' ? 'animate-pulse bg-bio-400' : 'bg-purple-400'}`}
          />
          {state === 'speaking' ? 'Mörbius speaking' : 'Mörbius standing by'}
        </div>
        <button
          type="button"
          onClick={() => {
            stop();
            onClose();
          }}
          aria-label="Close fullscreen"
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-purple-400/30 bg-purple-500/10 text-purple-200 backdrop-blur-md transition hover:bg-purple-500/20"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </header>

      {/* Centre · text reveal + active question */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 sm:px-12">
        {state === 'idle' && !shownText && (
          <>
            <div className="mb-6 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.5em] text-purple-300">
              meet · live ai introduction
            </div>
            {/* Highlights Mörbius with a rounded play button. Headline
                reads "I am Mörbius." with the brand name carrying the
                gradient + a soft halo behind it. The rounded play button
                below replaces the old text-pill — bigger, circular,
                glowing. */}
            <h1
              className="text-center font-syne font-black tracking-[-0.03em] text-app-primary"
              style={{ fontSize: 'clamp(2.5rem, 7vw, 5rem)', lineHeight: 1 }}
            >
              <span className="block opacity-90">I am</span>
              <span className="relative mt-1 inline-block">
                <span
                  aria-hidden="true"
                  className="absolute inset-0 -z-10 mx-auto block rounded-full bg-purple-500/30 blur-3xl"
                />
                <span className="bg-gradient-to-br from-white via-purple-200 to-blue-300 bg-clip-text px-2 text-transparent drop-shadow-[0_0_80px_rgba(139,92,246,0.7)]">
                  Mörbius.
                </span>
              </span>
            </h1>
            <p
              className="mt-6 max-w-2xl text-center font-grotesk text-app-secondary"
              style={{ fontSize: 'clamp(1rem, 1.6vw, 1.25rem)' }}
            >
              Press play — Mörbius reads a 30-second self-introduction through your speakers. Then
              ask anything; fifteen pre-rehearsed defence answers wired in.
            </p>
            {/* Rounded circular play button · YouTube-style · the glow
                pulse below sells the "press me" affordance. */}
            <button
              type="button"
              onClick={launch}
              aria-label="Launch introduction"
              className="group relative mt-10 inline-flex h-24 w-24 items-center justify-center rounded-full border-2 border-purple-300/70 bg-gradient-to-br from-purple-500/40 via-purple-500/30 to-blue-500/40 text-purple-50 shadow-[0_0_80px_-10px_rgba(139,92,246,0.8)] backdrop-blur-xl transition-transform hover:scale-110 hover:from-purple-500/60 hover:to-blue-500/60 sm:h-28 sm:w-28"
            >
              {/* Triple breathing rings · pure CSS · sells the "live" feel */}
              <span
                aria-hidden="true"
                className="absolute inset-0 animate-ping rounded-full border border-purple-400/60"
                style={{ animationDuration: '2.4s' }}
              />
              <span
                aria-hidden="true"
                className="absolute -inset-3 rounded-full border border-purple-400/30"
                style={{ animation: 'ping 3.2s cubic-bezier(0,0,0.2,1) infinite' }}
              />
              <Play
                className="ml-1 h-10 w-10 transition-transform group-hover:scale-110 sm:h-12 sm:w-12"
                strokeWidth={1.5}
                fill="currentColor"
              />
            </button>
            <span className="mt-3 font-mono text-[10px] uppercase tracking-[0.4em] text-purple-200/80">
              press play · introduce yourself
            </span>
          </>
        )}

        {(state === 'speaking' || shownText) && (
          <div className="mx-auto w-full max-w-3xl">
            {activeQA && (
              <h2
                className="mb-6 text-center font-syne font-bold text-purple-200"
                style={{ fontSize: 'clamp(1.4rem, 3vw, 2.2rem)' }}
              >
                {activeQA.q}
              </h2>
            )}
            <p
              className="min-h-[10rem] text-center font-grotesk leading-relaxed text-app-primary"
              style={{ fontSize: 'clamp(1rem, 1.6vw, 1.4rem)' }}
            >
              {shownText || ' '}
            </p>
            {state === 'speaking' && (
              <div className="mt-6 flex justify-center">
                <button
                  type="button"
                  onClick={stop}
                  className="inline-flex items-center gap-2 rounded-full border border-rose-400/40 bg-rose-500/15 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.32em] text-rose-200 hover:bg-rose-500/25"
                >
                  <Pause className="h-3.5 w-3.5" /> stop
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Bottom · Q&A chips + ask box */}
      <footer className="relative z-10 px-6 py-6 sm:px-10 sm:py-8">
        <div className="mx-auto max-w-5xl">
          <div className="mb-3 text-center font-mono text-[10px] uppercase tracking-[0.42em] text-app-faint">
            defense Q&A · 15 pre-rehearsed answers · click to play
          </div>
          <div className="mb-4 flex flex-wrap justify-center gap-1.5">
            {MORBIUS_QA.map((qa) => (
              <button
                key={qa.id}
                type="button"
                onClick={() => speakQA(qa)}
                className={`inline-flex items-center rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] transition ${
                  activeQA?.id === qa.id
                    ? 'border-bio-400/60 bg-bio-500/20 text-bio-100'
                    : 'border-purple-400/30 bg-purple-500/10 text-purple-200 hover:border-purple-400/60 hover:bg-purple-500/20'
                }`}
                title={qa.q}
              >
                {qa.q.length > 36 ? `${qa.q.slice(0, 34)}…` : qa.q}
              </button>
            ))}
          </div>
          <form
            onSubmit={ask}
            className="mx-auto flex max-w-2xl items-center gap-2 rounded-full border border-purple-400/30 bg-black/60 px-4 py-2 backdrop-blur-xl"
          >
            <Mic className="h-4 w-4 text-purple-300" aria-hidden="true" />
            <input
              value={askInput}
              onChange={(e) => setAskInput(e.target.value)}
              placeholder="ask anything · e.g., why local-first?"
              className="flex-1 bg-transparent font-grotesk text-sm text-app-primary placeholder:text-app-faint focus:outline-none"
            />
            <button
              type="submit"
              className="inline-flex items-center rounded-full border border-purple-400/40 bg-purple-500/20 px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.32em] text-purple-100 hover:bg-purple-500/30"
            >
              ask
            </button>
          </form>
        </div>
      </footer>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
//  3D scene primitives
// ────────────────────────────────────────────────────────────────────

function ParticleField({ count }: { count: number }) {
  const ref = useRef<THREE.Points>(null);
  // Pre-compute particle positions once · they drift via shader-less
  // per-frame Y-offset modulation to keep the scene cheap.
  const { positions, velocities } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 14;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 10;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 10 - 2;
      vel[i * 3] = (Math.random() - 0.5) * 0.001;
      vel[i * 3 + 1] = Math.random() * 0.002 + 0.0005;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.001;
    }
    return { positions: pos, velocities: vel };
  }, [count]);

  useFrame(() => {
    const points = ref.current;
    if (!points) return;
    const attr = points.geometry.attributes.position as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const ix = i * 3;
      const iy = ix + 1;
      const iz = ix + 2;
      const vx = velocities[ix];
      const vy = velocities[iy];
      const vz = velocities[iz];
      const ax = arr[ix];
      const ay = arr[iy];
      const az = arr[iz];
      if (
        vx === undefined ||
        vy === undefined ||
        vz === undefined ||
        ax === undefined ||
        ay === undefined ||
        az === undefined
      ) {
        continue;
      }
      arr[ix] = ax + vx;
      arr[iy] = ay + vy;
      arr[iz] = az + vz;
      // Wrap when particles drift out of the viewport
      const newY = arr[iy] ?? 0;
      if (newY > 6) arr[iy] = -6;
      if (newY < -6) arr[iy] = 6;
    }
    attr.needsUpdate = true;
    points.rotation.y += 0.0008;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={positions}
          itemSize={3}
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.04}
        color="#a78bfa"
        transparent
        opacity={0.7}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

function WobblingCuboid({
  position,
  size,
  color,
  speed,
}: {
  position: [number, number, number];
  size: number;
  color: string;
  speed: number;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const t0 = useMemo(() => Math.random() * Math.PI * 2, []);
  useFrame((state) => {
    const m = ref.current;
    if (!m) return;
    const t = state.clock.elapsedTime * speed + t0;
    m.rotation.x = t * 0.4;
    m.rotation.y = t * 0.3;
    m.rotation.z = Math.sin(t * 0.5) * 0.2;
    m.position.x = position[0] + Math.sin(t * 0.7) * 0.2;
    m.position.y = position[1] + Math.cos(t * 0.5) * 0.15;
    m.position.z = position[2] + Math.sin(t * 0.4) * 0.2;
  });
  return (
    <mesh ref={ref} position={position}>
      <boxGeometry args={[size, size, size]} />
      <meshPhysicalMaterial
        color={color}
        transparent
        opacity={0.18}
        roughness={0.05}
        metalness={0.2}
        transmission={0.85}
        thickness={0.6}
        clearcoat={1}
        clearcoatRoughness={0.1}
        ior={1.4}
      />
    </mesh>
  );
}

function CoreOrb({ audioLevel }: { audioLevel: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const ring2Ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (ref.current) {
      const scale = 1 + audioLevel * 0.25 + Math.sin(t * 1.2) * 0.04;
      ref.current.scale.setScalar(scale);
      ref.current.rotation.y = t * 0.3;
      ref.current.rotation.x = Math.sin(t * 0.4) * 0.15;
    }
    if (ringRef.current) {
      ringRef.current.rotation.z = t * 0.4;
      ringRef.current.rotation.x = t * 0.2;
    }
    if (ring2Ref.current) {
      ring2Ref.current.rotation.z = -t * 0.3;
      ring2Ref.current.rotation.y = t * 0.25;
    }
  });
  return (
    <group>
      {/* Inner glow sphere */}
      <mesh ref={ref}>
        <icosahedronGeometry args={[0.7, 1]} />
        <meshPhysicalMaterial
          color="#c4b5fd"
          emissive="#a78bfa"
          emissiveIntensity={0.8 + audioLevel * 0.6}
          transparent
          opacity={0.9}
          roughness={0.1}
          metalness={0.3}
          transmission={0.4}
        />
      </mesh>
      {/* Outer rotating rings */}
      <mesh ref={ringRef}>
        <torusGeometry args={[1.1, 0.014, 16, 100]} />
        <meshBasicMaterial color="#a78bfa" transparent opacity={0.6} />
      </mesh>
      <mesh ref={ring2Ref}>
        <torusGeometry args={[1.35, 0.01, 16, 100]} />
        <meshBasicMaterial color="#60a5fa" transparent opacity={0.5} />
      </mesh>
    </group>
  );
}

/**
 * AudioWaveformRing — a polar waveform that bounces with TTS amplitude.
 *
 * Draws a closed line loop around the origin where each vertex's radius
 * is modulated by a sum of sine waves. The amplitude scales with the
 * incoming audioLevel (0..1) so the ring SITS as a thin circle when
 * Mörbius is silent and SWELLS into a bouncing wave when speaking.
 *
 * Two of these are stacked at different radii in the scene; opposite
 * rotation speeds give the visual the "two waves crossing" feel of a
 * spectrum analyser without needing a real FFT buffer.
 */
function AudioWaveformRing({
  radius,
  segments,
  audioLevel,
  color,
  speed,
  amplitudeScale,
}: {
  radius: number;
  segments: number;
  audioLevel: number;
  color: string;
  speed: number;
  amplitudeScale: number;
}) {
  const positions = useMemo(() => new Float32Array((segments + 1) * 3), [segments]);
  const lineObj = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const m = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
    });
    const l = new THREE.LineLoop(g, m);
    return l;
  }, [positions, color]);

  useFrame((state) => {
    const t = state.clock.elapsedTime * speed;
    // Ring opacity tracks the audioLevel · stays visible at idle so the
    // viewer always sees the circle, but really glows when speaking.
    const mat = lineObj.material as THREE.LineBasicMaterial;
    mat.opacity = 0.25 + audioLevel * 0.7;
    const baseR = radius;
    const amp = audioLevel * amplitudeScale + 0.015; // tiny resting amplitude
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      // Layered sines simulate a real-ish spectrum without an FFT.
      const wave =
        Math.sin(theta * 7 + t * 2.4) * 0.55 +
        Math.sin(theta * 13 + t * 1.6) * 0.32 +
        Math.sin(theta * 23 + t * 3.1) * 0.18;
      const r = baseR + wave * amp;
      positions[i * 3] = Math.cos(theta) * r;
      positions[i * 3 + 1] = Math.sin(theta) * r;
      positions[i * 3 + 2] = 0;
    }
    const attr = lineObj.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
    lineObj.rotation.z = t * 0.1;
  });

  return <primitive object={lineObj} />;
}

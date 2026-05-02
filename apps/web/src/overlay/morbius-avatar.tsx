import { useAnimations, useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import type * as THREE from 'three';
import { DEFAULT_AVATAR_URL } from '../lib/config.ts';
import { getMouthAmplitude } from '../lib/voice.ts';
import { MorbiusFace } from './morbius-face.tsx';

/**
 * Mörbius avatar — REAL 3D humanoid robot rendered in WebGL.
 *
 * Default: Khronos RobotExpressive (rigged humanoid with built-in
 * idle / walk / dance / wave animations). The component plays Idle
 * by default, switches to a more active animation when speaking,
 * and drives any mouth-related morph targets if the model has them
 * (ReadyPlayerMe avatars work out of the box for lip sync).
 *
 * Users can paste any glTF URL (RPM / Sketchfab download / custom)
 * via Settings; falls back to procedural orb only on load failure.
 */

const LS_KEY = 'dr-abc:avatar-glb-url';

export function readAvatarUrl(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(LS_KEY) ?? '';
}

export function writeAvatarUrl(url: string): void {
  if (typeof window === 'undefined') return;
  if (url) window.localStorage.setItem(LS_KEY, url);
  else window.localStorage.removeItem(LS_KEY);
}

interface AvatarProps {
  speaking: boolean;
  listening: boolean;
  /** Optional override; otherwise reads from localStorage / default. */
  glbUrl?: string;
  /** Auto-rotate the model around Y. Default true. */
  autoRotate?: boolean;
}

export function MorbiusAvatar({ speaking, listening, glbUrl, autoRotate = true }: AvatarProps) {
  // Resolution order: explicit prop → user-saved URL → default.
  // CRITICAL: only invoke useGLTF when we actually have a URL. Calling
  // `useGLTF('')` resolves to the current page URL which returns HTML
  // and crashes the GLTFLoader with "Unexpected token '<'", taking down
  // the whole page. The procedural MorbiusFace is the V0 default — no
  // network, no GPU stalls.
  const url = (glbUrl ?? readAvatarUrl()) || DEFAULT_AVATAR_URL;
  if (!url) {
    return <MorbiusFace speaking={speaking} listening={listening} />;
  }
  return (
    <Suspense fallback={<MorbiusFace speaking={speaking} listening={listening} />}>
      <GltfHead url={url} speaking={speaking} listening={listening} autoRotate={autoRotate} />
    </Suspense>
  );
}

function GltfHead({
  url,
  speaking,
  listening,
  autoRotate,
}: {
  url: string;
  speaking: boolean;
  listening: boolean;
  autoRotate: boolean;
}) {
  const { scene, animations } = useGLTF(url);
  const groupRef = useRef<THREE.Group | null>(null);
  const morphTargets = useRef<Array<{ mesh: THREE.Mesh; index: number }>>([]);
  const ambient = useMemo(() => ({ x: 0, y: 0, t: 0 }), []);
  const { actions, names } = useAnimations(animations, groupRef);

  // Discover any mouth-related morph targets on first mount
  useEffect(() => {
    morphTargets.current = [];
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      const dict = mesh.morphTargetDictionary;
      if (!dict || !mesh.morphTargetInfluences) return;
      for (const name of [
        'mouthOpen',
        'jawOpen',
        'mouth_open',
        'viseme_O',
        'viseme_aa',
        'jawForward',
      ]) {
        const idx = dict[name];
        if (idx !== undefined) morphTargets.current.push({ mesh, index: idx });
      }
    });
  }, [scene]);

  // Pick + play an animation. RobotExpressive has Idle / Walking / Running /
  // Dance / Death / Wave / Yes / No / Punch / ThumbsUp / Sitting / Standing.
  // ReadyPlayerMe avatars usually have just an Idle.
  useEffect(() => {
    if (!names.length) return;
    const idleName =
      names.find((n) => /idle/i.test(n)) ?? names.find((n) => /stand/i.test(n)) ?? names[0];
    const speakingName = names.find((n) => /wave|yes|talk/i.test(n)) ?? idleName;
    const target = speaking ? speakingName : idleName;
    if (!target) return;
    const action = actions[target];
    if (!action) return;
    for (const a of Object.values(actions)) {
      if (a && a !== action) a.fadeOut(0.4);
    }
    action.reset().fadeIn(0.4).play();
    return () => {
      action.fadeOut(0.4);
    };
  }, [actions, names, speaking]);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;

    // Auto-rotate slowly
    if (autoRotate && groupRef.current) {
      groupRef.current.rotation.y += dt * 0.25;
    }

    // Soft head sway on top of rotation (additive bob)
    if (t > ambient.t) {
      ambient.x = (Math.random() - 0.5) * 0.04;
      ambient.y = (Math.random() - 0.5) * 0.02;
      ambient.t = t + 2 + Math.random() * 2;
    }

    // Drive morphs — TTS amplitude is the truth signal; the
    // free-running oscillator is the offline fallback.
    const ttsAmp = getMouthAmplitude();
    const target =
      ttsAmp > 0.02
        ? 0.15 + ttsAmp * 0.85
        : speaking
          ? 0.45 + Math.abs(Math.sin(t * 16)) * 0.4
          : 0.0;
    for (const m of morphTargets.current) {
      const cur = m.mesh.morphTargetInfluences?.[m.index] ?? 0;
      if (m.mesh.morphTargetInfluences) {
        m.mesh.morphTargetInfluences[m.index] = cur * 0.6 + target * 0.4;
      }
    }

    // Listening tint — pulse emissive on standard materials
    const emissiveTarget = listening ? 0.18 : speaking ? 0.25 : 0;
    const tintHex = listening ? 0x10b981 : 0x38bdf8;
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
      if (mat?.emissive) {
        mat.emissive.setHex(tintHex);
        mat.emissiveIntensity = mat.emissiveIntensity * 0.85 + emissiveTarget * 0.15;
      }
    });
  });

  // Scale + position chosen for the typical viewport — RobotExpressive
  // is ~1m tall in glTF units; we scale 0.85 and lower to fit the
  // camera framed at fov 38, position [0,0,3].
  return (
    <group ref={groupRef} position={[0, -1.0, 0]} scale={0.85}>
      <primitive object={scene} />
    </group>
  );
}

// Preload so the first paint is instant on subsequent navigations
// (only when a real URL is configured — empty default uses the procedural face)
if (DEFAULT_AVATAR_URL) {
  useGLTF.preload(DEFAULT_AVATAR_URL);
}

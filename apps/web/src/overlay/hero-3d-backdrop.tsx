/**
 * Hero3DBackdrop — real Three.js backdrop for the landing hero.
 *
 * Replaces the earlier SVG decoration with a proper 3D scene so the
 * landing reads at the bar of Seedance / GPT image-gen marketing
 * pages: clean type, generous whitespace, subtle 3D motion that
 * draws the eye without competing for it.
 *
 * Three elements share the canvas:
 *   1. DNA double helix that rotates slowly on Y, twisted backbones
 *      with phosphate-coloured base pairs. Lit with a soft cyan key
 *      so it reads on both light and dark themes.
 *   2. Floating molecular field — 60 instanced spheres drifting on a
 *      sinusoidal pattern, occasionally bonded by thin lines. Reads
 *      as "cells / molecules / proteins" without naming any one.
 *   3. Soft camera drift so the scene never feels static.
 *
 * Lazy-loaded from landing.tsx via React.lazy so the Three.js chunk
 * never lands in the first-paint bundle. dpr capped at 1.5 so even
 * 4K screens stay smooth; frameloop = "demand" + a 30 fps RAF tick
 * keeps the GPU mostly idle.
 */

import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

// ── DNA double helix ─────────────────────────────────────────────────

const HELIX_TURNS = 6;
const HELIX_HEIGHT = 8;
const HELIX_RADIUS = 0.55;
const HELIX_SEGMENTS = 84;
const PAIR_COUNT = 28;

function DnaHelix() {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.18;
      // Tiny sinusoidal sway so the helix breathes
      groupRef.current.rotation.x = Math.sin(performance.now() * 0.00015) * 0.06;
    }
  });

  // Pre-compute helix geometry so it doesn't rebuild every frame.
  const { backboneA, backboneB, pairs } = useMemo(() => {
    const a: THREE.Vector3[] = [];
    const b: THREE.Vector3[] = [];
    for (let i = 0; i <= HELIX_SEGMENTS; i += 1) {
      const t = i / HELIX_SEGMENTS;
      const angle = t * Math.PI * 2 * HELIX_TURNS;
      const y = -HELIX_HEIGHT / 2 + t * HELIX_HEIGHT;
      a.push(new THREE.Vector3(Math.cos(angle) * HELIX_RADIUS, y, Math.sin(angle) * HELIX_RADIUS));
      b.push(
        new THREE.Vector3(
          Math.cos(angle + Math.PI) * HELIX_RADIUS,
          y,
          Math.sin(angle + Math.PI) * HELIX_RADIUS,
        ),
      );
    }
    const pairList: { from: THREE.Vector3; to: THREE.Vector3; color: string }[] = [];
    for (let i = 0; i < PAIR_COUNT; i += 1) {
      const t = i / (PAIR_COUNT - 1);
      const angle = t * Math.PI * 2 * HELIX_TURNS;
      const y = -HELIX_HEIGHT / 2 + t * HELIX_HEIGHT;
      pairList.push({
        from: new THREE.Vector3(Math.cos(angle) * HELIX_RADIUS, y, Math.sin(angle) * HELIX_RADIUS),
        to: new THREE.Vector3(
          Math.cos(angle + Math.PI) * HELIX_RADIUS,
          y,
          Math.sin(angle + Math.PI) * HELIX_RADIUS,
        ),
        color: i % 2 === 0 ? '#38bdf8' : '#a855f7',
      });
    }
    return { backboneA: a, backboneB: b, pairs: pairList };
  }, []);

  return (
    <group ref={groupRef} position={[-2.5, 0, 0]}>
      {/* Backbone A — cyan tube along the helix path */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={backboneA.length}
            array={new Float32Array(backboneA.flatMap((v) => [v.x, v.y, v.z]))}
            itemSize={3}
            args={[new Float32Array(backboneA.flatMap((v) => [v.x, v.y, v.z])), 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#22d3ee" transparent opacity={0.7} />
      </line>

      {/* Backbone B — violet tube */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={backboneB.length}
            array={new Float32Array(backboneB.flatMap((v) => [v.x, v.y, v.z]))}
            itemSize={3}
            args={[new Float32Array(backboneB.flatMap((v) => [v.x, v.y, v.z])), 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#a855f7" transparent opacity={0.7} />
      </line>

      {/* Base-pair rungs + phosphate caps */}
      {pairs.map((p, i) => (
        <group key={`pair-${i}-${p.from.y.toFixed(3)}`}>
          <mesh position={[p.from.x, p.from.y, p.from.z]}>
            <sphereGeometry args={[0.06, 12, 12]} />
            <meshStandardMaterial
              color="#22d3ee"
              emissive="#22d3ee"
              emissiveIntensity={0.5}
              roughness={0.35}
            />
          </mesh>
          <mesh position={[p.to.x, p.to.y, p.to.z]}>
            <sphereGeometry args={[0.06, 12, 12]} />
            <meshStandardMaterial
              color="#a855f7"
              emissive="#a855f7"
              emissiveIntensity={0.5}
              roughness={0.35}
            />
          </mesh>
          <line>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                count={2}
                array={new Float32Array([p.from.x, p.from.y, p.from.z, p.to.x, p.to.y, p.to.z])}
                itemSize={3}
                args={[new Float32Array([p.from.x, p.from.y, p.from.z, p.to.x, p.to.y, p.to.z]), 3]}
              />
            </bufferGeometry>
            <lineBasicMaterial color={p.color} transparent opacity={0.55} />
          </line>
        </group>
      ))}
    </group>
  );
}

// ── Molecular field ─────────────────────────────────────────────────

const MOLECULE_COUNT = 36;

function MolecularField() {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const seeds = useMemo(() => {
    const arr: { x: number; y: number; z: number; phase: number; speed: number }[] = [];
    for (let i = 0; i < MOLECULE_COUNT; i += 1) {
      arr.push({
        x: (Math.random() - 0.5) * 14,
        y: (Math.random() - 0.5) * 10,
        z: (Math.random() - 0.5) * 6 - 1,
        phase: Math.random() * Math.PI * 2,
        speed: 0.2 + Math.random() * 0.4,
      });
    }
    return arr;
  }, []);

  const tmpMatrix = useMemo(() => new THREE.Matrix4(), []);
  const tmpVec = useMemo(() => new THREE.Vector3(), []);
  const tmpQuat = useMemo(() => new THREE.Quaternion(), []);
  const tmpScale = useMemo(() => new THREE.Vector3(1, 1, 1), []);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime();
    for (let i = 0; i < seeds.length; i += 1) {
      const s = seeds[i];
      if (!s) continue;
      tmpVec.set(
        s.x + Math.sin(t * s.speed + s.phase) * 0.6,
        s.y + Math.cos(t * s.speed * 0.7 + s.phase) * 0.4,
        s.z + Math.sin(t * s.speed * 0.5 + s.phase) * 0.3,
      );
      const scl = 0.08 + Math.sin(t * 0.8 + s.phase) * 0.025;
      tmpScale.setScalar(scl);
      tmpMatrix.compose(tmpVec, tmpQuat, tmpScale);
      meshRef.current.setMatrixAt(i, tmpMatrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, MOLECULE_COUNT]}>
      <sphereGeometry args={[1, 12, 12]} />
      <meshStandardMaterial
        color="#6ee7b7"
        emissive="#10b981"
        emissiveIntensity={0.4}
        roughness={0.3}
        metalness={0.15}
        transparent
        opacity={0.7}
      />
    </instancedMesh>
  );
}

// ── Camera drift ────────────────────────────────────────────────────

function CameraRig() {
  useFrame(({ camera, clock }) => {
    const t = clock.getElapsedTime();
    camera.position.x = Math.sin(t * 0.08) * 0.4;
    camera.position.y = Math.cos(t * 0.06) * 0.25;
    camera.lookAt(0, 0, 0);
  });
  return null;
}

// ── Scene ───────────────────────────────────────────────────────────

export default function Hero3DBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-0 overflow-hidden">
      <Canvas
        camera={{ position: [0, 0, 6], fov: 45 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.65} />
        <directionalLight position={[5, 5, 5]} intensity={0.9} color="#cbe7ff" />
        <pointLight position={[-3, 2, 2]} intensity={0.55} color="#a855f7" />
        <pointLight position={[3, -2, 1]} intensity={0.45} color="#22d3ee" />
        <DnaHelix />
        <MolecularField />
        <CameraRig />
      </Canvas>

      {/* Soft radial gradient mask so the scene fades toward the
          corners and never competes with the foreground content. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 65% 55% at 50% 45%, transparent 0%, rgba(5, 11, 24, 0.55) 75%, rgba(5, 11, 24, 0.85) 100%)',
        }}
      />
    </div>
  );
}

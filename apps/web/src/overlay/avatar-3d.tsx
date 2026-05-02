import { Canvas } from '@react-three/fiber';
import { MorbiusAvatar } from './morbius-avatar.tsx';

/**
 * Lazy-loadable shell for the WebGL avatar. Lives in its own module so
 * React.lazy() can code-split the entire @react-three/fiber +
 * @react-three/drei + three.js bundle off the landing/dashboard
 * critical path. Only the chat overlay imports this — and only when
 * the user opens it for the first time.
 */
export default function Avatar3D({
  speaking,
  listening,
}: {
  speaking: boolean;
  listening: boolean;
}) {
  return (
    <Canvas camera={{ position: [0, 0, 2.4], fov: 40 }}>
      <ambientLight intensity={0.3} />
      <pointLight position={[2, 2, 3]} intensity={0.6} color="#38bdf8" />
      <pointLight position={[-2, 1, 3]} intensity={0.3} color="#10b981" />
      <MorbiusAvatar speaking={speaking} listening={listening} />
    </Canvas>
  );
}

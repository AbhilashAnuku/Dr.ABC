import { cn } from '@dr-abc/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ForceSimulation, type SimNode } from '../../lib/force-graph.ts';

/**
 * PipelineGraph — animated visualisation of Mörbius's agent mesh, sized
 * to fit inside the dev-console drawer. Same force-graph engine as the
 * brain map, scaled smaller. Any node currently active in the live
 * stream pulses + radiates a glow.
 *
 * The drawer feeds in `activeAgents` whenever an `agent.started` event
 * comes through SSE; the highlight clears on `agent.completed`.
 *
 * Cursor is attractive. 60 / 120 / 144 Hz native via rAF.
 */

export interface PipelineGraphProps {
  /** Set of agent kinds currently mid-flight (drives the pulse). */
  activeAgents: ReadonlySet<string>;
  /** Agent kinds that have completed in the current run. */
  completedAgents: ReadonlySet<string>;
  /** Click handler — surfaces the picked node id back to the parent. */
  onPickAgent?: (id: string | null) => void;
  className?: string;
}

const PIPELINE_NODES = [
  { id: 'orchestrator', label: 'Orchestrator', group: 'core', x: 180, y: 110 },
  { id: 'triage', label: 'Triage', group: 'core', x: 90, y: 50 },
  { id: 'diagnostic', label: 'Diagnostic', group: 'core', x: 270, y: 50 },
  { id: 'cardiology', label: 'Cardiology', group: 'specialist' },
  { id: 'neurology', label: 'Neurology', group: 'specialist' },
  { id: 'oncology', label: 'Oncology', group: 'specialist' },
  { id: 'pulmonology', label: 'Pulmonology', group: 'specialist' },
  { id: 'endocrinology', label: 'Endocrinology', group: 'specialist' },
  { id: 'dermatology', label: 'Dermatology', group: 'specialist' },
  { id: 'imaging', label: 'Imaging', group: 'tool' },
  { id: 'library', label: 'Library', group: 'tool' },
  { id: 'research', label: 'Research', group: 'tool' },
  { id: 'profile', label: 'Profile', group: 'tool' },
  { id: 'validator', label: 'Validator', group: 'gate' },
  { id: 'safety', label: 'Safety', group: 'gate' },
  { id: 'privacy', label: 'Privacy', group: 'gate' },
];

const PIPELINE_EDGES = [
  { source: 'orchestrator', target: 'triage', weight: 2 },
  { source: 'orchestrator', target: 'diagnostic', weight: 2 },
  { source: 'orchestrator', target: 'validator', weight: 2 },
  { source: 'diagnostic', target: 'cardiology' },
  { source: 'diagnostic', target: 'neurology' },
  { source: 'diagnostic', target: 'oncology' },
  { source: 'diagnostic', target: 'pulmonology' },
  { source: 'diagnostic', target: 'endocrinology' },
  { source: 'diagnostic', target: 'dermatology' },
  { source: 'diagnostic', target: 'library' },
  { source: 'diagnostic', target: 'research' },
  { source: 'orchestrator', target: 'imaging' },
  { source: 'orchestrator', target: 'profile' },
  { source: 'validator', target: 'safety' },
  { source: 'validator', target: 'privacy' },
];

const GROUP_COLOR: Record<string, string> = {
  core: '#a78bfa',
  specialist: '#34d399',
  tool: '#60a5fa',
  gate: '#fb7185',
};

export function PipelineGraph({
  activeAgents,
  completedAgents,
  onPickAgent,
  className,
}: PipelineGraphProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ w: 600, h: 280 });
  const [picked, setPicked] = useState<string | null>(null);

  // Sim seeded once; ResizeObserver below calls sim.resize() with the
  // real dimensions every viewport tick. Including size in deps would
  // recreate the engine and lose layout state.
  const sim = useMemo(
    () =>
      new ForceSimulation(PIPELINE_NODES, PIPELINE_EDGES, {
        width: 600,
        height: 280,
        repulsion: 7000,
        springK: 0.06,
        springLen: 90,
        centerStrength: 0.02,
        damping: 0.85,
        cursorAttraction: 0.16,
      }),
    [],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const w = Math.max(280, r.width);
      const h = Math.max(200, r.height);
      setSize({ w, h });
      sim.resize(w, h);
      const c = canvasRef.current;
      if (c) {
        const dpr = window.devicePixelRatio || 1;
        c.width = w * dpr;
        c.height = h * dpr;
        c.style.width = `${w}px`;
        c.style.height = `${h}px`;
        const ctx = c.getContext('2d');
        if (ctx) ctx.scale(dpr, dpr);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [sim]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      sim.tick(dt);

      ctx.clearRect(0, 0, size.w, size.h);

      // edges
      for (const e of sim.edges) {
        const live =
          (activeAgents.has(e.source.id) || activeAgents.has(e.target.id)) &&
          (completedAgents.has(e.source.id) || activeAgents.has(e.source.id));
        ctx.strokeStyle = live
          ? 'rgba(167, 139, 250, 0.85)'
          : completedAgents.has(e.source.id) && completedAgents.has(e.target.id)
            ? 'rgba(96, 165, 250, 0.4)'
            : 'rgba(167, 139, 250, 0.16)';
        ctx.lineWidth = live ? 1.6 : 1;
        ctx.beginPath();
        ctx.moveTo(e.source.x, e.source.y);
        ctx.lineTo(e.target.x, e.target.y);
        ctx.stroke();
      }

      // nodes
      for (const n of sim.nodes) {
        const baseColor = GROUP_COLOR[n.group] ?? '#cbd5e1';
        const isActive = activeAgents.has(n.id);
        const isDone = completedAgents.has(n.id);
        const isPicked = picked === n.id;
        const r = isActive ? 14 : 11;

        // halo when active or picked
        if (isActive || isPicked) {
          const g = ctx.createRadialGradient(n.x, n.y, 1, n.x, n.y, 30);
          g.addColorStop(0, `${baseColor}cc`);
          g.addColorStop(1, `${baseColor}00`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(n.x, n.y, 30, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = isDone ? `${baseColor}55` : '#0a1628';
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = baseColor;
        ctx.lineWidth = isActive ? 2.5 : isPicked ? 2 : 1.2;
        ctx.stroke();

        ctx.fillStyle = 'rgba(241, 245, 249, 0.85)';
        ctx.font = '10px "Space Grotesk", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(n.label, n.x, n.y + r + 3);
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [sim, size, activeAgents, completedAgents, picked]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    let dragId: string | null = null;
    const localPos = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onMove = (e: PointerEvent) => {
      const p = localPos(e);
      sim.setCursor(p.x, p.y);
      if (dragId) sim.pin(dragId, p.x, p.y);
    };
    const onLeave = () => sim.clearCursor();
    const onDown = (e: PointerEvent) => {
      const p = localPos(e);
      const hit = sim.pickNode(p.x, p.y, 18) as SimNode | null;
      if (hit) {
        dragId = hit.id;
        sim.pin(hit.id, p.x, p.y);
        setPicked(hit.id);
        onPickAgent?.(hit.id);
        c.setPointerCapture(e.pointerId);
      } else {
        setPicked(null);
        onPickAgent?.(null);
      }
    };
    const onUp = (e: PointerEvent) => {
      if (dragId) sim.unpin(dragId);
      dragId = null;
      try {
        c.releasePointerCapture(e.pointerId);
      } catch {
        /* not held */
      }
    };
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerleave', onLeave);
    c.addEventListener('pointerdown', onDown);
    c.addEventListener('pointerup', onUp);
    c.addEventListener('pointercancel', onUp);
    return () => {
      c.removeEventListener('pointermove', onMove);
      c.removeEventListener('pointerleave', onLeave);
      c.removeEventListener('pointerdown', onDown);
      c.removeEventListener('pointerup', onUp);
      c.removeEventListener('pointercancel', onUp);
    };
  }, [sim, onPickAgent]);

  return (
    <div ref={containerRef} className={cn('relative h-70 w-full', className)}>
      <canvas ref={canvasRef} className="absolute inset-0 cursor-crosshair" />
    </div>
  );
}

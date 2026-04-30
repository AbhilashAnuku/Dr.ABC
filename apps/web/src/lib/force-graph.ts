/**
 * force-graph — a tiny canvas-backed force-directed graph engine.
 *
 * Used by the neural brain map (/app/brain) and the dev-console
 * pipeline drawer (in clinic.tsx). Zero deps — just `requestAnimationFrame`,
 * 2D canvas, and a hand-rolled velocity-Verlet style integrator with
 * three forces:
 *
 *   1. Repulsion between every pair of nodes (Coulomb-like, k / r²)
 *   2. Spring along every edge (Hooke, F = -k · (r - rest))
 *   3. Centring pull toward the canvas centre (so the graph never
 *      drifts off-screen on a fresh layout)
 *
 * Cursor is ATTRACTIVE — when the pointer is over the canvas, every
 * node feels a soft pull toward it (think: stirring soup with a finger,
 * not pushing it away). The cursor allows particles in, never repels.
 *
 * The simulator is renderer-agnostic — `tick()` returns the latest
 * positions; consumers (BrainMap, PipelineGraph) call `draw()` in
 * their rAF loop with their own paint code so each can style the
 * nodes/edges independently.
 *
 * rAF natively syncs to the device's display refresh, so motion is
 * smooth at 60Hz, 120Hz, 144Hz, ProMotion, etc. without us guessing.
 */

export interface NodeSpec {
  id: string;
  label: string;
  /** Arbitrary group key (e.g. 'specialist' / 'tool' / 'agent'). */
  group: string;
  /** Optional fixed metadata the renderer can use for colour / size. */
  meta?: Record<string, unknown>;
  /** Initial position; if omitted the engine seeds randomly. */
  x?: number;
  y?: number;
}

export interface EdgeSpec {
  source: string;
  target: string;
  /** Optional rest length override. */
  length?: number;
  /** Optional weight (1..n) — heavier edges pull harder. */
  weight?: number;
}

export interface Vec {
  x: number;
  y: number;
}

export interface SimNode extends Vec {
  id: string;
  label: string;
  group: string;
  meta?: Record<string, unknown>;
  vx: number;
  vy: number;
  /** True while the user is dragging this node — engine skips physics. */
  pinned: boolean;
}

export interface SimEdge {
  source: SimNode;
  target: SimNode;
  length: number;
  weight: number;
}

export interface SimulationOpts {
  width: number;
  height: number;
  /** Repulsion constant — bigger = nodes spread further. */
  repulsion?: number;
  /** Spring constant. */
  springK?: number;
  /** Default rest length for edges. */
  springLen?: number;
  /** Centring pull strength. */
  centerStrength?: number;
  /** Velocity damping per tick (0..1). */
  damping?: number;
  /** Cursor attraction strength when pointer is on canvas. */
  cursorAttraction?: number;
}

export class ForceSimulation {
  readonly nodes: SimNode[];
  readonly edges: SimEdge[];
  private opts: Required<SimulationOpts>;
  private cursor: { x: number; y: number; active: boolean } = {
    x: 0,
    y: 0,
    active: false,
  };

  constructor(nodeSpecs: NodeSpec[], edgeSpecs: EdgeSpec[], opts: SimulationOpts) {
    this.opts = {
      repulsion: 9000,
      springK: 0.04,
      springLen: 130,
      centerStrength: 0.012,
      damping: 0.86,
      cursorAttraction: 0.14,
      ...opts,
    };

    this.nodes = nodeSpecs.map((n) => ({
      id: n.id,
      label: n.label,
      group: n.group,
      meta: n.meta,
      x: n.x ?? opts.width / 2 + (Math.random() - 0.5) * Math.min(opts.width, opts.height) * 0.55,
      y: n.y ?? opts.height / 2 + (Math.random() - 0.5) * Math.min(opts.width, opts.height) * 0.55,
      vx: 0,
      vy: 0,
      pinned: false,
    }));

    const byId = new Map(this.nodes.map((n) => [n.id, n]));
    this.edges = edgeSpecs
      .map((e) => {
        const s = byId.get(e.source);
        const t = byId.get(e.target);
        if (!s || !t) return null;
        return {
          source: s,
          target: t,
          length: e.length ?? this.opts.springLen,
          weight: e.weight ?? 1,
        } satisfies SimEdge;
      })
      .filter((e): e is SimEdge => e !== null);
  }

  resize(width: number, height: number): void {
    this.opts.width = width;
    this.opts.height = height;
  }

  setCursor(x: number, y: number): void {
    this.cursor.x = x;
    this.cursor.y = y;
    this.cursor.active = true;
  }

  clearCursor(): void {
    this.cursor.active = false;
  }

  /** Pin a node at a position (e.g. while user is dragging it). */
  pin(id: string, x: number, y: number): void {
    const n = this.nodes.find((n) => n.id === id);
    if (!n) return;
    n.x = x;
    n.y = y;
    n.vx = 0;
    n.vy = 0;
    n.pinned = true;
  }

  unpin(id: string): void {
    const n = this.nodes.find((n) => n.id === id);
    if (n) n.pinned = false;
  }

  /** Find the nearest node within `radius` to (x, y). */
  pickNode(x: number, y: number, radius = 22): SimNode | null {
    let best: SimNode | null = null;
    let bestD = radius * radius;
    for (const n of this.nodes) {
      const dx = n.x - x;
      const dy = n.y - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  /** Advance the simulation one frame (uses real elapsed seconds, capped). */
  tick(dtSec: number): void {
    // Cap dt so a tab-switch hiccup doesn't catapult nodes to infinity.
    const dt = Math.min(dtSec, 1 / 30);
    const { repulsion, springK, centerStrength, damping, cursorAttraction, width, height } =
      this.opts;
    const cx = width / 2;
    const cy = height / 2;

    // 1) pairwise Coulomb repulsion (O(n²) is fine for ≤ 60 nodes)
    for (let i = 0; i < this.nodes.length; i++) {
      const a = this.nodes[i];
      if (!a) continue;
      for (let j = i + 1; j < this.nodes.length; j++) {
        const b = this.nodes[j];
        if (!b) continue;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          // Co-located — give a tiny random jitter so the force is finite.
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d2 = dx * dx + dy * dy + 1;
        }
        const f = repulsion / d2;
        const d = Math.sqrt(d2);
        const fx = (f * dx) / d;
        const fy = (f * dy) / d;
        if (!a.pinned) {
          a.vx -= fx * dt;
          a.vy -= fy * dt;
        }
        if (!b.pinned) {
          b.vx += fx * dt;
          b.vy += fy * dt;
        }
      }
    }

    // 2) spring along edges
    for (const e of this.edges) {
      const dx = e.target.x - e.source.x;
      const dy = e.target.y - e.source.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = springK * e.weight * (d - e.length);
      const fx = (f * dx) / d;
      const fy = (f * dy) / d;
      if (!e.source.pinned) {
        e.source.vx += fx * dt * 60;
        e.source.vy += fy * dt * 60;
      }
      if (!e.target.pinned) {
        e.target.vx -= fx * dt * 60;
        e.target.vy -= fy * dt * 60;
      }
    }

    // 3) centring pull
    for (const n of this.nodes) {
      if (n.pinned) continue;
      n.vx += (cx - n.x) * centerStrength * dt * 60;
      n.vy += (cy - n.y) * centerStrength * dt * 60;
    }

    // 4) cursor attraction (pulls nodes in, never repels)
    if (this.cursor.active) {
      for (const n of this.nodes) {
        if (n.pinned) continue;
        const dx = this.cursor.x - n.x;
        const dy = this.cursor.y - n.y;
        const d2 = dx * dx + dy * dy + 200;
        // Capped force so distant nodes still feel a gentle tug but
        // close-range nodes don't get yanked through the cursor.
        const f = cursorAttraction * 1200;
        const d = Math.sqrt(d2);
        n.vx += ((f * dx) / d / d) * dt * 60;
        n.vy += ((f * dy) / d / d) * dt * 60;
      }
    }

    // integrate
    for (const n of this.nodes) {
      if (n.pinned) continue;
      n.vx *= damping;
      n.vy *= damping;
      n.x += n.vx * dt * 60;
      n.y += n.vy * dt * 60;
    }
  }
}

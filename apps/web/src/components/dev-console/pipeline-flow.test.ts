import { describe, expect, it } from 'bun:test';
import {
  FLOW_EDGES,
  FLOW_NODES,
  type FlowNode,
  edgeAnchor,
  edgePath,
  nodeBounds,
} from './pipeline-flow.tsx';

describe('FLOW_NODES + FLOW_EDGES geometry', () => {
  it('has unique node ids', () => {
    const ids = new Set(FLOW_NODES.map((n) => n.id));
    expect(ids.size).toBe(FLOW_NODES.length);
  });

  it('every edge endpoint references a real node', () => {
    const ids = new Set(FLOW_NODES.map((n) => n.id));
    for (const e of FLOW_EDGES) {
      expect(ids.has(e.from)).toBe(true);
      expect(ids.has(e.to)).toBe(true);
    }
  });

  it('every node lies inside the 1000 × 640 viewBox', () => {
    for (const n of FLOW_NODES) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(1000);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeLessThanOrEqual(640);
    }
  });

  it('contains the canonical pipeline stages: input · triage · diagnostic · validator · safety · privacy · response', () => {
    const ids = new Set(FLOW_NODES.map((n) => n.id));
    for (const id of [
      'input',
      'triage',
      'diagnostic',
      'validator',
      'safety',
      'privacy',
      'response',
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('contains all six specialist agents', () => {
    const ids = new Set(FLOW_NODES.map((n) => n.id));
    for (const id of [
      'cardiology',
      'neurology',
      'oncology',
      'pulmonology',
      'endocrinology',
      'dermatology',
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('every specialist routes via triage and feeds the validator', () => {
    const specialists = [
      'cardiology',
      'neurology',
      'oncology',
      'pulmonology',
      'endocrinology',
      'dermatology',
    ];
    for (const spec of specialists) {
      expect(FLOW_EDGES.some((e) => e.from === 'triage' && e.to === spec)).toBe(true);
      expect(FLOW_EDGES.some((e) => e.from === spec && e.to === 'validator')).toBe(true);
    }
  });

  it('the gauntlet is wired in order: validator → safety → privacy → response', () => {
    expect(FLOW_EDGES.some((e) => e.from === 'validator' && e.to === 'safety')).toBe(true);
    expect(FLOW_EDGES.some((e) => e.from === 'safety' && e.to === 'privacy')).toBe(true);
    expect(FLOW_EDGES.some((e) => e.from === 'privacy' && e.to === 'response')).toBe(true);
  });

  it('RAG agents (library + research) feed the diagnostic agent', () => {
    expect(FLOW_EDGES.some((e) => e.from === 'library' && e.to === 'diagnostic')).toBe(true);
    expect(FLOW_EDGES.some((e) => e.from === 'research' && e.to === 'diagnostic')).toBe(true);
  });
});

describe('nodeBounds', () => {
  it('returns a centred bounding box per group', () => {
    const node: FlowNode = { id: 'x', label: 'X', x: 100, y: 200, group: 'gate' };
    const b = nodeBounds(node);
    expect(b.x1).toBeLessThan(node.x);
    expect(b.x2).toBeGreaterThan(node.x);
    expect(b.y1).toBeLessThan(node.y);
    expect(b.y2).toBeGreaterThan(node.y);
    // Symmetry
    expect(node.x - b.x1).toBeCloseTo(b.x2 - node.x, 5);
    expect(node.y - b.y1).toBeCloseTo(b.y2 - node.y, 5);
  });
});

describe('edgeAnchor', () => {
  const node: FlowNode = { id: 'x', label: 'X', x: 100, y: 100, group: 'gate' };

  it('returns the left-edge anchor when the source is to the left', () => {
    const a = edgeAnchor(node, 0, 100);
    expect(a.x).toBeLessThan(node.x);
    expect(a.y).toBe(node.y);
  });

  it('returns the right-edge anchor when the source is to the right', () => {
    const a = edgeAnchor(node, 1000, 100);
    expect(a.x).toBeGreaterThan(node.x);
    expect(a.y).toBe(node.y);
  });
});

describe('edgePath', () => {
  it('produces a cubic Bezier path string', () => {
    const a: FlowNode = { id: 'a', label: 'A', x: 100, y: 100, group: 'gate' };
    const b: FlowNode = { id: 'b', label: 'B', x: 400, y: 200, group: 'gate' };
    const path = edgePath(a, b);
    expect(path.startsWith('M ')).toBe(true);
    expect(path).toContain(' C ');
  });

  it('uses different control offsets for short vs long edges', () => {
    const close: FlowNode = { id: 'a', label: 'A', x: 100, y: 100, group: 'gate' };
    const near: FlowNode = { id: 'b', label: 'B', x: 200, y: 100, group: 'gate' };
    const far: FlowNode = { id: 'c', label: 'C', x: 800, y: 100, group: 'gate' };
    expect(edgePath(close, near)).not.toBe(edgePath(close, far));
  });
});

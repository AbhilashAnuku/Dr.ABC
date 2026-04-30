import { describe, expect, it } from 'bun:test';
import { ForceSimulation } from './force-graph.ts';

describe('ForceSimulation', () => {
  it('initialises every node with finite coordinates', () => {
    const sim = new ForceSimulation(
      [
        { id: 'a', label: 'A', group: 'g' },
        { id: 'b', label: 'B', group: 'g' },
        { id: 'c', label: 'C', group: 'g' },
      ],
      [],
      { width: 800, height: 600 },
    );
    for (const n of sim.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
  });

  it('drops edges that reference missing nodes', () => {
    const sim = new ForceSimulation(
      [{ id: 'a', label: 'A', group: 'g' }],
      [
        { source: 'a', target: 'ghost' },
        { source: 'ghost', target: 'a' },
      ],
      { width: 400, height: 300 },
    );
    expect(sim.edges).toEqual([]);
  });

  it('keeps node coordinates finite after many ticks', () => {
    const sim = new ForceSimulation(
      Array.from({ length: 8 }, (_, i) => ({
        id: `n${i}`,
        label: `N${i}`,
        group: 'g',
      })),
      [
        { source: 'n0', target: 'n1' },
        { source: 'n1', target: 'n2' },
        { source: 'n2', target: 'n3' },
        { source: 'n0', target: 'n4' },
        { source: 'n4', target: 'n5' },
      ],
      { width: 600, height: 400 },
    );
    for (let i = 0; i < 200; i++) sim.tick(1 / 60);
    for (const n of sim.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
  });

  it('pinned nodes do not move', () => {
    const sim = new ForceSimulation(
      [
        { id: 'a', label: 'A', group: 'g', x: 100, y: 100 },
        { id: 'b', label: 'B', group: 'g', x: 200, y: 200 },
      ],
      [{ source: 'a', target: 'b' }],
      { width: 400, height: 400 },
    );
    sim.pin('a', 50, 50);
    for (let i = 0; i < 50; i++) sim.tick(1 / 60);
    const a = sim.nodes.find((n) => n.id === 'a');
    expect(a?.x).toBe(50);
    expect(a?.y).toBe(50);
  });

  it('cursor attraction pulls nodes toward the pointer', () => {
    const sim = new ForceSimulation([{ id: 'a', label: 'A', group: 'g', x: 100, y: 100 }], [], {
      width: 400,
      height: 400,
      centerStrength: 0,
      repulsion: 0,
    });
    sim.setCursor(380, 380);
    for (let i = 0; i < 60; i++) sim.tick(1 / 60);
    const a = sim.nodes[0];
    expect(a).toBeDefined();
    if (!a) return;
    // Should have moved closer to (380, 380)
    expect(a.x).toBeGreaterThan(100);
    expect(a.y).toBeGreaterThan(100);
  });

  it('pickNode returns the closest node within radius', () => {
    const sim = new ForceSimulation(
      [
        { id: 'a', label: 'A', group: 'g', x: 100, y: 100 },
        { id: 'b', label: 'B', group: 'g', x: 300, y: 300 },
      ],
      [],
      { width: 400, height: 400 },
    );
    expect(sim.pickNode(105, 105)?.id).toBe('a');
    expect(sim.pickNode(300, 305)?.id).toBe('b');
    expect(sim.pickNode(0, 0, 5)).toBeNull();
  });
});

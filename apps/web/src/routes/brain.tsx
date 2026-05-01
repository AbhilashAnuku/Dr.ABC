// /app/brain — Mörbius brain map.
//
// In v0.7 this route became an alias of /app/neural-core. The two
// surfaces previously rendered different visualisations (orbiting
// clusters with mocked record counts vs. the live KG mesh); they are
// intentionally consolidated into one experience reachable from two
// URLs, since the brain map and the neural core are the same surface.
// The legacy clusters scene lives in git history (pre-531ca70) if it
// ever needs to be restored.

export { NeuralCorePage as BrainPage } from './neural-core.tsx';

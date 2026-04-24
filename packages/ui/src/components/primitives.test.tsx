// Light-weight construction tests for the v0.7 audit slice-2 primitives.
//
// We don't have a JSDOM/RTL setup wired in @dr-abc/ui (rendered DOM
// tests live in apps/web/ where vitejs-react is configured). What we
// CAN test cheaply:
//   - the components export correctly
//   - constructing them with various props doesn't throw
//   - the public API surface (variants, sizes, tones) accepts every
//     advertised value
// That catches the regressions that matter most: the next contributor
// dropping a variant or breaking the import chain.

import { describe, expect, test } from 'bun:test';
import { Button, type ButtonSize, type ButtonVariant } from './button.tsx';
import { Card, type CardDensity, type CardTone } from './card.tsx';
import { Modal } from './modal.tsx';
import { Pill, type PillSize, type PillTone } from './pill.tsx';
import { Stat } from './stat.tsx';
import { TextField, type TextFieldSize } from './text-field.tsx';

describe('Button', () => {
  test('exports a function', () => {
    expect(typeof Button).toBe('function');
  });
  test('accepts every variant + size combination', () => {
    const variants: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'destructive'];
    const sizes: ButtonSize[] = ['xs', 'sm', 'md'];
    for (const variant of variants) {
      for (const size of sizes) {
        const el = Button({ variant, size, children: 'x' });
        expect(el).toBeDefined();
      }
    }
  });
  test('loading flips aria-busy + disabled', () => {
    const el = Button({ loading: true, children: 'x' }) as { props: Record<string, unknown> };
    expect(el.props['aria-busy']).toBe(true);
    expect(el.props.disabled).toBe(true);
  });
});

describe('Card', () => {
  test('exports a function', () => {
    expect(typeof Card).toBe('function');
  });
  test('accepts every density + tone combination', () => {
    const densities: CardDensity[] = ['tight', 'cozy', 'spacious'];
    const tones: CardTone[] = ['default', 'pass', 'warn', 'fail', 'star'];
    for (const density of densities) {
      for (const tone of tones) {
        const el = Card({ density, tone, children: 'x' });
        expect(el).toBeDefined();
      }
    }
  });
});

describe('TextField', () => {
  test('exports a function', () => {
    expect(typeof TextField).toBe('function');
  });
  test('size type is the canonical pair', () => {
    const sizes: TextFieldSize[] = ['sm', 'md'];
    expect(sizes.length).toBe(2);
  });
  // Direct construction test skipped — TextField uses useId(); needs a
  // real render cycle. Real DOM tests live in apps/web.
});

describe('Modal', () => {
  test('exports a function with a Footer slot', () => {
    expect(typeof Modal).toBe('function');
    expect(typeof (Modal as unknown as { Footer: unknown }).Footer).toBe('function');
  });
  // Skipping the direct construction test — Modal uses useRef + useEffect
  // which can't be called outside a real render cycle. Real DOM tests
  // for Modal land in apps/web/ where vitejs-react + jsdom are wired.
});

describe('Stat', () => {
  test('exports a function', () => {
    expect(typeof Stat).toBe('function');
  });
  test('accepts compact + default sizes and trend variants', () => {
    expect(Stat({ label: 'Synapses', value: 42 })).toBeDefined();
    expect(Stat({ label: 'Memory', value: '7%', delta: '+1', trend: 'up' })).toBeDefined();
    expect(
      Stat({ label: 'Errors', value: 3, delta: '-1', trend: 'down', size: 'compact' }),
    ).toBeDefined();
  });
});

describe('Pill', () => {
  test('exports a function', () => {
    expect(typeof Pill).toBe('function');
  });
  test('accepts every tone + size combination', () => {
    const tones: PillTone[] = ['neutral', 'accent', 'success', 'warning', 'danger', 'info'];
    const sizes: PillSize[] = ['xs', 'sm'];
    for (const tone of tones) {
      for (const size of sizes) {
        expect(Pill({ tone, size, children: 'x' })).toBeDefined();
      }
    }
  });
  // Audit slice 7 — colourblind a11y. Every tone gets a default glyph
  // when no `icon` is passed; `icon={null}` suppresses; explicit icon
  // wins. The presence of a glyph is a hard invariant.
  test('default tone glyph fires when no icon prop', () => {
    const el = Pill({ tone: 'success', children: 'OK' }) as { props: { children: unknown[] } };
    // children is an array of [Icon-element, 'OK']
    const kids = (el.props.children as unknown[]).filter(Boolean);
    expect(kids.length).toBe(2);
  });
  test('icon={null} suppresses the default glyph', () => {
    const el = Pill({ tone: 'success', icon: null, children: 'OK' }) as {
      props: { children: unknown[] };
    };
    const kids = (el.props.children as unknown[]).filter(Boolean);
    expect(kids.length).toBe(1);
  });
});

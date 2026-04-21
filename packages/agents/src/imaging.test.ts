import { describe, expect, mock, test } from 'bun:test';
import { PySvcClient } from '@dr-abc/morbius-core';
import {
  ImagingAgent,
  PySvcVisionBackend,
  pickImagingBackend,
  tryCreateImagingAgent,
} from './imaging.ts';

const MASK_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEX///+nxBvIAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=';

function fakePySvc(): PySvcClient {
  const c = new PySvcClient({ baseUrl: 'http://localhost:8001' });
  return c;
}

describe('pickImagingBackend', () => {
  // Standing rule: py-svc (sovereign · MONAI · free) is
  // the default. Anthropic Vision is only chosen when explicitly opted-in
  // via MORBIUS_IMAGING=anthropic.
  test('prefers py-svc when both key and PY_SVC_URL set (sovereign default)', () => {
    expect(
      pickImagingBackend({
        ANTHROPIC_API_KEY: 'sk-ant-x',
        PY_SVC_URL: 'http://localhost:8001',
      }),
    ).toBe('py-svc');
  });

  test('uses Anthropic only when MORBIUS_IMAGING=anthropic AND key set', () => {
    expect(
      pickImagingBackend({
        ANTHROPIC_API_KEY: 'sk-ant-x',
        MORBIUS_IMAGING: 'anthropic',
      }),
    ).toBe('anthropic');
  });

  test('never auto-falls-through to anthropic — explicit MORBIUS_IMAGING pin is required', () => {
    // Anthropic Vision is dropped from any auto-cascade. Even if
    // py-svc is unreachable, we stay
    // on py-svc unless MORBIUS_IMAGING=anthropic is set explicitly,
    // so paid credits never burn by surprise during a demo.
    expect(pickImagingBackend({ PY_SVC_URL: '', ANTHROPIC_API_KEY: 'sk-ant-x' })).toBe('py-svc');
  });

  test('still picks py-svc when env totally empty (sidecar bundled by default)', () => {
    expect(pickImagingBackend({})).toBe('py-svc');
  });
});

describe('tryCreateImagingAgent', () => {
  test('returns null when no key and no factory', () => {
    expect(tryCreateImagingAgent({})).toBeNull();
  });

  test('returns ImagingAgent when factory provided even without Anthropic key', () => {
    const agent = tryCreateImagingAgent({}, () => fakePySvc());
    expect(agent).toBeInstanceOf(ImagingAgent);
  });
});

describe('PySvcVisionBackend.analyze', () => {
  test('produces overlay + heuristic finding from sidecar response', async () => {
    const client = fakePySvc();
    const fetchMock = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            width: 1,
            height: 1,
            backend: 'stub',
            confidence: 0.5,
            coverageFraction: 0.32,
            maskPngBase64: MASK_PNG_B64,
            notes: ['V0 stub.'],
          }),
      } as unknown as Response),
    );
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const backend = new PySvcVisionBackend(client);
      const out = await backend.analyze({
        imageBase64: 'AAAA',
        mimeType: 'image/png',
        modality: 'xray-chest',
      });
      expect(out.overlayPngBase64).toBe(MASK_PNG_B64);
      expect(out.overlayCoverage).toBeCloseTo(0.32, 5);
      expect(out.findings.length).toBe(1);
      const finding = out.findings[0];
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe('mild');
      expect(out.impression).toMatch(/Chest radiograph/);
      expect(out.rawConfidence).toBe(0.5);
    } finally {
      globalThis.fetch = original;
    }
  });

  test('marks coverage > 40% as moderate severity', async () => {
    const client = fakePySvc();
    const fetchMock = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            width: 1,
            height: 1,
            backend: 'stub',
            confidence: 0.5,
            coverageFraction: 0.55,
            maskPngBase64: MASK_PNG_B64,
            notes: [],
          }),
      } as unknown as Response),
    );
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const backend = new PySvcVisionBackend(client);
      const out = await backend.analyze({
        imageBase64: 'AAAA',
        mimeType: 'image/png',
        modality: 'ct',
      });
      expect(out.findings[0]?.severity).toBe('moderate');
      expect(out.impression).toMatch(/CT slice/);
    } finally {
      globalThis.fetch = original;
    }
  });
});

import { describe, expect, it, mock } from 'bun:test';
import { translateIfNeeded } from './translate.ts';

function fetchOk(body: Record<string, unknown>): typeof fetch {
  return mock(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof fetch;
}

describe('translateIfNeeded', () => {
  it('returns the source text unchanged when locale matches src', async () => {
    const r = await translateIfNeeded('Hello there', 'en-US', 'en');
    expect(r.wasTranslated).toBe(false);
    expect(r.text).toBe('Hello there');
  });

  it('returns the source text when target locale is not in the supported set', async () => {
    const r = await translateIfNeeded('Hello there', 'ja-JP', 'en');
    expect(r.wasTranslated).toBe(false);
    expect(r.text).toBe('Hello there');
  });

  it('returns the source text unchanged when auto-translate is explicitly off', async () => {
    const r = await translateIfNeeded('Hello there', 'de-DE', 'en', { enabled: false });
    expect(r.wasTranslated).toBe(false);
    expect(r.text).toBe('Hello there');
    expect(r.note).toMatch(/disabled/i);
  });

  it('returns translated text + model id on a happy MarianMT response', async () => {
    const fakeFetch = fetchOk({
      text: 'Hallo zusammen',
      backend: 'marianmt',
      model: 'Helsinki-NLP/opus-mt-en-de',
      latencyMs: 412,
    });
    const r = await translateIfNeeded('Hello everyone', 'de-DE', 'en', {
      enabled: true,
      fetchImpl: fakeFetch,
    });
    expect(r.wasTranslated).toBe(true);
    expect(r.text).toBe('Hallo zusammen');
    expect(r.model).toBe('Helsinki-NLP/opus-mt-en-de');
  });

  it('falls back when the sidecar returns the stub backend', async () => {
    const fakeFetch = fetchOk({
      text: 'Hello everyone',
      backend: 'stub',
      model: 'Helsinki-NLP/opus-mt-en-de',
      latencyMs: 0,
      note: 'install translate extra',
    });
    const r = await translateIfNeeded('Hello everyone', 'de-DE', 'en', {
      enabled: true,
      fetchImpl: fakeFetch,
    });
    expect(r.wasTranslated).toBe(false);
    expect(r.text).toBe('Hello everyone');
    expect(r.note).toMatch(/install translate extra/i);
  });

  it('falls back on a non-OK HTTP response', async () => {
    const fakeFetch = mock(
      async () => new Response('boom', { status: 500 }),
    ) as unknown as typeof fetch;
    const r = await translateIfNeeded('Hello everyone', 'de-DE', 'en', {
      enabled: true,
      fetchImpl: fakeFetch,
    });
    expect(r.wasTranslated).toBe(false);
    expect(r.text).toBe('Hello everyone');
    expect(r.note).toMatch(/http 500/i);
  });

  it('falls back when the network call throws', async () => {
    const fakeFetch = mock(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const r = await translateIfNeeded('Hello everyone', 'hi-IN', 'en', {
      enabled: true,
      fetchImpl: fakeFetch,
    });
    expect(r.wasTranslated).toBe(false);
    expect(r.text).toBe('Hello everyone');
    expect(r.note).toMatch(/network down/);
  });
});

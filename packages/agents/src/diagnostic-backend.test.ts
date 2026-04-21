import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_BACKEND_PRIORITY,
  pickDiagnosticBackend,
  resolveBackendPriority,
  tryCreateDiagnosticAgent,
} from './diagnostic.ts';

describe('DEFAULT_BACKEND_PRIORITY', () => {
  it('leads with NVIDIA NIM, the demo-grade reasoning backend', () => {
    // NVIDIA NIM is the primary path for the defense build because a
    // 16 GB-class laptop cannot run Ollama 70b at inference time.
    // Ollama stays in the
    // cascade as the local fallback, and Anthropic is dropped from
    // the default order so paid credits never burn by surprise.
    expect(DEFAULT_BACKEND_PRIORITY[0]).toBe('nvidia');
  });

  it('keeps the cascade free-only (no Anthropic, no Gemini by default)', () => {
    expect(DEFAULT_BACKEND_PRIORITY).toEqual(['nvidia', 'huggingface', 'ollama']);
  });
});

describe('resolveBackendPriority', () => {
  it('returns the default order on empty env', () => {
    expect(resolveBackendPriority({})).toEqual(DEFAULT_BACKEND_PRIORITY);
  });

  it('honours MORBIUS_BACKEND single-pin', () => {
    expect(resolveBackendPriority({ MORBIUS_BACKEND: 'anthropic' })).toEqual(['anthropic']);
    expect(resolveBackendPriority({ MORBIUS_BACKEND: 'OLLAMA' })).toEqual(['ollama']);
  });

  it('ignores unknown MORBIUS_BACKEND values', () => {
    expect(resolveBackendPriority({ MORBIUS_BACKEND: 'gpt-9000' })).toEqual(
      DEFAULT_BACKEND_PRIORITY,
    );
  });

  it('honours BACKEND_PRIORITY ordered list', () => {
    expect(resolveBackendPriority({ BACKEND_PRIORITY: 'nvidia,ollama,anthropic' })).toEqual([
      'nvidia',
      'ollama',
      'anthropic',
    ]);
  });

  it('drops unknown entries from BACKEND_PRIORITY', () => {
    expect(resolveBackendPriority({ BACKEND_PRIORITY: 'foo,ollama,bar' })).toEqual(['ollama']);
  });

  it('falls through to default when BACKEND_PRIORITY is all garbage', () => {
    expect(resolveBackendPriority({ BACKEND_PRIORITY: 'foo,bar' })).toEqual(
      DEFAULT_BACKEND_PRIORITY,
    );
  });

  it('MORBIUS_BACKEND wins over BACKEND_PRIORITY', () => {
    expect(
      resolveBackendPriority({ MORBIUS_BACKEND: 'anthropic', BACKEND_PRIORITY: 'ollama,nvidia' }),
    ).toEqual(['anthropic']);
  });
});

describe('pickDiagnosticBackend', () => {
  it('falls through to ollama on empty env (no cloud keys present)', () => {
    expect(pickDiagnosticBackend({})).toBe('ollama');
  });

  it('still picks Ollama when only an OLLAMA_MODEL override is set', () => {
    expect(pickDiagnosticBackend({ OLLAMA_MODEL: 'meditron' })).toBe('ollama');
  });

  it('picks nvidia first when an NVIDIA key is present (demo-build default)', () => {
    // NVIDIA NIM is the primary path; Anthropic is dropped from the
    // default cascade. The local
    // 16 GB-class laptop cannot serve 70b inference, so cloud-free
    // NIM leads.
    expect(
      pickDiagnosticBackend({ ANTHROPIC_API_KEY: 'sk-ant-…', NVIDIA_API_KEY: 'nvapi-…' }),
    ).toBe('nvidia');
  });

  it('picks the pinned backend when MORBIUS_BACKEND=anthropic + key present', () => {
    expect(
      pickDiagnosticBackend({ MORBIUS_BACKEND: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-…' }),
    ).toBe('anthropic');
  });

  it('returns offline when MORBIUS_BACKEND pins a cloud backend with no key', () => {
    expect(pickDiagnosticBackend({ MORBIUS_BACKEND: 'anthropic' })).toBe('offline');
  });

  it('walks BACKEND_PRIORITY left-to-right + skips backends without creds', () => {
    // Anthropic listed first but no key → skip → Ollama (always
    // available) wins.
    expect(pickDiagnosticBackend({ BACKEND_PRIORITY: 'anthropic,ollama' })).toBe('ollama');
  });

  it('keeps Anthropic reachable only via explicit MORBIUS_BACKEND pin', () => {
    // Without a pin the default cascade (nvidia → huggingface →
    // ollama) never reaches Anthropic, even when ANTHROPIC_API_KEY
    // is set.
    expect(pickDiagnosticBackend({ ANTHROPIC_API_KEY: 'sk-ant-…' })).toBe('ollama');
  });
});

describe('tryCreateDiagnosticAgent', () => {
  it('builds an Ollama-backed agent on empty env (local-first)', () => {
    const agent = tryCreateDiagnosticAgent({});
    expect(agent).not.toBeNull();
  });

  it('builds an Anthropic-backed agent when MORBIUS_BACKEND=anthropic + key', () => {
    const agent = tryCreateDiagnosticAgent({
      MORBIUS_BACKEND: 'anthropic',
      ANTHROPIC_API_KEY: 'sk-ant-test',
    });
    expect(agent).not.toBeNull();
  });

  it('returns null when the pinned backend has no creds', () => {
    expect(tryCreateDiagnosticAgent({ MORBIUS_BACKEND: 'anthropic' })).toBeNull();
  });
});

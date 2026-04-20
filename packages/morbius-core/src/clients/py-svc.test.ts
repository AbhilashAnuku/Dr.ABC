import { describe, expect, mock, test } from 'bun:test';
import { PySvcClient } from './py-svc.ts';

describe('PySvcClient', () => {
  test('strips trailing slash from baseUrl', () => {
    const c = new PySvcClient({ baseUrl: 'http://localhost:8001/' });
    expect(c.baseUrl).toBe('http://localhost:8001');
  });

  test('fromEnv reads PY_SVC_URL', () => {
    const c = PySvcClient.fromEnv({ PY_SVC_URL: 'http://py:8001' });
    expect(c.baseUrl).toBe('http://py:8001');
  });

  test('fromEnv falls back to default when env empty', () => {
    const c = PySvcClient.fromEnv({});
    expect(c.baseUrl).toBe('http://localhost:8001');
  });

  test('fromEnv parses PY_SVC_TIMEOUT_MS', () => {
    const c = PySvcClient.fromEnv({ PY_SVC_TIMEOUT_MS: '5000' });
    expect(c.timeoutMs).toBe(5000);
  });

  test('medicalNer caches identical (text, backend) calls', async () => {
    const c = new PySvcClient({ baseUrl: 'http://localhost:8001' });
    const fetchMock = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ backend: 'regex', entities: [] }),
      } as unknown as Response),
    );
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      await c.medicalNer('aspirin 81 mg', 'regex');
      await c.medicalNer('aspirin 81 mg', 'regex');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = original;
    }
  });

  test('medicalNer does NOT cache across different backends', async () => {
    const c = new PySvcClient({ baseUrl: 'http://localhost:8001' });
    const fetchMock = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ backend: 'regex', entities: [] }),
      } as unknown as Response),
    );
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      await c.medicalNer('text', 'regex');
      await c.medicalNer('text', 'scispacy');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.fetch = original;
    }
  });

  test('throws on non-OK response with status detail', async () => {
    const c = new PySvcClient({ baseUrl: 'http://localhost:8001' });
    const fetchMock = mock(() =>
      Promise.resolve({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: () => Promise.resolve('imaging backend offline'),
      } as unknown as Response),
    );
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      await expect(c.health()).rejects.toThrow(/503/);
    } finally {
      globalThis.fetch = original;
    }
  });
});

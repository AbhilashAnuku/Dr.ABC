import type { OrchestratorEvent } from '@dr-abc/types';
import { useCallback, useState } from 'react';

export interface UseOrchestrateState {
  events: OrchestratorEvent[];
  status: 'idle' | 'streaming' | 'done' | 'error';
  error: string | null;
}

export function useOrchestrate(endpoint = '/api/orchestrate') {
  const [state, setState] = useState<UseOrchestrateState>({
    events: [],
    status: 'idle',
    error: null,
  });

  const send = useCallback(
    async (text: string) => {
      setState({ events: [], status: 'streaming', error: null });

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text }),
        });

        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split('\n\n');
          buffer = chunks.pop() ?? '';

          for (const chunk of chunks) {
            const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '));
            if (!dataLine) continue;
            const json = dataLine.slice(6).trim();
            if (!json || json === '{}') continue;
            try {
              const event = JSON.parse(json) as OrchestratorEvent;
              setState((s) => ({ ...s, events: [...s.events, event] }));
            } catch {
              // ignore malformed
            }
          }
        }

        setState((s) => ({ ...s, status: 'done' }));
      } catch (err) {
        setState((s) => ({
          ...s,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    },
    [endpoint],
  );

  return { ...state, send };
}

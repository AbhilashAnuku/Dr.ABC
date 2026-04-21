import Anthropic from '@anthropic-ai/sdk';

/**
 * SynthBackend — minimal chat interface used by the EvidenceSynthAgent.
 *
 * Why a separate interface (not DiagnosticEnsemble): the synth call
 * doesn't want structured tool-use output. It wants free prose with
 * `[n]` footnote markers. Reusing the diagnostic interface would force
 * the model into JSON mode, which strips the citation markers.
 *
 * Three concrete impls share an OpenAI-compatible base where possible
 * (NVIDIA + HF), with Anthropic getting its own implementation because
 * it needs the Anthropic SDK and uses prompt caching.
 */

export interface SynthBackend {
  readonly name: string;
  /** Returns the assistant text reply. Throws on HTTP error or timeout. */
  chat(opts: { system: string; user: string; maxTokens: number }): Promise<string>;
}

const TIMEOUT_MS = 30_000;

interface OpenAiChatBackendOpts {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Header label for diagnostic logs ("nvidia", "huggingface", "ollama"). */
  vendor: string;
}

class OpenAiChatBackend implements SynthBackend {
  readonly name: string;
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly model: string;

  constructor(opts: OpenAiChatBackendOpts) {
    const trimmedBase = opts.baseUrl.replace(/\/$/, '');
    this.url = `${trimmedBase}/chat/completions`;
    this.model = opts.model;
    this.name = `${opts.vendor}:${opts.model}`;
    this.headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (opts.apiKey) this.headers.Authorization = `Bearer ${opts.apiKey}`;
  }

  async chat(opts: { system: string; user: string; maxTokens: number }): Promise<string> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
        max_tokens: opts.maxTokens,
        temperature: 0.2,
        stream: false,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`${this.name} ${res.status}: ${detail.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return json.choices?.[0]?.message?.content ?? '';
  }
}

class AnthropicChatBackend implements SynthBackend {
  readonly name: string;
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(opts: { apiKey: string; model: string }) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.model = opts.model;
    this.name = `anthropic:${opts.model}`;
  }

  async chat(opts: { system: string; user: string; maxTokens: number }): Promise<string> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: opts.maxTokens,
      system: [
        {
          type: 'text',
          text: opts.system,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: opts.user }],
    });
    const block = res.content.find((c) => c.type === 'text');
    return block && block.type === 'text' ? block.text : '';
  }
}

class OllamaChatBackend implements SynthBackend {
  readonly name: string;
  private readonly url: string;
  private readonly model: string;

  constructor(opts: { baseUrl: string; model: string }) {
    this.url = `${opts.baseUrl.replace(/\/$/, '')}/api/chat`;
    this.model = opts.model;
    this.name = `ollama:${opts.model}`;
  }

  async chat(opts: { system: string; user: string; maxTokens: number }): Promise<string> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
        stream: false,
        options: { temperature: 0.2, num_predict: opts.maxTokens },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS * 2),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`${this.name} ${res.status}: ${detail.slice(0, 200)}`);
    }
    const json = (await res.json()) as { message?: { content?: string } };
    return json.message?.content ?? '';
  }
}

/**
 * Picks a SynthBackend matching the same precedence as the diagnostic
 * agent — Anthropic > NVIDIA > HF > Ollama > null.
 */
export function trySynthBackend(env: {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  NVIDIA_API_KEY?: string;
  NVIDIA_MODEL?: string;
  HF_API_TOKEN?: string;
  HF_MODEL?: string;
  OLLAMA_BASE_URL?: string;
  OLLAMA_MODEL?: string;
}): SynthBackend | null {
  if (env.ANTHROPIC_API_KEY) {
    return new AnthropicChatBackend({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    });
  }
  if (env.NVIDIA_API_KEY) {
    return new OpenAiChatBackend({
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      apiKey: env.NVIDIA_API_KEY,
      model: env.NVIDIA_MODEL ?? 'meta/llama-3.3-70b-instruct',
      vendor: 'nvidia',
    });
  }
  if (env.HF_API_TOKEN) {
    return new OpenAiChatBackend({
      baseUrl: 'https://router.huggingface.co/v1',
      apiKey: env.HF_API_TOKEN,
      model: env.HF_MODEL ?? 'aaditya/Llama3-OpenBioLLM-8B',
      vendor: 'huggingface',
    });
  }
  if (env.OLLAMA_MODEL || env.OLLAMA_BASE_URL) {
    return new OllamaChatBackend({
      baseUrl: env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
      // Practical inference default — Llama 3.1 8b fits on 16 GB
      // hardware. Llama 3.3 70b Instruct stays the *training base*
      // target (AGENTS.md §10) but needs 64 GB+ to serve.
      // Override per-deploy via OLLAMA_MODEL env var.
      model: env.OLLAMA_MODEL ?? 'llama3.1:8b',
    });
  }
  return null;
}

export { OpenAiChatBackend, AnthropicChatBackend, OllamaChatBackend };

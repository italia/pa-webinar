/**
 * Provider routing for the worker.
 *
 * The Next.js app doesn't itself talk to Whisper/vLLM — the Python
 * worker does. The app's job is only to resolve `which provider +
 * which model + which base URL` to use for a given (event, kind) pair
 * and ship that selection in the claim response.
 *
 * **Sovereignty policy**: every provider supported here must run
 * **in-cluster on the AI GPU node pool**. No external API endpoints
 * (no OVH AI, no Anthropic, no OpenAI, no Hugging Face Inference
 * Endpoints). PA data never leaves the cluster except to the
 * configured object storage. If a future internal alternative to vLLM
 * is added (e.g. text-generation-inference, llama.cpp), it lives
 * here too, but the constraint "in-cluster only" stands.
 *
 * Provider envelope is intentionally minimal (provider id + base URL
 * inside the cluster + model id) so adding a new in-cluster backend
 * later requires only:
 *   1. add an enum literal in `AsrProvider` / `LlmProvider`,
 *   2. add a branch in `resolveProvider*`,
 *   3. implement the protocol in the Python worker.
 */

import { z } from 'zod';

export const llmProviderSchema = z.enum(['vllm']);
export const asrProviderSchema = z.enum(['whisperx']);
/**
 * TTS engine. Solo opzioni in-cluster, commercial-safe.
 * - `piper`: rhasspy/piper (MIT, ONNX, voci OSS multi-lingua). Vendor
 *   FOSS (Mike Hansen / Rhasspy). Default.
 * Provider non-commerciali (XTTS-v2 CPML, Bark) sono esplicitamente
 * esclusi dall'enum per uso PA — vanno aggiunti qui solo se
 * l'operator decide di accettare la licenza.
 */
export const ttsProviderSchema = z.enum(['piper']);

export type LlmProvider = z.infer<typeof llmProviderSchema>;
export type AsrProvider = z.infer<typeof asrProviderSchema>;
export type TtsProvider = z.infer<typeof ttsProviderSchema>;

export interface ResolvedLlm {
  provider: LlmProvider;
  baseUrl?: string;
  modelId: string;
}

export interface ResolvedAsr {
  provider: AsrProvider;
  modelId: string;
}

/**
 * Resolve LLM provider hints to ship in the claim response.
 *
 * Reads from SiteSetting-derived inputs + env vars. The worker
 * receives `(provider, baseUrl, modelId)` and any credential from its
 * own pod env (never crossing the wire from the app). The base URL is
 * **always** a cluster-internal Service DNS — refusing wire egress is
 * defence in depth even if env is misconfigured (network policy on
 * the worker pod must block egress to anything other than the app +
 * Postgres + the object-storage endpoint).
 */
export function resolveLlmProvider(opts: {
  siteProvider: string;
  envBaseUrl?: string;
  envModelId?: string;
}): ResolvedLlm {
  const provider = llmProviderSchema.parse(opts.siteProvider);
  switch (provider) {
    case 'vllm': {
      return {
        provider,
        // Default: a vLLM Service in the same namespace exposing
        // OpenAI-compatible /v1 endpoints. Override via env when the
        // Service is in another namespace or named differently.
        baseUrl:
          opts.envBaseUrl ??
          process.env.AI_VLLM_BASE_URL ??
          'http://pa-webinar-vllm:8000/v1',
        // Default: Mistral-Small-3.2-24B-Instruct-2506 (Mistral AI,
        // Parigi — vendor europeo, Apache 2.0, ~48GB in fp16 → entra
        // in A100 80GB con ampio margine). Scelta DTD per privilegiare
        // un fornitore di modelli AI con sede in EU (sovranità sui
        // pesi + traineranno futuri update). Eccellente su IT/EN/FR
        // (Mistral trained specificamente su lingue europee).
        // Override env per usare altri modelli — es.
        // `AI_VLLM_MODEL_ID=Qwen/Qwen3-32B-Instruct` per benchmark
        // comparativo.
        modelId:
          opts.envModelId ??
          process.env.AI_VLLM_MODEL_ID ??
          'mistralai/Mistral-Small-3.2-24B-Instruct-2506',
      };
    }
    default: {
      const _exhaustive: never = provider;
      throw new Error(`unknown llm provider: ${String(_exhaustive)}`);
    }
  }
}

export interface ResolvedTts {
  engine: TtsProvider;
  // Path nel filesystem del worker dove sono pre-scaricate le voci
  // Piper (file .onnx + .onnx.json). Default: /models/piper/<lang>.
  voicesPath: string;
}

export function resolveTtsProvider(opts: {
  siteProvider: string;
  envVoicesPath?: string;
}): ResolvedTts {
  const engine = ttsProviderSchema.parse(opts.siteProvider);
  return {
    engine,
    voicesPath:
      opts.envVoicesPath ??
      process.env.AI_TTS_VOICES_PATH ??
      '/models/piper',
  };
}

export function resolveAsrProvider(opts: {
  siteProvider: string;
  envModelId?: string;
}): ResolvedAsr {
  const provider = asrProviderSchema.parse(opts.siteProvider);
  switch (provider) {
    case 'whisperx': {
      return {
        provider,
        modelId: opts.envModelId ?? process.env.AI_ASR_MODEL_ID ?? 'large-v3',
      };
    }
    default: {
      const _exhaustive: never = provider;
      throw new Error(`unknown asr provider: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Normalise a comma-separated locale list (from SiteSetting or Event).
 * Empty input returns []. Each token is trimmed, lower-cased, and
 * filtered to a basic ISO-639-1 shape. Duplicates are removed.
 */
export function parseTargetLocales(value: string | null | undefined): string[] {
  if (!value) return [];
  const out: string[] = [];
  for (const raw of value.split(',')) {
    const tok = raw.trim().toLowerCase();
    if (!/^[a-z]{2,3}(-[a-z]{2,4})?$/.test(tok)) continue;
    if (!out.includes(tok)) out.push(tok);
  }
  return out;
}

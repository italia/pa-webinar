import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  llmProviderSchema,
  parseTargetLocales,
  resolveAsrProvider,
  resolveLlmProvider,
  resolveTtsProvider,
  ttsProviderSchema,
} from './providers';

describe('llmProviderSchema (sovereignty)', () => {
  it('only accepts in-cluster providers', () => {
    expect(llmProviderSchema.parse('vllm')).toBe('vllm');
    // OVH and other external endpoints are intentionally excluded.
    expect(() => llmProviderSchema.parse('ovh')).toThrow();
    expect(() => llmProviderSchema.parse('openai')).toThrow();
    expect(() => llmProviderSchema.parse('anthropic')).toThrow();
  });
});

describe('resolveLlmProvider', () => {
  const origEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.AI_VLLM_BASE_URL;
    delete process.env.AI_VLLM_MODEL_ID;
  });
  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('falls back to the cluster-internal default URL', () => {
    const r = resolveLlmProvider({ siteProvider: 'vllm' });
    expect(r.provider).toBe('vllm');
    expect(r.baseUrl).toMatch(/^http:\/\//);
    expect(r.baseUrl).not.toMatch(/cloud\.ovh\.net|openai\.com|anthropic\.com/);
  });

  it('prefers the explicit baseUrl/modelId override', () => {
    const r = resolveLlmProvider({
      siteProvider: 'vllm',
      envBaseUrl: 'http://other-vllm:8000/v1',
      envModelId: 'Mistral-Small-3.2',
    });
    expect(r.baseUrl).toBe('http://other-vllm:8000/v1');
    expect(r.modelId).toBe('Mistral-Small-3.2');
  });

  it('uses env vars when no explicit override', () => {
    process.env.AI_VLLM_BASE_URL = 'http://env-vllm:8000/v1';
    process.env.AI_VLLM_MODEL_ID = 'env-model';
    const r = resolveLlmProvider({ siteProvider: 'vllm' });
    expect(r.baseUrl).toBe('http://env-vllm:8000/v1');
    expect(r.modelId).toBe('env-model');
  });

  it('rejects external provider ids', () => {
    expect(() => resolveLlmProvider({ siteProvider: 'ovh' })).toThrow();
  });
});

describe('resolveAsrProvider', () => {
  it('returns whisperx by default', () => {
    const r = resolveAsrProvider({ siteProvider: 'whisperx' });
    expect(r.provider).toBe('whisperx');
    expect(r.modelId).toMatch(/large|small|medium/);
  });
});

describe('ttsProviderSchema (sovereignty)', () => {
  it('only accepts in-cluster commercial-safe engines', () => {
    expect(ttsProviderSchema.parse('piper')).toBe('piper');
    // CPML / non-commercial / cloud TTS sono esplicitamente esclusi.
    expect(() => ttsProviderSchema.parse('coqui-xtts-v2')).toThrow();
    expect(() => ttsProviderSchema.parse('elevenlabs')).toThrow();
    expect(() => ttsProviderSchema.parse('bark')).toThrow();
  });
});

describe('resolveTtsProvider', () => {
  it('returns piper with default /models/piper voices path', () => {
    const r = resolveTtsProvider({ siteProvider: 'piper' });
    expect(r.engine).toBe('piper');
    expect(r.voicesPath).toContain('piper');
  });

  it('respects an explicit voicesPath override', () => {
    const r = resolveTtsProvider({
      siteProvider: 'piper',
      envVoicesPath: '/mnt/custom-voices',
    });
    expect(r.voicesPath).toBe('/mnt/custom-voices');
  });

  it('rejects unknown engine', () => {
    expect(() => resolveTtsProvider({ siteProvider: 'cosyvoice' })).toThrow();
  });
});

describe('parseTargetLocales', () => {
  it('returns empty for null/empty', () => {
    expect(parseTargetLocales(null)).toEqual([]);
    expect(parseTargetLocales('')).toEqual([]);
    expect(parseTargetLocales(undefined)).toEqual([]);
  });
  it('splits on comma + trims + lowercases', () => {
    expect(parseTargetLocales('EN, fr ,  De ')).toEqual(['en', 'fr', 'de']);
  });
  it('filters obvious garbage', () => {
    expect(parseTargetLocales('en,bad-locale!,fr')).toEqual(['en', 'fr']);
  });
  it('dedupes while preserving first-seen order', () => {
    expect(parseTargetLocales('en,fr,en,FR,de')).toEqual(['en', 'fr', 'de']);
  });
});

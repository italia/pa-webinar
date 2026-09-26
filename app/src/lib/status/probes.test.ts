// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetProbeCache,
  baseUrl,
  cachedProbe,
  classifyFetchError,
  probeHttp,
} from './probes';

/** L'errore che lancia il `fetch` di Node: il codice vero sta nella causa. */
function fetchFailed(code: string): TypeError {
  const err = new TypeError('fetch failed');
  (err as TypeError & { cause: unknown }).cause = Object.assign(new Error(code), { code });
  return err;
}

beforeEach(() => {
  __resetProbeCache();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('classifyFetchError', () => {
  it('un certificato non riconosciuto è un errore TLS, con il suo codice', () => {
    expect(classifyFetchError(fetchFailed('DEPTH_ZERO_SELF_SIGNED_CERT'))).toEqual({
      failure: 'tls',
      code: 'DEPTH_ZERO_SELF_SIGNED_CERT',
    });
    expect(classifyFetchError(fetchFailed('UNABLE_TO_GET_ISSUER_CERT_LOCALLY')).failure).toBe('tls');
    expect(classifyFetchError(fetchFailed('ERR_TLS_CERT_ALTNAME_INVALID')).failure).toBe('tls');
  });

  it('un nome che non si risolve è un errore DNS', () => {
    expect(classifyFetchError(fetchFailed('ENOTFOUND'))).toEqual({ failure: 'dns', code: 'ENOTFOUND' });
    expect(classifyFetchError(fetchFailed('EAI_AGAIN')).failure).toBe('dns');
  });

  it('il tempo scaduto di AbortSignal.timeout è un timeout', () => {
    const err = Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    });
    expect(classifyFetchError(err)).toEqual({ failure: 'timeout', code: 'TIMEOUT' });
    expect(classifyFetchError(fetchFailed('UND_ERR_CONNECT_TIMEOUT')).failure).toBe('timeout');
  });

  it('il codice si trova anche in un errore aggregato di più indirizzi', () => {
    const err = new TypeError('fetch failed');
    (err as TypeError & { cause: unknown }).cause = Object.assign(new Error('aggregate'), {
      errors: [Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })],
    });
    expect(classifyFetchError(err)).toEqual({ failure: 'network', code: 'ECONNREFUSED' });
  });

  it('senza codice: errore di rete generico, mai muto', () => {
    expect(classifyFetchError(new Error('boh'))).toEqual({ failure: 'network', code: 'FETCH_FAILED' });
    expect(classifyFetchError(undefined)).toEqual({ failure: 'network', code: 'FETCH_FAILED' });
  });
});

describe('probeHttp', () => {
  it('risponde: ok con lo stato HTTP', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
    const r = await probeHttp('http://web/external_api.js');
    expect(r.ok).toBe(true);
    expect(r.httpStatus).toBe(200);
  });

  it('risponde con un errore: non ok, il codice è lo stato HTTP', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 503 })));
    const r = await probeHttp('http://web/external_api.js');
    expect(r).toMatchObject({ ok: false, failure: 'http', code: 'HTTP 503', httpStatus: 503 });
  });

  it('gli stati accettati si possono allargare (BOSH risponde 405 a certi proxy)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 405 })));
    const r = await probeHttp('http://prosody/http-bind', {
      accept: (s) => s === 405 || (s >= 200 && s < 300),
    });
    expect(r.ok).toBe(true);
  });

  it('non lancia mai: un certificato rifiutato torna come esito', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw fetchFailed('DEPTH_ZERO_SELF_SIGNED_CERT'); }));
    const r = await probeHttp('https://jitsi.example/external_api.js');
    expect(r).toMatchObject({ ok: false, failure: 'tls', code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
  });
});

describe('cachedProbe', () => {
  it('chi chiede mentre la sonda è in volo riceve la stessa promessa', async () => {
    const fn = vi.fn(async () => 42);
    const [a, b] = await Promise.all([cachedProbe('k', fn), cachedProbe('k', fn)]);
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("l'esito resta valido qualche secondo, poi si rifà la sonda", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-01T10:00:00Z'));
    const fn = vi.fn(async () => 'x');
    await cachedProbe('k', fn, 5_000);
    vi.setSystemTime(new Date('2026-09-01T10:00:04Z'));
    await cachedProbe('k', fn, 5_000);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-09-01T10:00:06Z'));
    await cachedProbe('k', fn, 5_000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("un orologio che torna indietro non tiene in vita un esito vecchio", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-01T10:30:00Z'));
    const fn = vi.fn(async () => 'x');
    await cachedProbe('k', fn, 5_000);
    vi.setSystemTime(new Date('2026-09-01T10:00:00Z'));
    await cachedProbe('k', fn, 5_000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('una promessa rifiutata non si tiene', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('giù'))
      .mockResolvedValueOnce('su');
    await expect(cachedProbe('k', fn)).rejects.toThrow('giù');
    await expect(cachedProbe('k', fn)).resolves.toBe('su');
  });

  it('chiavi diverse, sonde diverse', async () => {
    const fn = vi.fn(async () => 1);
    await cachedProbe('a', fn);
    await cachedProbe('b', fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('baseUrl', () => {
  it('toglie le barre finali', () => {
    expect(baseUrl('http://jicofo:8888/')).toBe('http://jicofo:8888');
    expect(baseUrl('http://jicofo:8888')).toBe('http://jicofo:8888');
  });
});

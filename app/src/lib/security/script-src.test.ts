import { describe, expect, it } from 'vitest';

import { compilaWebAssembly, direttivaScript } from './script-src';

const base = { nonce: 'abc', jitsiDomain: 'meet.example.org' };

describe('direttivaScript', () => {
  it('in produzione: nonce e strict-dynamic, senza eval', () => {
    const d = direttivaScript({ ...base, produzione: true, webAssembly: false });
    expect(d).toBe("script-src 'self' 'nonce-abc' 'strict-dynamic' https: https://meet.example.org");
  });

  it('WebAssembly solo se richiesto, e mai l’eval di JavaScript in produzione', () => {
    const d = direttivaScript({ ...base, produzione: true, webAssembly: true });
    expect(d).toContain("'wasm-unsafe-eval'");
    expect(d).not.toContain("'unsafe-eval'");
  });

  it('in sviluppo: eval per next dev', () => {
    expect(direttivaScript({ ...base, produzione: false, webAssembly: false })).toContain("'unsafe-eval'");
  });
});

describe('compilaWebAssembly', () => {
  it('solo la sala dell’evento, in ogni lingua', () => {
    expect(compilaWebAssembly('/it/eventi/un-evento/live')).toBe(true);
    expect(compilaWebAssembly('/en/events/an-event/live')).toBe(true);
    expect(compilaWebAssembly('/de/events/ein-event/live/')).toBe(true);
    expect(compilaWebAssembly('/it/eventi/un-evento')).toBe(false);
    expect(compilaWebAssembly('/it/admin/eventi')).toBe(false);
    expect(compilaWebAssembly('/it/eventi/un-evento/live/altro')).toBe(false);
  });
});

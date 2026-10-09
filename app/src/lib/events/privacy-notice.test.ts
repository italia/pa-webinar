import { afterEach, describe, expect, it, vi } from 'vitest';

import { informativaEvento } from './privacy-notice';

const evento = (o: Partial<Parameters<typeof informativaEvento>[0]> = {}) => ({
  privacyPolicyUrl: null,
  privacyPolicyText: null,
  gdprTemplate: null,
  ...o,
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('informativaEvento', () => {
  it('il link: dell\'evento, poi dell\'istanza, poi la pagina privacy nella lingua della pagina', () => {
    vi.stubEnv('DEFAULT_PRIVACY_POLICY_URL', '');
    delete process.env.DEFAULT_PRIVACY_POLICY_URL;
    expect(informativaEvento(evento(), 'it').url).toBe('/it/privacy');
    vi.stubEnv('DEFAULT_PRIVACY_POLICY_URL', 'https://ente.example/privacy');
    expect(informativaEvento(evento(), 'it').url).toBe('https://ente.example/privacy');
    expect(
      informativaEvento(evento({ privacyPolicyUrl: 'https://evento.example/p' }), 'it').url,
    ).toBe('https://evento.example/p');
  });

  it('il testo: dell\'evento, poi del modello nella lingua della pagina, poi in italiano', () => {
    const gdprTemplate = { body: { it: 'Modello IT', fr: 'Modèle FR' } };
    expect(informativaEvento(evento({ gdprTemplate }), 'fr').testo).toBe('Modèle FR');
    expect(informativaEvento(evento({ gdprTemplate }), 'de').testo).toBe('Modello IT');
    expect(
      informativaEvento(evento({ gdprTemplate, privacyPolicyText: 'Testo evento' }), 'fr').testo,
    ).toBe('Testo evento');
  });

  it('un testo vuoto vale come assente: resta il link', () => {
    const r = informativaEvento(evento({ privacyPolicyText: '  ', gdprTemplate: { body: { it: '' } } }), 'it');
    expect(r.testo).toBeUndefined();
  });
});

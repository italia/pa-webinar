// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const impostazioni = vi.hoisted(() => ({ defaultLocale: 'it' as string | null }));
vi.mock('@/lib/settings', () => ({ getSettings: async () => impostazioni }));
// Le traduzioni come le darebbe next-intl, dai cataloghi veri.
vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale }: { locale: string }) => {
    const m = (await import(`@/i18n/messages/${locale}.json`)).default as {
      live: { pseudonym: string };
    };
    return (_k: string, v: { code: string }) =>
      m.live.pseudonym.replace('{code}', v.code);
  },
}));

import { codicePseudonimo, pseudonimo } from './pseudonym';

describe('pseudonimo', () => {
  it("stesso evento e posto, stesso codice; cambia con il posto e con l'evento", () => {
    const a = codicePseudonimo('e1', 'reg-1');
    expect(a).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);
    expect(codicePseudonimo('e1', 'reg-1')).toBe(a);
    expect(codicePseudonimo('e1', 'reg-2')).not.toBe(a);
    expect(codicePseudonimo('e2', 'reg-1')).not.toBe(a);
  });

  it('nella lingua predefinita del sito, con ripiego', async () => {
    impostazioni.defaultLocale = 'it';
    expect(await pseudonimo('e1', 'reg-1')).toBe(
      `Partecipante-${codicePseudonimo('e1', 'reg-1')}`
    );
    impostazioni.defaultLocale = 'en';
    expect(await pseudonimo('e1', 'reg-1')).toBe(
      `Participant-${codicePseudonimo('e1', 'reg-1')}`
    );
    impostazioni.defaultLocale = 'xx';
    expect(await pseudonimo('e1', 'reg-1')).toMatch(/^Partecipante-/);
    // Una parola sola: le menzioni in chat si riconoscono dalla prima.
    expect(await pseudonimo('e1', 'reg-1')).not.toMatch(/\s/);
  });
});

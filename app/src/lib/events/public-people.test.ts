import { describe, expect, it, vi } from 'vitest';

import { logoPubblico, ordinaPersone, ruoloPubblico, sitoPubblico, entiEPersonePubblici } from './public-people';

describe('logoPubblico', () => {
  it('tiene i loghi serviti dall\'app, come percorso', () => {
    expect(logoPubblico('https://webinar.example.gov.it/api/assets/images/logo.png')).toBe(
      '/api/assets/images/logo.png',
    );
    expect(logoPubblico('/api/assets/images/logo.png')).toBe('/api/assets/images/logo.png');
  });

  it('scarta un logo esterno', () => {
    expect(logoPubblico('https://cdn.example.com/logo.png')).toBeNull();
    expect(logoPubblico(null)).toBeNull();
  });
});

describe('sitoPubblico', () => {
  it('accetta solo indirizzi web', () => {
    expect(sitoPubblico('https://ente.example.gov.it')).toBe('https://ente.example.gov.it/');
    expect(sitoPubblico('javascript:alert(1)')).toBeNull();
  });
});

describe('ruoloPubblico e ordinaPersone', () => {
  it('organizzatori, poi moderatori, poi relatori', () => {
    const p = (name: string, role: 'MODERATOR' | 'SPEAKER', organizer = false) => ({
      name,
      role: ruoloPubblico({ role, organizer }),
      organization: null,
      logoUrl: null,
    });
    const ordinate = ordinaPersone([p('Zeno', 'SPEAKER'), p('Bea', 'MODERATOR'), p('Ada', 'MODERATOR', true)]);
    expect(ordinate.map((x) => [x.name, x.role])).toEqual([
      ['Ada', 'organizer'],
      ['Bea', 'moderator'],
      ['Zeno', 'speaker'],
    ]);
  });
});

const base = {
  organizers: [{ name: 'Ente A', logoUrl: '/api/assets/a.png', websiteUrl: 'javascript:alert(1)' }],
  additionalMods: [
    { name: 'cifrato:Relatore 1', role: 'SPEAKER' as const, organizer: false, organization: 'Ente B', organizationLogoUrl: 'https://altro.example/logo.png' },
    { name: 'cifrato:Conduttore 1', role: 'MODERATOR' as const, organizer: false, organization: null, organizationLogoUrl: null },
  ],
  moderatorName: 'Organizzatrice',
  moderatorPublicListed: false,
  moderatorOrganization: null,
  moderatorOrganizationLogoUrl: null,
};
const decifra = vi.fn((v: string) => v.replace('cifrato:', ''));

describe('entiEPersonePubblici', () => {
  it('decifra i nomi, ordina per ruolo e tiene solo loghi e siti sicuri', () => {
    const { enti, persone } = entiEPersonePubblici(base, decifra);
    expect(enti).toEqual([{ name: 'Ente A', logoUrl: '/api/assets/a.png', websiteUrl: null }]);
    expect(persone.map((p) => [p.name, p.role])).toEqual([
      ['Conduttore 1', 'moderator'],
      ['Relatore 1', 'speaker'],
    ]);
    expect(persone[1]?.logoUrl).toBeNull();
  });

  it('il moderatore principale compare solo se pubblicato', () => {
    expect(entiEPersonePubblici(base, decifra).persone.some((p) => p.name === 'Organizzatrice')).toBe(false);
    const pubblicato = entiEPersonePubblici({ ...base, moderatorPublicListed: true }, decifra);
    expect(pubblicato.persone[0]).toMatchObject({ name: 'Organizzatrice', role: 'organizer' });
  });
});

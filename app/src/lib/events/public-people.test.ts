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
      photoUrl: null,
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
    { id: 'g-relatore-1', name: 'cifrato:Relatore 1', role: 'SPEAKER' as const, organizer: false, organization: 'Ente B', organizationLogoUrl: 'https://altro.example/logo.png', photoId: 'foto-relatore' },
    { id: 'g-conduttore-1', name: 'cifrato:Conduttore 1', role: 'MODERATOR' as const, organizer: false, organization: null, organizationLogoUrl: null, photoId: null },
  ],
  agendaEnabled: false,
  agendaItems: [] as Array<{ speakerGrantId: string | null; speakerPrimary: boolean }>,
  moderatorName: 'Organizzatrice',
  moderatorPublicListed: false,
  moderatorOrganization: null,
  moderatorOrganizationLogoUrl: null,
  moderatorPhotoId: 'foto-organizzatrice' as string | null,
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

  it('la foto segue la persona: il percorso dell’app, o niente', () => {
    const { persone } = entiEPersonePubblici({ ...base, moderatorPublicListed: true }, decifra);
    expect(persone.map((p) => [p.name, p.photoUrl])).toEqual([
      ['Organizzatrice', '/api/avatar/person/foto-organizzatrice'],
      ['Conduttore 1', null],
      ['Relatore 1', '/api/avatar/person/foto-relatore'],
    ]);
  });

  it('la foto dell’organizzatore principale non presentato non esce da nessuna parte', () => {
    // Le concessioni arrivano già filtrate dalla query (publicListed); il
    // moderatore principale è filtrato qui, e con lui la sua foto.
    const { persone } = entiEPersonePubblici(base, decifra);
    expect(persone.some((p) => p.photoUrl === '/api/avatar/person/foto-organizzatrice')).toBe(false);
  });
});

describe('l’ordine del programma', () => {
  const relatore = (id: string, nome: string) => ({
    id,
    name: `cifrato:${nome}`,
    role: 'SPEAKER' as const,
    organizer: false,
    organization: null,
    organizationLogoUrl: null,
    photoId: null,
  });
  const evento = {
    ...base,
    additionalMods: [
      relatore('g-anna', 'Anna'),
      relatore('g-bruno', 'Bruno'),
      relatore('g-carla', 'Carla'),
      relatore('g-dario', 'Dario'),
      { ...relatore('g-mod', 'Moderatore'), role: 'MODERATOR' as const },
    ],
    agendaEnabled: true,
    // Carla apre, poi Bruno (due volte: conta il primo intervento), poi
    // l'organizzatrice principale.
    agendaItems: [
      { speakerGrantId: 'g-carla', speakerPrimary: false },
      { speakerGrantId: 'g-bruno', speakerPrimary: false },
      { speakerGrantId: null, speakerPrimary: true },
      { speakerGrantId: 'g-bruno', speakerPrimary: false },
    ],
  };

  it('a parità di ruolo, nell’ordine del primo intervento; chi non interviene dopo, per nome', () => {
    const { persone } = entiEPersonePubblici(evento, decifra);
    expect(persone.map((p) => [p.name, p.role])).toEqual([
      ['Moderatore', 'moderator'],
      ['Carla', 'speaker'],
      ['Bruno', 'speaker'],
      ['Anna', 'speaker'],
      ['Dario', 'speaker'],
    ]);
  });

  it('il ruolo viene prima del programma', () => {
    const { persone } = entiEPersonePubblici(
      {
        ...evento,
        moderatorPublicListed: true,
        agendaItems: [
          { speakerGrantId: 'g-dario', speakerPrimary: false },
          { speakerGrantId: 'g-mod', speakerPrimary: false },
          { speakerGrantId: null, speakerPrimary: true },
        ],
      },
      decifra,
    );
    expect(persone.map((p) => p.name)).toEqual([
      'Organizzatrice',
      'Moderatore',
      'Dario',
      'Anna',
      'Bruno',
      'Carla',
    ]);
  });

  it('ad agenda spenta resta l’ordine alfabetico', () => {
    const { persone } = entiEPersonePubblici({ ...evento, agendaEnabled: false }, decifra);
    expect(persone.filter((p) => p.role === 'speaker').map((p) => p.name)).toEqual([
      'Anna',
      'Bruno',
      'Carla',
      'Dario',
    ]);
  });

  it('la chiave d’ordine non esce: le persone hanno la forma di sempre', () => {
    const { persone } = entiEPersonePubblici(evento, decifra);
    for (const p of persone) expect(Object.keys(p).sort()).toEqual(['logoUrl', 'name', 'organization', 'photoUrl', 'role']);
  });
});

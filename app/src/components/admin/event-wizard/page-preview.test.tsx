import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

vi.mock('@/i18n/navigation', () => ({
  percorso: (p: string) => p,
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import PagePreview, { datiAnteprima } from './page-preview';
import type { AgendaDraft } from './programme-plan';

/**
 * L'anteprima della pagina nella creazione dell'evento: gli stessi dati che
 * la pagina pubblica mostrerebbe, presi dal modulo.
 */
const ETICHETTE = [
  { slug: 'riuso', name: { it: 'Riuso' }, color: '#0066CC' },
  { slug: 'dati', name: { it: 'Dati' }, color: null },
];

const MODULO = {
  title: { it: 'Ciclo | Il primo incontro', en: 'Series | The first meeting' },
  description: { it: 'Una **descrizione** con un [link](https://example.org).' },
  coverImageUrl: '/api/assets/image/copertina.jpg',
  imageUrl: '/api/assets/image/copertina.jpg',
  tagSlugs: ['riuso', 'sconosciuta'],
  organizers: [
    { name: 'Comune di Esempio', logoUrl: null, websiteUrl: 'https://comune.example.it' },
  ],
  moderators: [
    {
      name: 'Anna',
      email: 'anna@example.org',
      personId: null,
      organizer: false,
      organization: null,
      organizationLogoUrl: null,
      publicListed: true,
    },
    {
      name: 'Nascosta',
      email: 'n@example.org',
      personId: null,
      organizer: false,
      organization: null,
      organizationLogoUrl: null,
      publicListed: false,
    },
  ],
  speakers: [
    {
      name: 'Luca',
      email: 'luca@example.org',
      personId: null,
      organization: 'Ente',
      organizationLogoUrl: null,
      publicListed: true,
      photoId: '22222222-2222-4222-8222-222222222222',
    },
  ],
  moderatorName: 'Chi organizza',
  moderatorPublicListed: true,
  moderatorOrganization: null,
  moderatorOrganizationLogoUrl: null,
  moderatorPhotoId: null as string | null,
  agendaEnabled: false,
  agenda: [] as AgendaDraft[],
};

const INIZIO = new Date('2026-10-29T09:00:00Z');
const FINE = new Date('2026-10-29T10:00:00Z');

describe('datiAnteprima', () => {
  it('prende titolo e descrizione nella lingua, le etichette scelte e le persone pubblicate', () => {
    const d = datiAnteprima(MODULO, {
      locale: 'it',
      tags: ETICHETTE,
      startsAt: INIZIO,
      endsAt: FINE,
      parseTitleKicker: true,
    });
    expect(d.title).toBe('Ciclo | Il primo incontro');
    expect(d.tags.map((t) => t.slug)).toEqual(['riuso']);
    expect(d.persone.enti.map((e) => e.name)).toEqual(['Comune di Esempio']);
    // Chi non e' pubblicato non compare; prima chi organizza, poi chi conduce, poi chi parla.
    expect(d.persone.persone.map((p) => [p.name, p.role])).toEqual([
      ['Chi organizza', 'organizer'],
      ['Anna', 'moderator'],
      ['Luca', 'speaker'],
    ]);
    // La foto caricata compare come nella pagina; senza, le iniziali.
    expect(d.persone.persone.map((p) => p.photoUrl)).toEqual([
      null,
      null,
      '/api/avatar/person/22222222-2222-4222-8222-222222222222',
    ]);
  });

  it("nella lingua dell'interfaccia, con il ripiego della pagina; i campi scritti a mano solo senza persone", () => {
    const d = datiAnteprima(
      {
        ...MODULO,
        title: { it: 'Titolo italiano', en: '' },
        speakers: [],
        organizers: [],
      },
      {
        locale: 'en',
        tags: ETICHETTE,
        startsAt: INIZIO,
        endsAt: FINE,
        parseTitleKicker: false,
        campiLiberi: {
          speakersInfo: { it: 'Relatrice libera' },
          organizerName: 'Ente libero',
        },
      }
    );
    expect(d.title).toBe('Titolo italiano');
    // Nessun relatore strutturato e nessun ente: la pagina mostra i campi liberi.
    expect(d.relatoriLiberi).toBe('Relatrice libera');
    expect(d.organizzatoreLibero).toBe('Ente libero');
    const conPersone = datiAnteprima(MODULO, {
      locale: 'it',
      tags: ETICHETTE,
      startsAt: INIZIO,
      endsAt: FINE,
      parseTitleKicker: false,
      campiLiberi: {
        speakersInfo: { it: 'Relatrice libera' },
        organizerName: 'Ente libero',
      },
    });
    expect(conPersone.relatoriLiberi).toBeNull();
    expect(conPersone.organizzatoreLibero).toBeNull();
  });

  it('il programma come nella pagina: in ordine, chi interviene solo se presentato, e le persone nel suo ordine', () => {
    const d = datiAnteprima(
      {
        ...MODULO,
        speakers: [
          ...MODULO.speakers,
          { name: 'Bruno', email: 'bruno@example.org', personId: null, organization: null, organizationLogoUrl: null, publicListed: true, photoId: null },
        ],
        agendaEnabled: true,
        agenda: [
          { key: 'r1', label: 'Apertura', minutes: '10', speakerKey: 'primary' },
          { key: 'r2', label: 'Un caso', minutes: '20', speakerKey: 'e:n@example.org' },
          { key: 'r3', label: '  ', minutes: '5', speakerKey: null },
          { key: 'r4', label: 'Intervento', minutes: '', speakerKey: 'e:luca@example.org' },
          { key: 'r5', label: 'Saluti', minutes: '5', speakerKey: 'e:bruno@example.org' },
        ],
      },
      { locale: 'it', tags: ETICHETTE, startsAt: INIZIO, endsAt: FINE, parseTitleKicker: false },
    );
    expect(d.programma.map((v) => [v.label, v.plannedMinutes, v.speaker?.name ?? null])).toEqual([
      ['Apertura', 10, 'Chi organizza'],
      // Nascosta non e' presentata: solo l'argomento.
      ['Un caso', 20, null],
      ['Intervento', null, 'Luca'],
      ['Saluti', 5, 'Bruno'],
    ]);
    expect(d.programma[2]?.speaker?.photoUrl).toBe('/api/avatar/person/22222222-2222-4222-8222-222222222222');
    // Bruno interviene dopo Luca: fra i relatori viene dopo, anche se il nome
    // verrebbe prima.
    expect(d.persone.persone.filter((p) => p.role === 'speaker').map((p) => p.name)).toEqual(['Luca', 'Bruno']);
    // Ad agenda spenta niente programma, e l'ordine torna alfabetico.
    const spenta = datiAnteprima(
      { ...MODULO, agendaEnabled: false, agenda: [{ key: 'r1', label: 'Apertura', minutes: '', speakerKey: null }] },
      { locale: 'it', tags: ETICHETTE, startsAt: INIZIO, endsAt: FINE, parseTitleKicker: false },
    );
    expect(spenta.programma).toEqual([]);
  });

  it('un modulo con campi mancanti non la ferma', () => {
    const d = datiAnteprima(
      { title: { it: 'Solo il titolo' } } as unknown as typeof MODULO,
      {
        locale: 'it',
        tags: ETICHETTE,
        startsAt: null,
        endsAt: null,
        parseTitleKicker: false,
      }
    );
    expect(d.title).toBe('Solo il titolo');
    expect(d.tags).toEqual([]);
    expect(d.persone.persone).toEqual([]);
  });
});

describe('PagePreview', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    // Uno schermo largo: la copia ridotta si disegna.
    window.matchMedia = ((q: string) => ({
      matches: true,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("mostra la pagina con il sopratitolo; la versione ridotta e' inerte e le etichette non portano altrove", () => {
    const dati = datiAnteprima(MODULO, {
      locale: 'it',
      tags: ETICHETTE,
      startsAt: INIZIO,
      endsAt: FINE,
      parseTitleKicker: true,
    });
    act(() => {
      root.render(
        <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
          <PagePreview dati={dati} />
        </NextIntlClientProvider>
      );
    });
    const ridotta = container.querySelector('.anteprima-pagina__ridotta')!;
    expect(ridotta.hasAttribute('inert')).toBe(true);
    expect(ridotta.querySelector('.event-title-kicker')?.textContent).toBe('Ciclo');
    expect(ridotta.textContent).toContain('Riuso');
    expect(ridotta.textContent).toContain('Comune di Esempio');
    // La foto della persona, nel cerchio come nella pagina.
    const foto = ridotta.querySelector<HTMLImageElement>('img.event-person__photo');
    expect(foto?.getAttribute('src')).toBe('/api/avatar/person/22222222-2222-4222-8222-222222222222');
    // L'etichetta e' testo, non un link all'elenco degli eventi.
    expect(
      Array.from(ridotta.querySelectorAll('a')).some((a) => a.textContent === 'Riuso')
    ).toBe(false);
    expect(container.textContent).toContain(messages.admin.wizard.preview.note);
  });

  it('il programma compare sotto la descrizione, con gli orari dall inizio', () => {
    const dati = datiAnteprima(
      {
        ...MODULO,
        agendaEnabled: true,
        agenda: [
          { key: 'r1', label: 'Apertura', minutes: '15', speakerKey: 'e:luca@example.org' },
          { key: 'r2', label: 'Domande', minutes: '30', speakerKey: null },
        ],
      },
      { locale: 'it', tags: ETICHETTE, startsAt: INIZIO, endsAt: FINE, parseTitleKicker: false },
    );
    act(() => {
      root.render(
        <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
          <PagePreview dati={dati} />
        </NextIntlClientProvider>
      );
    });
    const ridotta = container.querySelector('.anteprima-pagina__ridotta')!;
    const voci = Array.from(ridotta.querySelectorAll('.event-programma__voce'));
    expect(voci).toHaveLength(2);
    expect(Array.from(ridotta.querySelectorAll('.event-programma__quando time')).map((t) => t.textContent)).toEqual([
      '10:00',
      '10:15',
    ]);
    expect(voci[0]?.textContent).toContain('Luca');
    expect(ridotta.querySelector('.event-programma__nota')?.textContent).toContain('45 minuti');
  });

  it("senza titolo ne' data dice che cosa manca", () => {
    const dati = datiAnteprima(
      { ...MODULO, title: { it: '' }, description: { it: '' } },
      {
        locale: 'it',
        tags: ETICHETTE,
        startsAt: null,
        endsAt: null,
        parseTitleKicker: true,
      }
    );
    act(() => {
      root.render(
        <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
          <PagePreview dati={dati} />
        </NextIntlClientProvider>
      );
    });
    const p = messages.admin.wizard.preview;
    expect(container.textContent).toContain(p.titlePlaceholder);
    expect(container.textContent).toContain(p.descriptionPlaceholder);
    expect(container.textContent).toContain(p.noteNoDate);
  });
});

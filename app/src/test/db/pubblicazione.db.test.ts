// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * La destinazione della registrazione e la guardia di pubblicazione su un
 * database vero: cio' che le rotte scrivono, cio' che si rifiuta e cio' che resta
 * com'era. Nessun finto, salvo i cookie della richiesta.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as duplica } from '@/app/api/admin/events/[id]/duplicate/route';
import { PATCH as pubblica } from '@/app/api/admin/publications/[id]/route';
import { GET as leggi, PUT as aggiorna } from '@/app/api/events/[param]/route';
import { POST as creaChiamata } from '@/app/api/events/instant/route';
import { POST as crea } from '@/app/api/events/route';
import { prisma } from '@/lib/db';
import { voceNelVideo } from '@/lib/recording/availability';
import {
  consensoCopre,
  consensoOra,
  destinazioneDelTesto,
} from '@/lib/recording/destination';

import {
  creaEvento,
  creaIscrizione,
  creaSessione,
  entraCome,
  esci,
  richiesta,
  svuotaDatabase,
} from './fixtures';

const YOUTUBE = 'https://www.youtube.com/watch?v=abc';
const FILE = 'https://storage.example.com/recordings/sala.mp4';
const NON_COPERTA = { code: 'RECORDING_DESTINATION_NOT_COVERED' };
const RISERVATO = {
  recordingEnabled: true,
  recordingDestination: 'REGISTRANTS',
  recordingAudience: 'REGISTRANTS',
} as const;

const CORPO = {
  title: { it: 'Evento di prova' },
  description: { it: 'Descrizione' },
  startsAt: '2030-03-01T09:00:00.000Z',
  endsAt: '2030-03-01T10:00:00.000Z',
  timezone: 'Europe/Rome',
  maxParticipants: 100,
  moderatorName: 'Moderatore 1',
};

function modifica(evento: { id: string; moderatorToken: string }, corpo: unknown) {
  return aggiorna(
    richiesta(`/api/events/${evento.id}`, 'PUT', corpo, evento.moderatorToken) as never,
    { params: Promise.resolve({ param: evento.id }) }
  );
}

function modificaPubblicazione(id: string, corpo: unknown) {
  return pubblica(richiesta(`/api/admin/publications/${id}`, 'PATCH', corpo) as never, {
    params: Promise.resolve({ id }),
  });
}

const riga = (id: string) => prisma.event.findUniqueOrThrow({ where: { id } });

/** Un indirizzo per richiesta: la creazione e' limitata per indirizzo. */
let ultimo = 0;
function creazione(corpo: unknown) {
  const base = richiesta('/api/events', 'POST', corpo);
  base.headers.set('x-forwarded-for', `10.30.0.${(ultimo += 1)}`);
  return crea(base as never, { params: Promise.resolve({}) });
}

beforeEach(async () => {
  await svuotaDatabase();
  await entraCome('ADMIN');
});

describe('alla creazione', () => {
  it('un null esplicito su un evento che registra non resta nullo', async () => {
    const r = await creazione({
      ...CORPO,
      recordingEnabled: true,
      recordingDestination: null,
    });
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as { id: string };
    expect(await riga(id)).toMatchObject({
      recordingDestination: 'REGISTRANTS',
      recordingAudience: 'REGISTRANTS',
    });
  });

  it('senza registrazione anche un null esplicito resta nullo, e le domande restano', async () => {
    const r = await creazione({
      ...CORPO,
      recordingEnabled: false,
      recordingDestination: null,
      postEventShowQA: true,
    });
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as { id: string };
    expect(await riga(id)).toMatchObject({
      recordingEnabled: false,
      recordingDestination: null,
      recordingAudience: 'PUBLIC',
      postEventShowQA: true,
    });
  });

  it('senza registrazione la destinazione resta nulla', async () => {
    const r = await creazione({ ...CORPO, recordingEnabled: false });
    const { id } = (await r.json()) as { id: string };
    expect(await riga(id)).toMatchObject({
      recordingDestination: null,
      recordingAudience: 'PUBLIC',
    });
  });

  it('una chiamata rapida registra e resta senza destinazione', async () => {
    const r = await creaChiamata(
      richiesta('/api/events/instant', 'POST', {
        title: { it: 'Chiamata' },
        moderatorName: 'Moderatore 1',
      }) as never,
      { params: Promise.resolve({}) }
    );
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as { id: string };
    expect(await riga(id)).toMatchObject({
      recordingEnabled: true,
      recordingDestination: null,
      eventType: 'INSTANT',
    });
  });
});

describe('la copia', () => {
  it('di un evento che registra senza destinazione parte riservata', async () => {
    const originale = await creaEvento({ recordingEnabled: true, status: 'ENDED' });
    const r = await duplica(
      richiesta(`/api/admin/events/${originale.id}/duplicate`, 'POST') as never,
      { params: Promise.resolve({ id: originale.id }) }
    );
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as { id: string };
    expect(await riga(id)).toMatchObject({
      status: 'DRAFT',
      recordingDestination: 'REGISTRANTS',
      recordingAudience: 'REGISTRANTS',
    });
    expect(await riga(originale.id)).toMatchObject({
      recordingDestination: null,
      recordingAudience: 'PUBLIC',
    });
  });

  it('di un evento che non registra resta senza destinazione', async () => {
    const originale = await creaEvento({ recordingEnabled: false, status: 'ENDED' });
    const r = await duplica(
      richiesta(`/api/admin/events/${originale.id}/duplicate`, 'POST') as never,
      { params: Promise.resolve({ id: originale.id }) }
    );
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as { id: string };
    expect(await riga(id)).toMatchObject({
      recordingEnabled: false,
      recordingDestination: null,
      recordingAudience: 'PUBLIC',
    });
  });

  it.each([
    ['chiamata rapida', 'INSTANT'],
    ['importazione storica', 'LEGACY'],
  ] as const)('di una %s resta senza destinazione', async (_n, eventType) => {
    const originale = await creaEvento({ eventType, recordingEnabled: true, status: 'ENDED' });
    const r = await duplica(
      richiesta(`/api/admin/events/${originale.id}/duplicate`, 'POST') as never,
      { params: Promise.resolve({ id: originale.id }) }
    );
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as { id: string };
    expect(await riga(id)).toMatchObject({
      eventType,
      recordingDestination: null,
      recordingAudience: 'PUBLIC',
    });
  });

  it('di un evento riservato resta riservata, con il pubblico allineato', async () => {
    const originale = await creaEvento({ ...RISERVATO, status: 'ENDED' });
    const r = await duplica(
      richiesta(`/api/admin/events/${originale.id}/duplicate`, 'POST') as never,
      { params: Promise.resolve({ id: originale.id }) }
    );
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as { id: string };
    expect(await riga(id)).toMatchObject(RISERVATO);
  });
});

describe('la modifica di un evento riservato', () => {
  it.each([
    ['il pubblico per tutti', { recordingAudience: 'PUBLIC' }],
    ['un video esterno', { youtubeUrl: YOUTUBE }],
    ['il recupero in diretta', { tempRecordingUrl: FILE }],
    ['togliere la destinazione', { recordingDestination: null }],
  ])('rifiuta %s e lascia la riga com’era', async (_n, corpo) => {
    const evento = await creaEvento({ ...RISERVATO, status: 'ENDED' });
    const r = await modifica(evento, corpo);
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject(NON_COPERTA);
    expect(await riga(evento.id)).toMatchObject({ ...RISERVATO, youtubeUrl: null });
  });

  it.each([
    ['la libreria', { libraryListed: true }],
    ['la pagina', { postEventPublic: true }],
    ['la chiusura', { status: 'ENDED', postEventPublic: true, libraryListed: true }],
    ['il file', { recordingUrl: FILE, recordingPublished: true }],
  ])('accetta %s', async (_n, corpo) => {
    const evento = await creaEvento({ ...RISERVATO, status: 'LIVE' });
    expect((await modifica(evento, corpo)).status).toBe(200);
  });

  it('il video caricato si pubblica per gli iscritti', async () => {
    const evento = await creaEvento({ ...RISERVATO, status: 'ENDED' });
    expect((await modificaPubblicazione(evento.id, { recordingUrl: FILE })).status).toBe(
      200
    );
    expect(await riga(evento.id)).toMatchObject({
      ...RISERVATO,
      recordingUrl: FILE,
      recordingPublished: true,
    });
  });

  it('dalla pubblicazione il video esterno si ferma', async () => {
    const evento = await creaEvento({ ...RISERVATO, status: 'ENDED' });
    const r = await modificaPubblicazione(evento.id, { youtubeUrl: YOUTUBE });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject(NON_COPERTA);
    expect((await riga(evento.id)).youtubeUrl).toBeNull();
  });
});

describe('il cambio di destinazione', () => {
  it('prima della sala si allarga', async () => {
    const evento = await creaEvento({ ...RISERVATO, status: 'PUBLISHED' });
    expect((await modifica(evento, { recordingDestination: 'PUBLIC' })).status).toBe(200);
    expect(await riga(evento.id)).toMatchObject({
      recordingDestination: 'PUBLIC',
      recordingAudience: 'PUBLIC',
    });
  });

  it('con una sessione gia’ chiusa non si allarga, e si restringe', async () => {
    const evento = await creaEvento({ ...RISERVATO, status: 'PUBLISHED' });
    await creaSessione(evento.id, { endedAt: new Date() });
    const r = await modifica(evento, { recordingDestination: 'PUBLIC' });
    expect(r.status).toBe(409);
    expect(await riga(evento.id)).toMatchObject(RISERVATO);

    const pubblico = await creaEvento({
      recordingEnabled: true,
      recordingDestination: 'PUBLIC',
      recordingAudience: 'PUBLIC',
      status: 'PUBLISHED',
    });
    await creaSessione(pubblico.id, { endedAt: new Date() });
    expect(
      (await modifica(pubblico, { recordingDestination: 'REGISTRANTS' })).status
    ).toBe(200);
    expect(await riga(pubblico.id)).toMatchObject(RISERVATO);
  });

  it('a evento concluso, con il video esterno gia’ presente, si restringe', async () => {
    const evento = await creaEvento({
      recordingEnabled: true,
      recordingDestination: 'PUBLIC',
      recordingAudience: 'PUBLIC',
      recordingPublished: true,
      recordingUrl: FILE,
      youtubeUrl: YOUTUBE,
      status: 'ENDED',
    });
    expect((await modifica(evento, { recordingDestination: 'REGISTRANTS' })).status).toBe(
      200
    );
    expect(await riga(evento.id)).toMatchObject({
      ...RISERVATO,
      youtubeUrl: YOUTUBE,
      recordingPublished: true,
    });
  });
});

describe('un evento senza destinazione', () => {
  it('non si blocca, e la destinazione resta nulla', async () => {
    const evento = await creaEvento({
      recordingEnabled: true,
      recordingAudience: 'REGISTRANTS',
      status: 'ENDED',
    });
    const r = await modifica(evento, {
      recordingAudience: 'PUBLIC',
      recordingPublished: true,
      youtubeUrl: YOUTUBE,
    });
    expect(r.status).toBe(200);
    expect(await riga(evento.id)).toMatchObject({
      recordingDestination: null,
      recordingAudience: 'PUBLIC',
      recordingPublished: true,
      youtubeUrl: YOUTUBE,
    });
  });

  it('che comincia a registrare parte riservato', async () => {
    const evento = await creaEvento({ recordingEnabled: false, status: 'PUBLISHED' });
    expect((await modifica(evento, { recordingEnabled: true })).status).toBe(200);
    expect(await riga(evento.id)).toMatchObject(RISERVATO);
  });

  describe('con un link di conduzione, senza sessione', () => {
    beforeEach(esci);

    it('accendere la registrazione non si blocca, e parte riservata', async () => {
      const evento = await creaEvento({ recordingEnabled: false, status: 'PUBLISHED' });
      const r = await modifica(evento, { recordingEnabled: true });
      expect(r.status).toBe(200);
      expect(await riga(evento.id)).toMatchObject(RISERVATO);
    });

    it('anche con gente iscritta: il consenso senza destinazione non copre', async () => {
      const evento = await creaEvento({ recordingEnabled: false, status: 'PUBLISHED' });
      const iscrizione = await creaIscrizione(evento.id);
      expect((await modifica(evento, { recordingEnabled: true })).status).toBe(200);
      expect(await riga(evento.id)).toMatchObject(RISERVATO);
      const dopo = await prisma.registration.findUniqueOrThrow({
        where: { id: iscrizione.id },
      });
      expect(consensoCopre(dopo.consentRecordingDestination, RISERVATO.recordingDestination)).toBe(
        false
      );
    });

    it('scegliere la destinazione resta allo staff', async () => {
      const evento = await creaEvento({ recordingEnabled: false, status: 'PUBLISHED' });
      const r = await modifica(evento, {
        recordingEnabled: true,
        recordingDestination: 'PUBLIC',
      });
      expect(r.status).toBe(403);
      expect(await riga(evento.id)).toMatchObject({
        recordingEnabled: false,
        recordingDestination: null,
      });
    });

    it('un evento che registrava gia resta senza destinazione', async () => {
      const evento = await creaEvento({ recordingEnabled: true, status: 'PUBLISHED' });
      const r = await modifica(evento, { recordingEnabled: true, maxParticipants: 50 });
      expect(r.status).toBe(200);
      expect(await riga(evento.id)).toMatchObject({
        recordingDestination: null,
        recordingAudience: 'PUBLIC',
        maxParticipants: 50,
      });
    });

    it('una chiamata rapida resta senza destinazione', async () => {
      const evento = await creaEvento({
        eventType: 'INSTANT',
        recordingEnabled: false,
        status: 'PUBLISHED',
      });
      expect((await modifica(evento, { recordingEnabled: true })).status).toBe(200);
      expect(await riga(evento.id)).toMatchObject({
        recordingEnabled: true,
        recordingDestination: null,
      });
    });

    it('a sala aperta la registrazione non si accende, e la destinazione non cambia', async () => {
      const evento = await creaEvento({ recordingEnabled: false, status: 'LIVE' });
      const r = await modifica(evento, { recordingEnabled: true });
      expect(r.status).toBe(200);
      expect(await riga(evento.id)).toMatchObject({
        recordingEnabled: false,
        recordingDestination: null,
      });
    });
  });

  it('che comincia a registrare caricando un file parte riservato', async () => {
    const evento = await creaEvento({ recordingEnabled: false, status: 'PUBLISHED' });
    expect((await modificaPubblicazione(evento.id, { recordingUrl: FILE })).status).toBe(
      200
    );
    expect(await riga(evento.id)).toMatchObject({
      ...RISERVATO,
      recordingUrl: FILE,
      recordingPublished: true,
    });

    // A sala mai aperta si puo' ancora allargare, e lo fa lo staff.
    expect(
      (await modifica(evento, { recordingDestination: 'PUBLIC' })).status
    ).toBe(200);
    expect(await riga(evento.id)).toMatchObject({
      recordingDestination: 'PUBLIC',
      recordingAudience: 'PUBLIC',
    });
  });

  it('gia’ concluso, con il file caricato pubblica senza destinazione', async () => {
    const evento = await creaEvento({ recordingEnabled: false, status: 'ENDED' });
    expect((await modificaPubblicazione(evento.id, { recordingUrl: FILE })).status).toBe(
      200
    );
    expect(await riga(evento.id)).toMatchObject({
      recordingDestination: null,
      recordingAudience: 'PUBLIC',
      recordingEnabled: true,
      recordingPublished: true,
    });
    // Resta allargabile: nessun rifiuto, come gli eventi che registravano gia'.
    expect((await modifica(evento, { recordingAudience: 'PUBLIC' })).status).toBe(200);
  });

  it.each([
    ['una chiamata rapida', { eventType: 'INSTANT', recordingEnabled: false }],
    ['un evento storico', { eventType: 'LEGACY', recordingEnabled: false }],
    ['un evento che registrava gia’', { recordingEnabled: true }],
  ] as const)('%s con il file caricato resta senza destinazione', async (_n, campi) => {
    const evento = await creaEvento({ ...campi, status: 'ENDED' });
    expect((await modificaPubblicazione(evento.id, { recordingUrl: FILE })).status).toBe(
      200
    );
    expect(await riga(evento.id)).toMatchObject({
      recordingDestination: null,
      recordingAudience: 'PUBLIC',
      recordingEnabled: true,
      recordingUrl: FILE,
    });
  });
});

describe('dove il video della sala non c e', () => {
  // Il Jitsi del chart senza Jibri: solo tracce, voce assente.
  beforeEach(() => {
    vi.stubEnv('JITSI_WEB_INTERNAL_URL', 'http://jitsi-web.interno');
    vi.stubEnv('JIBRI_HEALTH_URL', '');
    vi.stubEnv('RECORDER_CONTROLLER_URL', 'http://controller.interno');
  });
  afterEach(() => vi.unstubAllEnvs());

  async function eventoNuovo() {
    const r = await creazione({ ...CORPO, recordingEnabled: true, recordingDestination: null });
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as { id: string };
    return prisma.event.findUniqueOrThrow({ where: { id } });
  }

  it('un evento nuovo che registra parte riservato, anche con un null esplicito', async () => {
    expect(await eventoNuovo()).toMatchObject(RISERVATO);
  });

  it('un evento che accende la registrazione parte riservato', async () => {
    const evento = await creaEvento({ recordingEnabled: false, status: 'PUBLISHED' });
    expect((await modifica(evento, { recordingEnabled: true })).status).toBe(200);
    expect(await riga(evento.id)).toMatchObject(RISERVATO);
  });

  it('una copia di un evento vecchio che registrava parte riservata', async () => {
    const originale = await creaEvento({ recordingEnabled: true, status: 'ENDED' });
    const r = await duplica(
      richiesta(`/api/admin/events/${originale.id}/duplicate`, 'POST') as never,
      { params: Promise.resolve({ id: originale.id }) }
    );
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as { id: string };
    expect(await riga(id)).toMatchObject(RISERVATO);
  });

  it('un file caricato su un evento spento mai aperto e un video, e parte riservato', async () => {
    const evento = await creaEvento({ recordingEnabled: false, status: 'PUBLISHED' });
    expect((await modificaPubblicazione(evento.id, { recordingUrl: FILE })).status).toBe(200);
    expect(await riga(evento.id)).toMatchObject(RISERVATO);
  });

  it('un file caricato su un evento nuovo che registra resta riservato', async () => {
    const evento = await eventoNuovo();
    expect((await modificaPubblicazione(evento.id, { recordingUrl: FILE })).status).toBe(200);
    expect(await riga(evento.id)).toMatchObject({
      ...RISERVATO,
      recordingUrl: FILE,
      recordingPublished: true,
    });
  });

  it('un evento nuovo che registra non accetta un video esterno', async () => {
    const evento = await eventoNuovo();
    const r = await modificaPubblicazione(evento.id, {
      youtubeUrl: 'https://www.youtube.com/watch?v=abc',
    });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject(NON_COPERTA);
  });

  it('se l installazione aggiunge il video, chi ha letto quel testo va richiesto', async () => {
    const evento = await eventoNuovo();
    const iscrizione = await creaIscrizione(evento.id);
    const letto = {
      recordingConsent: true,
      recordingConsentDestination: iscrizione.consentRecordingDestination,
    };
    const inVigore = () => destinazioneDelTesto(evento.recordingDestination, voceNelVideo());

    expect(voceNelVideo()).toBe('assente');
    expect(consensoOra(letto, inVigore())).toBe(true);

    vi.stubEnv('JIBRI_HEALTH_URL', 'http://jibri.interno');
    expect(voceNelVideo()).toBe('fissa');
    expect(consensoOra(letto, inVigore())).toBe(false);
    expect(consensoCopre(iscrizione.consentRecordingDestination, inVigore())).toBe(false);
  });
});

describe('la lettura pubblica', () => {
  const postEventShowQA = async (slug: string) => {
    const r = await leggi(richiesta(`/api/events/${slug}`) as never, {
      params: Promise.resolve({ param: slug }),
    });
    return ((await r.json()) as { postEventShowQA: boolean }).postEventShowQA;
  };

  it('dice se le domande si pubblicano davvero', async () => {
    const riservato = await creaEvento({
      ...RISERVATO,
      status: 'ENDED',
      qaEnabled: true,
      postEventShowQA: true,
    });
    const storico = await creaEvento({
      recordingEnabled: true,
      status: 'ENDED',
      qaEnabled: true,
      postEventShowQA: true,
    });
    expect(await postEventShowQA(riservato.slug)).toBe(false);
    expect(await postEventShowQA(storico.slug)).toBe(true);
    expect((await riga(riservato.id)).postEventShowQA).toBe(true);
  });
});

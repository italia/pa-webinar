// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Il dopo evento su un database vero, dalla pubblicazione a cio' che arriva alla
 * pagina: la registrazione riservata con la pagina privata, dall'avviso al
 * video, e i nomi e le domande che non devono uscire. Finti solo il componente
 * client della pagina e la lingua della richiesta.
 */
import { randomUUID } from 'node:crypto';

import * as React from 'react';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Questa configurazione non ha il plugin React: la pagina compila il JSX in
// chiamate a `React.createElement`.
vi.stubGlobal('React', React);

vi.mock('next-intl/server', () => ({
  getLocale: async () => 'it',
  getTranslations: async () => (_chiave: string, valori: { code: string }) =>
    `Partecipante-${valori.code}`,
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('@/components/events/event-detail-client', () => ({
  default: function EventDetailClientStub() {
    return null;
  },
}));

import EventDetailPage from '@/app/[locale]/events/[slug]/page';
import { GET as arrivoDalLink } from '@/app/api/events/[param]/recording/access/route';
import { GET as video } from '@/app/api/events/[param]/recording/route';
import {
  GET as leggiDomande,
  POST as chiedi,
} from '@/app/api/events/[param]/questions/route';
import EventDetailClient from '@/components/events/event-detail-client';
import { authenticateChatSender } from '@/lib/chat/authenticate';
import { encryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { ensureEventRecap } from '@/lib/events/recap';
import { notifyPublishedRecordings } from '@/lib/events/recording-notify';
import { pseudonimo } from '@/lib/live/pseudonym';
import { buildLiveTimeline } from '@/lib/postprod/live-timeline';
import { issueViewingToken, viewingCookieName } from '@/lib/recording/viewing';
import { ingressoResoconto } from '@/lib/report/input';
import type { ReportMetrics } from '@/lib/report/types';

import { biscotti } from './biscotti';
import {
  creaEvento,
  creaIscrizione,
  entraCome,
  organizza,
  esci,
  richiesta,
  svuotaDatabase,
} from './fixtures';

const VIDEO = 'https://storage.example.com/recordings/sala.mp4';
const ORA = 3_600_000;

const CONCLUSO = {
  status: 'ENDED' as const,
  startsAt: new Date(Date.now() - 4 * ORA),
  endsAt: new Date(Date.now() - 2 * ORA),
};
const RISERVATA = {
  ...CONCLUSO,
  recordingUrl: VIDEO,
  recordingPublished: true,
  recordingPublishedAt: new Date(),
  recordingAudience: 'REGISTRANTS' as const,
  recordingDestination: 'REGISTRANTS' as const,
  recordingNotifyEnabled: true,
  postEventPublic: false,
};

const ctx = (param: string) => ({ params: Promise.resolve({ param }) });

/** Le props che la pagina passa al client, cioe' il payload che arriva al browser. */
async function payload(slug: string, searchParams: Record<string, string> = {}) {
  const albero = (await EventDetailPage({
    params: Promise.resolve({ slug }),
    searchParams: Promise.resolve(searchParams),
  })) as ReactElement<{ children: ReactNode }>;
  const figli = ([] as ReactNode[]).concat(albero.props.children);
  const client = figli.find(
    (f): f is ReactElement<Record<string, unknown>> =>
      isValidElement(f) && f.type === EventDetailClient
  );
  return client!.props;
}

const eventoNel = (props: Record<string, unknown>) =>
  props.event as { recordingUrl: string | null; youtubeUrl: string | null };

beforeEach(async () => {
  await svuotaDatabase();
});

describe('registrazione riservata con la pagina privata', () => {
  it('dall’avviso al video: l’iscritto arriva, gli altri no', async () => {
    const evento = await creaEvento(RISERVATA);
    const iscrizione = await creaIscrizione(evento.id);

    // L'avviso parte, una volta sola, con la pagina privata.
    const opzioni = {
      now: new Date(),
      baseUrl: 'http://localhost',
      siteName: 'PA Webinar',
    };
    expect(await notifyPublishedRecordings(opzioni)).toMatchObject({
      eventsNotified: 1,
      emailsQueued: 1,
    });
    expect(await notifyPublishedRecordings(opzioni)).toMatchObject({ eventsNotified: 0 });

    // Senza il link: pagina 404, video chiuso.
    await expect(payload(evento.slug)).rejects.toThrow('NOT_FOUND');
    expect(
      (
        await video(
          richiesta(`/api/events/${evento.slug}/recording`) as never,
          ctx(evento.slug)
        )
      ).status
    ).toBe(403);

    // Il link dell'avviso posa il cookie e porta alla pagina.
    const token = issueViewingToken(evento.id, iscrizione.id)!;
    const arrivo = await arrivoDalLink(
      richiesta(
        `/api/events/${evento.slug}/recording/access?t=${encodeURIComponent(token)}`
      ) as never,
      ctx(evento.slug)
    );
    expect(arrivo.status).toBe(303);
    const biscotto = (arrivo.headers.get('Set-Cookie') ?? '').split(';')[0]!;
    const uguale = biscotto.indexOf('=');
    biscotti.set(biscotto.slice(0, uguale), biscotto.slice(uguale + 1));

    expect(eventoNel(await payload(evento.slug)).recordingUrl).toBe(`/api/events/${evento.slug}/recording`);
    const risposta = await video(
      richiesta(`/api/events/${evento.slug}/recording`) as never,
      ctx(evento.slug)
    );
    expect(risposta.status).toBe(302);
  });

  it('la pulizia dei dati toglie l’accesso: resta lo staff, in anteprima', async () => {
    const evento = await creaEvento(RISERVATA);
    const iscrizione = await creaIscrizione(evento.id);
    biscotti.set(
      viewingCookieName(evento.id),
      issueViewingToken(evento.id, iscrizione.id)!
    );
    await prisma.registration.delete({ where: { id: iscrizione.id } });

    await expect(payload(evento.slug)).rejects.toThrow('NOT_FOUND');

    await entraCome('ADMIN');
    await organizza(evento.id);
    await expect(payload(evento.slug)).rejects.toThrow('NOT_FOUND');
    const anteprima = await payload(evento.slug, { anteprima: '1' });
    expect(anteprima.previewForStaff).toBe(true);
    esci();
  });

  it('un evento senza destinazione resta com’era', async () => {
    const evento = await creaEvento({
      ...RISERVATA,
      recordingDestination: null,
      recordingNotifyEnabled: true,
    });
    const iscrizione = await creaIscrizione(evento.id);
    biscotti.set(
      viewingCookieName(evento.id),
      issueViewingToken(evento.id, iscrizione.id)!
    );

    await expect(payload(evento.slug)).rejects.toThrow('NOT_FOUND');
    expect(
      await notifyPublishedRecordings({
        now: new Date(),
        baseUrl: 'http://localhost',
        siteName: 'PA Webinar',
      })
    ).toMatchObject({ eventsNotified: 0 });
  });

  it('il link YouTube segue il video, e con il solo link esterno l’avviso aspetta', async () => {
    const youtubeUrl = 'https://www.youtube.com/watch?v=abc';
    const evento = await creaEvento({ ...RISERVATA, postEventPublic: true, youtubeUrl });
    const iscrizione = await creaIscrizione(evento.id);

    expect(eventoNel(await payload(evento.slug)).youtubeUrl).toBeNull();
    biscotti.set(
      viewingCookieName(evento.id),
      issueViewingToken(evento.id, iscrizione.id)!
    );
    expect(eventoNel(await payload(evento.slug)).youtubeUrl).toBe(youtubeUrl);

    await prisma.event.update({
      where: { id: evento.id },
      data: { recordingPublished: false },
    });
    expect(
      await notifyPublishedRecordings({
        now: new Date(),
        baseUrl: 'http://localhost',
        siteName: 'PA Webinar',
      })
    ).toMatchObject({ eventsNotified: 0 });
  });
});

describe('nomi e domande dopo l’evento', () => {
  const NOME = 'Anna Rossi';

  async function eventoConDomande(campi: Parameters<typeof creaEvento>[0] = {}) {
    const evento = await creaEvento({
      ...CONCLUSO,
      postEventShowQA: true,
      postEventShowRecap: true,
      ...campi,
    });
    await prisma.question.create({
      data: {
        eventId: evento.id,
        authorName: NOME,
        text: 'Domanda del pubblico',
        status: 'ANSWERED',
        answeredAt: new Date(),
        upvoteCount: 3,
      },
    });
    await prisma.chatMessage.create({
      data: {
        eventId: evento.id,
        senderId: 'reg-prova',
        senderName: encryptPII(NOME),
        text: encryptPII('Domanda scritta in chat'),
        isQuestion: true,
      },
    });
    return evento;
  }

  it('nel payload pubblico il testo della domanda, mai il nome né la chat', async () => {
    const evento = await eventoConDomande();
    const scritto = JSON.stringify(await payload(evento.slug));
    expect(scritto).toContain('Domanda del pubblico');
    expect(scritto).not.toContain('authorName');
    expect(scritto).not.toContain('chatQuestions');
    expect(scritto).not.toContain(NOME);
    expect(scritto).not.toContain('Domanda scritta in chat');
  });

  describe('ciò che il modello legge per sintesi e resoconto', () => {
    const METRICS = {
      durationSec: 3600,
      agenda: [],
      polls: [],
      words: [],
      feedback: { responses: 0, average: null, items: [] },
    } as unknown as ReportMetrics;
    const ingressi = async (id: string) =>
      JSON.stringify([
        await ingressoResoconto(id, 'it', METRICS),
        await buildLiveTimeline({
          eventId: id,
          t0: new Date(Date.now() - 2 * ORA),
          exact: true,
          until: new Date(),
        }),
      ]);

    it('il testo della chat mai, le domande se la pagina le pubblica', async () => {
      const evento = await eventoConDomande();
      const letto = await ingressi(evento.id);
      expect(letto).toContain('Domanda del pubblico');
      expect(letto).not.toContain('Domanda scritta in chat');
      expect(letto).not.toContain(NOME);
    });

    it('con la registrazione riservata nessun testo di domanda', async () => {
      const evento = await eventoConDomande({
        recordingDestination: 'REGISTRANTS',
        recordingAudience: 'REGISTRANTS',
      });
      const letto = await ingressi(evento.id);
      expect(letto).not.toContain('Domanda del pubblico');
      expect(letto).not.toContain('Domanda scritta in chat');
    });
  });

  it('uno snapshot salvato con le domande in chat non le fa uscire, e resta intero', async () => {
    const evento = await eventoConDomande({
      postEventRecapAt: new Date(),
      postEventRecap: {
        version: 2,
        generatedAt: new Date().toISOString(),
        headcount: 5,
        registrations: 5,
        topQuestions: [{ text: 'Domanda del riepilogo', upvotes: 3 }],
        chatQuestions: [
          { text: 'Domanda scritta in chat', reactions: 1, answered: false },
        ],
        polls: [],
        topWords: [],
        feedback: { average: null, count: 0 },
      },
    });
    expect(JSON.stringify(await payload(evento.slug))).not.toContain(
      'Domanda scritta in chat'
    );
    const salvato = await ensureEventRecap(evento.id);
    expect(salvato?.chatQuestions).toHaveLength(1);
  });

  it('un riepilogo nuovo non salva il testo della chat', async () => {
    const evento = await eventoConDomande();
    await payload(evento.slug);
    const riga = await prisma.event.findUniqueOrThrow({ where: { id: evento.id } });
    expect(JSON.stringify(riga.postEventRecap)).not.toContain('chatQuestions');
    expect(JSON.stringify(riga.postEventRecap)).toContain('Domanda del pubblico');
  });

  it.each([
    ['domande spente', { postEventShowQA: false }],
    [
      'registrazione riservata',
      {
        recordingDestination: 'REGISTRANTS' as const,
        recordingAudience: 'REGISTRANTS' as const,
      },
    ],
  ])('con %s nessun testo di domanda nel payload', async (_caso, campi) => {
    const evento = await eventoConDomande(campi);
    expect(JSON.stringify(await payload(evento.slug))).not.toContain(
      'Domanda del pubblico'
    );
  });

  it('dalla rotta delle domande il nome resta solo a chi modera', async () => {
    const evento = await eventoConDomande();
    const iscrizione = await creaIscrizione(evento.id);
    const nomi = async (token: string) => {
      const risposta = await leggiDomande(
        richiesta(
          `/api/events/${evento.slug}/questions`,
          'GET',
          undefined,
          token
        ) as never,
        ctx(evento.slug)
      );
      const corpo = (await risposta.json()) as { questions: { authorName: string }[] };
      return corpo.questions.map((q) => q.authorName);
    };
    expect(await nomi(iscrizione.accessToken)).toEqual(['']);
    expect(await nomi(evento.moderatorToken)).toEqual([NOME]);
  });
});

describe('domande e chat con gli pseudonimi', () => {
  const inDiretta = () =>
    creaEvento({
      audienceAnonymous: true,
      qaEnabled: true,
      chatEnabled: true,
      recordingEnabled: false,
    });
  const domanda = (slug: string, corpo: Record<string, unknown>, ip: string) =>
    chiedi(
      new Request(`http://localhost/api/events/${slug}/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify(corpo),
      }) as never,
      ctx(slug)
    );
  const nomeChiesto = async (risposta: Response) =>
    ((await risposta.json()) as { authorName: string }).authorName;

  it('l’iscritto compare con lo stesso pseudonimo nelle domande e in chat', async () => {
    const evento = await inDiretta();
    const iscrizione = await creaIscrizione(evento.id);
    const atteso = await pseudonimo(evento.id, `reg-${iscrizione.id}`);

    const risposta = await domanda(
      evento.slug,
      { text: 'Domanda da iscritta', accessToken: iscrizione.accessToken },
      '203.0.113.81'
    );
    expect(risposta.status).toBe(201);
    expect(await nomeChiesto(risposta)).toBe(atteso);

    const chat = await authenticateChatSender(
      evento.slug,
      iscrizione.accessToken,
      undefined,
      undefined,
      richiesta(`/api/events/${evento.slug}/chat`)
    );
    expect(chat.senderName).toBe(atteso);
    expect(atteso).not.toContain('Persona Iscritta');
  });

  it('l’ospite compare con lo pseudonimo, mai col nome dato', async () => {
    const evento = await inDiretta();
    const risposta = await domanda(
      evento.slug,
      { text: 'Domanda da ospite', guestName: 'Bruno Verdi' },
      '203.0.113.82'
    );
    expect(risposta.status).toBe(201);
    expect(await nomeChiesto(risposta)).not.toContain('Bruno');

    const chat = await authenticateChatSender(
      evento.slug,
      null,
      'Bruno Verdi',
      undefined,
      richiesta(`/api/events/${evento.slug}/chat`)
    );
    expect(chat.senderName).not.toContain('Bruno');
    expect(chat.senderName).toBe(await pseudonimo(evento.id, chat.senderId));
  });

  it('il relatore tiene il suo nome', async () => {
    const evento = await inDiretta();
    const relatore = await prisma.eventModerator.create({
      data: {
        eventId: evento.id,
        name: encryptPII('Rita Relatrice'),
        role: 'SPEAKER',
        token: randomUUID(),
      },
    });
    const risposta = await domanda(
      evento.slug,
      { text: 'Domanda dal relatore', accessToken: relatore.token },
      '203.0.113.83'
    );
    expect(risposta.status).toBe(201);
    expect(await nomeChiesto(risposta)).toBe('Rita Relatrice');

    const chat = await authenticateChatSender(
      evento.slug,
      relatore.token,
      undefined,
      undefined,
      richiesta(`/api/events/${evento.slug}/chat`)
    );
    expect(chat.senderName).toBe('Rita Relatrice');
    expect(chat.isModerator).toBe(false);
  });
});

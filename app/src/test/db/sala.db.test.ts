/**
 * Voti sull'agenda e reazioni in chat su un database vero: unicita' per
 * identita', cascate e gare fra richieste, che un client simulato non vede.
 */
import { randomUUID } from 'node:crypto';

import { SignJWT } from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as votaAgenda } from '@/app/api/events/[param]/agenda/[id]/reactions/route';
import { POST as reagisciChat } from '@/app/api/events/[param]/chat/[messageId]/reactions/route';
import { hashJoinPassword } from '@/lib/auth/password';
import { prisma } from '@/lib/db';

import { biscotti } from './biscotti';
import { creaEvento, creaIscrizione, richiesta, svuotaDatabase } from './fixtures';

beforeEach(svuotaDatabase);

async function eventoConAgenda(campi: Parameters<typeof creaEvento>[0] = {}) {
  const evento = await creaEvento({ agendaEnabled: true, ...campi });
  const punto = await prisma.eventAgendaItem.create({
    data: { eventId: evento.id, label: 'Punto in discussione' },
  });
  return { evento, punto };
}

function vota(slug: string, itemId: string, corpo: unknown) {
  return votaAgenda(
    richiesta(`/api/events/${slug}/agenda/${itemId}/reactions`, 'POST', corpo) as never,
    {
      params: Promise.resolve({ param: slug, id: itemId }),
    }
  );
}

const voti = (agendaItemId: string) =>
  prisma.agendaItemReaction.findMany({ where: { agendaItemId } });

describe('voto sull’agenda', () => {
  it('un ospite vota, cambia idea e ritira il voto sulla stessa riga', async () => {
    const { evento, punto } = await eventoConAgenda();
    const guestId = randomUUID();

    const primo = await vota(evento.slug, punto.id, { value: 'AGREE', guestId });
    expect(primo.status).toBe(201);
    expect(await primo.json()).toMatchObject({ agreeCount: 1, disagreeCount: 0 });

    const secondo = await vota(evento.slug, punto.id, { value: 'DISAGREE', guestId });
    expect(await secondo.json()).toMatchObject({ agreeCount: 0, disagreeCount: 1 });
    expect(await voti(punto.id)).toHaveLength(1);

    const ritirato = await vota(evento.slug, punto.id, { value: null, guestId });
    expect(await ritirato.json()).toMatchObject({ agreeCount: 0, disagreeCount: 0 });
    expect(await voti(punto.id)).toHaveLength(0);
  });

  it('chi e’ iscritto vota col suo posto, senza identificativo del browser', async () => {
    const { evento, punto } = await eventoConAgenda();
    const iscrizione = await creaIscrizione(evento.id);

    const risposta = await vota(evento.slug, punto.id, {
      value: 'AGREE',
      accessToken: iscrizione.accessToken,
      guestId: randomUUID(),
    });

    expect(risposta.status).toBe(201);
    const [riga] = await voti(punto.id);
    expect(riga).toMatchObject({ registrationId: iscrizione.id, guestId: null });
  });

  it('due ospiti diversi e un iscritto contano tre voti', async () => {
    const { evento, punto } = await eventoConAgenda();
    const iscrizione = await creaIscrizione(evento.id);
    await vota(evento.slug, punto.id, { value: 'AGREE', guestId: randomUUID() });
    await vota(evento.slug, punto.id, { value: 'AGREE', guestId: randomUUID() });
    const ultimo = await vota(evento.slug, punto.id, {
      value: 'DISAGREE',
      accessToken: iscrizione.accessToken,
    });
    expect(await ultimo.json()).toMatchObject({ agreeCount: 2, disagreeCount: 1 });
  });

  it('due voti contemporanei della stessa persona lasciano una riga e nessun errore', async () => {
    const { evento, punto } = await eventoConAgenda();
    const guestId = randomUUID();

    const risposte = await Promise.all(
      Array.from({ length: 8 }, () =>
        vota(evento.slug, punto.id, { value: 'AGREE', guestId })
      )
    );

    expect(risposte.map((r) => r.status)).toEqual(Array(8).fill(201));
    expect(await voti(punto.id)).toHaveLength(1);
  });

  it.each([
    ['su invito', { accessMode: 'INVITATION' as const }],
    ['con password', { joinPasswordHash: hashJoinPassword('segreta') }],
    ['non ancora in diretta', { status: 'PUBLISHED' as const }],
  ])('un ospite non vota su un evento %s', async (_nome, campi) => {
    const { evento, punto } = await eventoConAgenda(campi);

    const risposta = await vota(evento.slug, punto.id, {
      value: 'AGREE',
      guestId: randomUUID(),
    });

    expect(risposta.status).toBe(401);
    expect(await voti(punto.id)).toHaveLength(0);
  });

  it('con il permesso dato dalla password l’ospite vota', async () => {
    const { evento, punto } = await eventoConAgenda({
      joinPasswordHash: hashJoinPassword('segreta'),
    });
    biscotti.set(
      `join_granted_${evento.id}`,
      await new SignJWT({ eventId: evento.id, role: 'guest' })
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('1h')
        .sign(new TextEncoder().encode(process.env.APP_SECRET))
    );

    const risposta = await vota(evento.slug, punto.id, {
      value: 'AGREE',
      guestId: randomUUID(),
    });

    expect(risposta.status).toBe(201);
  });

  it.each(['ENDED', 'ARCHIVED'] as const)('a evento %s non si vota', async (status) => {
    const { evento, punto } = await eventoConAgenda({ status });
    const iscrizione = await creaIscrizione(evento.id);

    const risposta = await vota(evento.slug, punto.id, {
      value: 'AGREE',
      accessToken: iscrizione.accessToken,
    });

    expect(risposta.status).toBe(409);
    expect(await voti(punto.id)).toHaveLength(0);
  });

  it('il punto e l’iscrizione devono essere di questo evento', async () => {
    const { evento, punto } = await eventoConAgenda();
    const altro = await eventoConAgenda();
    const estranea = await creaIscrizione(altro.evento.id);

    const puntoAltrui = await vota(evento.slug, altro.punto.id, {
      value: 'AGREE',
      guestId: randomUUID(),
    });
    const iscrizioneAltrui = await vota(evento.slug, punto.id, {
      value: 'AGREE',
      accessToken: estranea.accessToken,
    });

    expect(puntoAltrui.status).toBe(404);
    expect(iscrizioneAltrui.status).toBe(403);
  });

  it('cancellare l’iscrizione toglie anche il suo voto', async () => {
    const { evento, punto } = await eventoConAgenda();
    const iscrizione = await creaIscrizione(evento.id);
    await vota(evento.slug, punto.id, {
      value: 'AGREE',
      accessToken: iscrizione.accessToken,
    });

    await prisma.registration.delete({ where: { id: iscrizione.id } });

    expect(await voti(punto.id)).toHaveLength(0);
  });
});

describe('reazione a un messaggio', () => {
  async function messaggio() {
    const evento = await creaEvento({ chatEnabled: true });
    const iscrizione = await creaIscrizione(evento.id);
    const riga = await prisma.chatMessage.create({
      data: {
        eventId: evento.id,
        senderName: 'Qualcuno',
        senderId: 'reg-altro',
        text: 'Ciao',
      },
    });
    return { evento, iscrizione, riga };
  }

  function reagisci(slug: string, messageId: string, token: string, emoji = '👍') {
    return reagisciChat(
      richiesta(
        `/api/events/${slug}/chat/${messageId}/reactions`,
        'POST',
        { emoji },
        token
      ) as never,
      {
        params: Promise.resolve({ param: slug, messageId }),
      }
    );
  }

  it('la stessa reazione si mette e si toglie', async () => {
    const { evento, iscrizione, riga } = await messaggio();

    const messa = await reagisci(evento.slug, riga.id, iscrizione.accessToken);
    expect(messa.status).toBe(200);
    expect(
      await prisma.chatMessageReaction.count({ where: { messageId: riga.id } })
    ).toBe(1);

    await reagisci(evento.slug, riga.id, iscrizione.accessToken);
    expect(
      await prisma.chatMessageReaction.count({ where: { messageId: riga.id } })
    ).toBe(0);
  });

  it('una reazione doppia che urta l’indice unico risponde bene', async () => {
    const { evento, iscrizione, riga } = await messaggio();
    // La gara vera: l'altra richiesta ha scritto dopo la lettura di questa.
    await prisma.chatMessageReaction.create({
      data: { messageId: riga.id, senderId: `reg-${iscrizione.id}`, emoji: '👍' },
    });
    const lettura = vi
      .spyOn(prisma.chatMessageReaction, 'findUnique')
      .mockResolvedValueOnce(null as never);

    const risposta = await reagisci(evento.slug, riga.id, iscrizione.accessToken);

    lettura.mockRestore();
    expect(risposta.status).toBe(200);
    expect(
      await prisma.chatMessageReaction.count({ where: { messageId: riga.id } })
    ).toBe(1);
  });

  it('un messaggio tolto fra il controllo e la scrittura risponde 404', async () => {
    const { evento, iscrizione, riga } = await messaggio();
    const fantasma = randomUUID();
    const lettura = vi
      .spyOn(prisma.chatMessage, 'findFirst')
      .mockResolvedValueOnce({ id: fantasma } as never);

    const risposta = await reagisci(evento.slug, fantasma, iscrizione.accessToken);

    lettura.mockRestore();
    expect(risposta.status).toBe(404);
    expect(
      await prisma.chatMessageReaction.count({ where: { messageId: riga.id } })
    ).toBe(0);
  });

  it('un messaggio di un altro evento non si raggiunge da questa sala', async () => {
    const { evento, iscrizione } = await messaggio();
    const altro = await messaggio();

    const risposta = await reagisci(evento.slug, altro.riga.id, iscrizione.accessToken);

    expect(risposta.status).toBe(404);
  });
});

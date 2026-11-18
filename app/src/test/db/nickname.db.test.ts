// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Il nickname di chi partecipa su un database vero: la rotta che lo salva
 * sull'iscrizione, il vincolo unico per evento, e lo stesso nome nel token della
 * conferenza e in chat.
 */
import { decodeJwt } from 'jose';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as chiediToken } from '@/app/api/events/[param]/jitsi/token/route';
import { PUT as salvaNickname } from '@/app/api/events/[param]/nickname/route';
import { resolveTokenSender } from '@/lib/chat/sender';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { eventAccessCookieName, signEventAccess } from '@/lib/event-session';
import { improntaNickname, resetNicknameCachesForTests } from '@/lib/live/nickname';

import { biscotti } from './biscotti';
import { creaEvento, creaIscrizione, richiesta, svuotaDatabase } from './fixtures';

// Le parole riservate dai cataloghi veri, come le darebbe next-intl.
vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale }: { locale: string }) => {
    const m = (await import(`@/i18n/messages/${locale}.json`)).default as {
      live: { pseudonym: string; nickname: { reserved: string } };
    };
    return (k: string, v?: { code: string }) =>
      k === 'nickname.reserved'
        ? m.live.nickname.reserved
        : m.live.pseudonym.replace('{code}', v?.code ?? '');
  },
}));

beforeAll(() => {
  process.env.JITSI_JWT_SECRET ??= 'segreto-di-prova-per-i-token-della-sala';
});

beforeEach(async () => {
  await svuotaDatabase();
  resetNicknameCachesForTests();
});

let indirizzo = 0;
async function salva(slug: string, token: string, nickname: string | null) {
  const r = richiesta(`/api/events/${slug}/nickname`, 'PUT', { nickname }, token);
  r.headers.set('x-forwarded-for', `10.44.0.${(indirizzo += 1)}`);
  return salvaNickname(r as never, { params: Promise.resolve({ param: slug }) });
}

async function suo(eventId: string, accessToken: string) {
  biscotti.set(
    eventAccessCookieName(eventId),
    await signEventAccess(eventId, accessToken, 3600)
  );
}

describe('nickname di chi partecipa', () => {
  it("si salva cifrato sull'iscrizione, e vale nel token e in chat", async () => {
    const evento = await creaEvento({ nicknamesEnabled: true });
    const iscrizione = await creaIscrizione(evento.id);
    await suo(evento.id, iscrizione.accessToken);

    const risposta = await salva(evento.slug, iscrizione.accessToken, ' Pippo ');
    expect(risposta.status).toBe(200);
    expect(await risposta.json()).toEqual({ nickname: 'Pippo', saved: true });

    const riga = await prisma.registration.findUniqueOrThrow({
      where: { id: iscrizione.id },
    });
    expect(riga.nickname).not.toBe('Pippo');
    expect(tryDecryptPII(riga.nickname)).toBe('Pippo');
    expect(riga.nicknameKey).toBe(improntaNickname(evento.id, 'Pippo'));

    const token = await chiediToken(
      richiesta(`/api/events/${evento.slug}/jitsi/token`, 'POST', {
        accessToken: iscrizione.accessToken,
      }) as never,
      { params: Promise.resolve({ param: evento.slug }) }
    );
    expect(token.status).toBe(200);
    const { jwt, nickname } = (await token.json()) as { jwt: string; nickname: string };
    expect(nickname).toBe('Pippo');
    const utente = (decodeJwt(jwt).context as { user: { name: string } }).user;
    expect(utente.name).toBe('Pippo');

    const mittente = await resolveTokenSender(evento, iscrizione.accessToken);
    expect(mittente?.senderName).toBe('Pippo');
  });

  it("unico nell'evento, senza distinguere maiuscole e accenti; in un altro evento e' libero", async () => {
    const evento = await creaEvento({ nicknamesEnabled: true });
    const prima = await creaIscrizione(evento.id);
    const seconda = await creaIscrizione(evento.id);
    await suo(evento.id, prima.accessToken);
    expect((await salva(evento.slug, prima.accessToken, 'Pippo')).status).toBe(200);

    await suo(evento.id, seconda.accessToken);
    const presa = await salva(evento.slug, seconda.accessToken, 'PÌPPO');
    expect(presa.status).toBe(409);
    expect(await presa.json()).toMatchObject({
      code: 'NICKNAME_TAKEN',
      suggestion: 'PÌPPO2',
    });

    // Il vincolo del database tiene anche fuori dalla rotta.
    await expect(
      prisma.registration.update({
        where: { id: seconda.id },
        data: { nicknameKey: improntaNickname(evento.id, 'pippo') },
      })
    ).rejects.toMatchObject({ code: 'P2002' });

    const altro = await creaEvento({ nicknamesEnabled: true });
    const terza = await creaIscrizione(altro.id);
    await suo(altro.id, terza.accessToken);
    expect((await salva(altro.slug, terza.accessToken, 'Pippo')).status).toBe(200);
  });

  it("toglierlo libera il nickname, e va via con l'iscrizione", async () => {
    const evento = await creaEvento({ nicknamesEnabled: true });
    const iscrizione = await creaIscrizione(evento.id);
    await suo(evento.id, iscrizione.accessToken);
    await salva(evento.slug, iscrizione.accessToken, 'Pippo');
    expect((await salva(evento.slug, iscrizione.accessToken, null)).status).toBe(200);
    const riga = await prisma.registration.findUniqueOrThrow({
      where: { id: iscrizione.id },
    });
    expect(riga).toMatchObject({ nickname: null, nicknameKey: null });

    await salva(evento.slug, iscrizione.accessToken, 'Pippo');
    await prisma.registration.delete({ where: { id: iscrizione.id } });
    expect(
      await prisma.registration.count({
        where: { nicknameKey: improntaNickname(evento.id, 'Pippo') },
      })
    ).toBe(0);
  });
});

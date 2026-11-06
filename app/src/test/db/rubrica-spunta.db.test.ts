// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * La spunta della rubrica su un indirizzo che ha ritirato il consenso, sul
 * database vero. Chi conosce l'indirizzo di un altro compila il modulo senza
 * provare niente: il ritiro resta, gli inviti restano fermi, e la spunta vale
 * solo quando la persona la conferma: dal link dell'email nel browser che ha
 * compilato il modulo, o dalla pagina dei propri dati.
 */
import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as aggiungiInvito } from '@/app/api/admin/events/[id]/invitations/route';
import { PATCH as cambiaInvito } from '@/app/api/admin/events/[id]/invitations/[invId]/route';
import { GET as conservazione } from '@/app/api/cron/rubrica-retention/route';
import { GET as apriLink } from '@/app/api/events/[param]/registrations/enter/route';
import { POST as iscrivi } from '@/app/api/events/[param]/registrations/route';
import { POST as consensi } from '@/app/api/gdpr/consents/route';
import {
  GET as linkRubrica,
  POST as ritiroDalLink,
} from '@/app/api/rubrica/opt-out/route';
import { encryptPII, hashEmail, tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { sendInvitations } from '@/lib/email/invitation';
import { eventAccessCookieName, signEventAccess } from '@/lib/event-session';
import {
  signRegistrationEntry,
  signRegistrationProof,
} from '@/lib/events/registration-link';
import { issueGdprToken } from '@/lib/gdpr/request-token';
import { ritiraComunicazioni } from '@/lib/live/consent-withdrawal';
import { upsertPersonOnRegistration } from '@/lib/persons';
import { issueRubricaOptOutToken } from '@/lib/persons/opt-out-token';

import { biscotti } from './biscotti';
import { creaEvento, richiesta, svuotaDatabase } from './fixtures';

// Fuori da Next `getTranslations` lancia, e la conferma non partirebbe.
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (chiave: string) => chiave,
}));

vi.mock('@/lib/auth/staff-session', () => ({
  requireEventManager: vi.fn(async () => ({ role: 'organizer' })),
}));

const GIORNO = 24 * 3_600_000;
const spunta = { consentAddressBook: true, consentFutureCommunications: true };
const nome = 'Nome scritto da chi chiama';

const eventoAperto = (campi: Partial<Prisma.EventUncheckedCreateInput> = {}) =>
  creaEvento({
    status: 'PUBLISHED',
    accessMode: 'OPEN',
    startsAt: new Date(Date.now() + GIORNO),
    endsAt: new Date(Date.now() + GIORNO + 3_600_000),
    ...campi,
  });

let ip = 0;
function iscriviti(slug: string, email: string, corpo: Record<string, unknown> = {}) {
  ip += 1;
  const r = richiesta(`/api/events/${slug}/registrations`, 'POST', {
    displayName: nome,
    email,
    consentGiven: true,
    locale: 'it',
    organization: 'Ente di chi chiama',
    ...corpo,
  });
  r.headers.set('x-forwarded-for', `10.8.${Math.floor(ip / 250)}.${ip % 250}`);
  return iscrivi(r as never, { params: Promise.resolve({ param: slug }) });
}

/** Una persona in rubrica con un invito, poi ritirata dal link. */
async function ritirata() {
  const email = `${randomUUID()}@example.org`;
  const emailHash = hashEmail(email);
  const cifrata = encryptPII(email);
  const persona = await upsertPersonOnRegistration(prisma, {
    emailHash,
    email: cifrata,
    displayName: 'Nome vero',
    organization: 'Ente vero',
    optedIn: true,
  });
  const riservato = await eventoAperto({ accessMode: 'INVITATION' });
  await prisma.eventInvitation.create({
    data: { eventId: riservato.id, email: cifrata, emailHash, personId: persona },
  });
  await ritiraComunicazioni(emailHash);
  return { email, emailHash, cifrata, id: persona!, riservato };
}

const corsaConservazione = () =>
  conservazione(
    new Request('http://localhost/api/cron/rubrica-retention', {
      headers: { 'x-api-key': process.env.CRON_API_KEY ?? '' },
    }) as never,
    { params: Promise.resolve({}) }
  );

function apri(slug: string, query: Record<string, string>) {
  return apriLink(
    new Request(
      `http://localhost/api/events/${slug}/registrations/enter?${new URLSearchParams(query)}`
    ) as never,
    { params: Promise.resolve({ param: slug }) }
  );
}

/** Il browser che porta il cookie di quell'iscrizione. */
async function browserDi(eventId: string, accessToken: string) {
  biscotti.set(
    eventAccessCookieName(eventId),
    await signEventAccess(eventId, accessToken, 3600)
  );
}

/** Una richiesta dalla pagina dei propri dati, con il token che quella pagina riceve. */
function daiMieiDati(emailHash: string, azione: Record<string, unknown>) {
  ip += 1;
  const r = richiesta('/api/gdpr/consents', 'POST', {
    token: issueGdprToken('consents', emailHash),
    ...azione,
  });
  r.headers.set('x-forwarded-for', `10.9.${Math.floor(ip / 250)}.${ip % 250}`);
  return consensi(r as never, { params: Promise.resolve({}) });
}

function cambiaIndirizzo(eventId: string, invId: string, email: string) {
  return cambiaInvito(
    richiesta(`/api/admin/events/${eventId}/invitations/${invId}`, 'PATCH', {
      email,
    }) as never,
    { params: Promise.resolve({ id: eventId, invId }) }
  );
}

const iscrizione = (eventId: string, emailHash: string) =>
  prisma.registration.findUniqueOrThrow({
    where: { eventId_emailHash: { eventId, emailHash } },
  });

const invitiFermi = (emailHash: string) =>
  prisma.eventInvitation.count({ where: { emailHash, declinedAt: { not: null } } });

beforeEach(async () => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://webinar.example.org');
  await svuotaDatabase();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('il modulo non prova l’indirizzo', () => {
  it('dopo il ritiro una spunta anonima non cambia voce né inviti, e gli inviti restano fermi', async () => {
    const persona = await ritirata();
    const prima = await prisma.person.findUniqueOrThrow({ where: { id: persona.id } });
    const evento = await eventoAperto();

    const risposta = await iscriviti(evento.slug, persona.email, spunta);

    expect(risposta.status).toBe(201);
    expect(await prisma.person.findUniqueOrThrow({ where: { id: persona.id } })).toEqual(
      prima
    );
    expect(prima.optedOutAt).not.toBeNull();
    expect(prima.email).toBeNull();
    expect(await invitiFermi(persona.emailHash)).toBe(1);
    expect(await sendInvitations(persona.riservato.id, { locale: 'it' })).toMatchObject({
      sent: 0,
    });
    expect(await iscrizione(evento.id, persona.emailHash)).toMatchObject({
      addressBookPending: true,
      consentFutureCommunications: false,
      personId: persona.id,
    });
  });

  it('una spunta anonima non rimette in rubrica chi ha ritirato, anche con la voce già cancellata', async () => {
    const persona = await ritirata();
    await corsaConservazione();
    expect(await prisma.person.count()).toBe(0);
    // Niente inviti: il ritiro lo ricorda solo l'iscrizione.
    await prisma.eventInvitation.deleteMany();
    const vecchio = await eventoAperto();
    await prisma.registration.create({
      data: {
        eventId: vecchio.id,
        displayName: encryptPII('Nome vero'),
        email: persona.cifrata,
        emailHash: persona.emailHash,
        consentGiven: true,
        consentTimestamp: new Date(),
        consentFutureCommunicationsWithdrawnAt: new Date(),
        accessToken: randomUUID(),
      },
    });
    const evento = await eventoAperto();

    await iscriviti(evento.slug, persona.email, spunta);

    expect(await prisma.person.count()).toBe(0);
    expect(await iscrizione(evento.id, persona.emailHash)).toMatchObject({
      addressBookPending: true,
    });
  });

  it('senza ritiri la spunta vale subito, come sempre', async () => {
    const email = `${randomUUID()}@example.org`;
    const evento = await eventoAperto();

    await iscriviti(evento.slug, email, spunta);

    const voce = await prisma.person.findUniqueOrThrow({
      where: { emailHash: hashEmail(email) },
    });
    expect(voce).toMatchObject({ optedInToAddressBook: true, optedOutAt: null });
    expect(await iscrizione(evento.id, hashEmail(email))).toMatchObject({
      addressBookPending: false,
      consentFutureCommunications: true,
    });
  });
});

describe('il link personale conferma la spunta', () => {
  it('firma e cookie insieme: la voce torna con i dati dell’iscrizione e gli inviti riprendono', async () => {
    const persona = await ritirata();
    const evento = await eventoAperto();
    await iscriviti(evento.slug, persona.email, spunta);
    const reg = await iscrizione(evento.id, persona.emailHash);
    await browserDi(evento.id, reg.accessToken);

    await apri(evento.slug, {
      token: reg.accessToken,
      proof: signRegistrationProof(evento.id, reg.accessToken),
    });

    const voce = await prisma.person.findUniqueOrThrow({ where: { id: persona.id } });
    expect(voce).toMatchObject({
      optedInToAddressBook: true,
      optedOutAt: null,
      email: reg.email,
      organization: 'Ente di chi chiama',
    });
    expect(tryDecryptPII(voce.displayName)).toBe(nome);
    expect(await invitiFermi(persona.emailHash)).toBe(0);
    expect(await sendInvitations(persona.riservato.id, { locale: 'it' })).toMatchObject({
      sent: 1,
    });
    expect(await iscrizione(evento.id, persona.emailHash)).toMatchObject({
      addressBookPending: false,
      consentFutureCommunications: true,
      personId: persona.id,
    });
    const registro = await prisma.gdprAuditLog.findMany({
      where: { eventId: evento.id, action: 'CONSENT_RECORDED' },
    });
    expect(registro.map((r) => JSON.parse(r.details ?? '{}').source)).toContain(
      'registration-link'
    );
  });

  it('con la voce già cancellata ne nasce una nuova', async () => {
    const persona = await ritirata();
    await corsaConservazione();
    const evento = await eventoAperto();
    await iscriviti(evento.slug, persona.email, spunta);
    const reg = await iscrizione(evento.id, persona.emailHash);
    await browserDi(evento.id, reg.accessToken);

    await apri(evento.slug, {
      token: reg.accessToken,
      proof: signRegistrationProof(evento.id, reg.accessToken),
    });

    const voce = await prisma.person.findUniqueOrThrow({
      where: { emailHash: persona.emailHash },
    });
    expect(voce.optedInToAddressBook).toBe(true);
    expect((await iscrizione(evento.id, persona.emailHash)).personId).toBe(voce.id);
  });

  it('un filtro antivirus apre il link senza cookie: la spunta resta in attesa', async () => {
    const persona = await ritirata();
    const evento = await eventoAperto();
    await iscriviti(evento.slug, persona.email, spunta);
    const reg = await iscrizione(evento.id, persona.emailHash);

    await apri(evento.slug, {
      token: reg.accessToken,
      proof: signRegistrationProof(evento.id, reg.accessToken),
    });
    await apri(evento.slug, {
      token: reg.accessToken,
      sig: signRegistrationEntry(evento.id, reg.accessToken),
    });

    expect((await iscrizione(evento.id, persona.emailHash)).addressBookPending).toBe(
      true
    );
    expect(await invitiFermi(persona.emailHash)).toBe(1);
  });

  it('chi ha il cookie ma non il link dell’email non conferma niente', async () => {
    const persona = await ritirata();
    const evento = await eventoAperto();
    await iscriviti(evento.slug, persona.email, spunta);
    const reg = await iscrizione(evento.id, persona.emailHash);
    await browserDi(evento.id, reg.accessToken);

    await apri(evento.slug, { token: reg.accessToken });

    expect((await iscrizione(evento.id, persona.emailHash)).addressBookPending).toBe(
      true
    );
    expect(await invitiFermi(persona.emailHash)).toBe(1);
  });

  it('riaprire il link non rinnova il consenso', async () => {
    const persona = await ritirata();
    const evento = await eventoAperto();
    await iscriviti(evento.slug, persona.email, spunta);
    const reg = await iscrizione(evento.id, persona.emailHash);
    await browserDi(evento.id, reg.accessToken);
    const link = {
      token: reg.accessToken,
      proof: signRegistrationProof(evento.id, reg.accessToken),
    };

    await apri(evento.slug, link);
    const dopo = await prisma.person.findUniqueOrThrow({ where: { id: persona.id } });
    await apri(evento.slug, link);

    expect(
      (await prisma.person.findUniqueOrThrow({ where: { id: persona.id } })).optedInAt
    ).toEqual(dopo.optedInAt);
  });

  it('un ritiro dopo la spunta in attesa la toglie: il link non la riporta in vita', async () => {
    const persona = await ritirata();
    const evento = await eventoAperto();
    await iscriviti(evento.slug, persona.email, spunta);
    const reg = await iscrizione(evento.id, persona.emailHash);
    await browserDi(evento.id, reg.accessToken);

    await ritiraComunicazioni(persona.emailHash);
    await apri(evento.slug, {
      token: reg.accessToken,
      proof: signRegistrationProof(evento.id, reg.accessToken),
    });

    expect(
      (await prisma.person.findUniqueOrThrow({ where: { id: persona.id } })).optedOutAt
    ).not.toBeNull();
    expect(await invitiFermi(persona.emailHash)).toBe(1);
  });

  it('dopo la conferma il link della rubrica vale di nuovo', async () => {
    const persona = await ritirata();
    const evento = await eventoAperto();
    await iscriviti(evento.slug, persona.email, spunta);
    const reg = await iscrizione(evento.id, persona.emailHash);
    await browserDi(evento.id, reg.accessToken);
    await apri(evento.slug, {
      token: reg.accessToken,
      proof: signRegistrationProof(evento.id, reg.accessToken),
    });

    const anteprima = await linkRubrica(
      richiesta(
        `/api/rubrica/opt-out?token=${issueRubricaOptOutToken(persona.id)}`
      ) as never,
      { params: Promise.resolve({}) }
    );

    expect(await anteprima.json()).toMatchObject({ alreadyOptedOut: false });
  });
});

describe('un link che si consegna da solo il cookie non conferma', () => {
  it('spunta anonima su un evento su invito e due aperture del link `sig`: voce e inviti non cambiano', async () => {
    const persona = await ritirata();
    const prima = await prisma.person.findUniqueOrThrow({ where: { id: persona.id } });

    const risposta = await iscriviti(persona.riservato.slug, persona.email, spunta);

    expect(risposta.status).toBe(202);
    const reg = await iscrizione(persona.riservato.id, persona.emailHash);
    expect(reg.addressBookPending).toBe(true);

    const link = {
      token: reg.accessToken,
      sig: signRegistrationEntry(persona.riservato.id, reg.accessToken),
    };
    const primaApertura = await apri(persona.riservato.slug, link);
    const cookie =
      primaApertura.headers.get('Set-Cookie')?.split(';')[0]?.split('=') ?? [];
    expect(cookie[0]).toBe(eventAccessCookieName(persona.riservato.id));
    biscotti.set(cookie[0]!, cookie[1]!);
    await apri(persona.riservato.slug, link);

    expect(await prisma.person.findUniqueOrThrow({ where: { id: persona.id } })).toEqual(
      prima
    );
    expect(prima.optedOutAt).not.toBeNull();
    expect(await invitiFermi(persona.emailHash)).toBe(1);
    expect(
      await prisma.gdprAuditLog.count({
        where: {
          eventId: persona.riservato.id,
          action: 'CONSENT_RECORDED',
          details: { contains: 'registration-link' },
        },
      })
    ).toBe(0);
    expect(
      (await iscrizione(persona.riservato.id, persona.emailHash)).addressBookPending
    ).toBe(true);
  });

  it('il cookie nato dal link `sig` non conferma nemmeno quando il link diventa `proof`', async () => {
    const persona = await ritirata();
    await iscriviti(persona.riservato.slug, persona.email, spunta);
    const reg = await iscrizione(persona.riservato.id, persona.emailHash);
    const primaApertura = await apri(persona.riservato.slug, {
      token: reg.accessToken,
      sig: signRegistrationEntry(persona.riservato.id, reg.accessToken),
    });
    const cookie =
      primaApertura.headers.get('Set-Cookie')?.split(';')[0]?.split('=') ?? [];
    biscotti.set(cookie[0]!, cookie[1]!);

    await apri(persona.riservato.slug, {
      token: reg.accessToken,
      proof: signRegistrationProof(persona.riservato.id, reg.accessToken),
    });

    expect(await invitiFermi(persona.emailHash)).toBe(1);
    expect(
      (await iscrizione(persona.riservato.id, persona.emailHash)).addressBookPending
    ).toBe(true);
  });
});

describe('la pagina dei propri dati', () => {
  it('conferma la spunta su un evento su invito: la voce torna e gli inviti riprendono', async () => {
    const persona = await ritirata();
    await iscriviti(persona.riservato.slug, persona.email, spunta);
    const reg = await iscrizione(persona.riservato.id, persona.emailHash);

    const risposta = await daiMieiDati(persona.emailHash, {
      registrationId: reg.id,
      confirmAddressBook: true,
    });

    expect(risposta.status).toBe(200);
    expect(
      await prisma.person.findUniqueOrThrow({ where: { id: persona.id } })
    ).toMatchObject({
      optedInToAddressBook: true,
      optedOutAt: null,
      email: reg.email,
    });
    expect(await invitiFermi(persona.emailHash)).toBe(0);
    const registro = await prisma.gdprAuditLog.findMany({
      where: { eventId: persona.riservato.id, action: 'CONSENT_RECORDED' },
    });
    expect(registro.map((r) => JSON.parse(r.details ?? '{}').source)).toContain(
      'self-service'
    );
  });

  it('non conferma con il token di un altro indirizzo', async () => {
    const persona = await ritirata();
    await iscriviti(persona.riservato.slug, persona.email, spunta);
    const reg = await iscrizione(persona.riservato.id, persona.emailHash);

    const risposta = await daiMieiDati(hashEmail('altra@example.org'), {
      registrationId: reg.id,
      confirmAddressBook: true,
    });

    expect(risposta.status).toBe(404);
    expect(
      (await iscrizione(persona.riservato.id, persona.emailHash)).addressBookPending
    ).toBe(true);
  });

  it('annulla la spunta in attesa: non si conferma piu’, e lo dice l’iscrizione', async () => {
    const persona = await ritirata();
    await iscriviti(persona.riservato.slug, persona.email, spunta);
    const reg = await iscrizione(persona.riservato.id, persona.emailHash);

    const annullo = await daiMieiDati(persona.emailHash, {
      registrationId: reg.id,
      consent: 'futureCommunications',
    });
    const conferma = await daiMieiDati(persona.emailHash, {
      registrationId: reg.id,
      confirmAddressBook: true,
    });

    expect(annullo.status).toBe(200);
    expect(conferma.status).toBe(404);
    const dopo = await iscrizione(persona.riservato.id, persona.emailHash);
    expect(dopo.addressBookPending).toBe(false);
    expect(dopo.consentFutureCommunicationsWithdrawnAt).not.toBeNull();
    expect(await invitiFermi(persona.emailHash)).toBe(1);
  });
});

describe('il link della rubrica con una spunta in attesa', () => {
  it('propone ancora il ritiro, e il ritiro toglie la spunta', async () => {
    const persona = await ritirata();
    await iscriviti(persona.riservato.slug, persona.email, spunta);
    const percorso = `/api/rubrica/opt-out?token=${issueRubricaOptOutToken(persona.id)}`;

    const anteprima = await linkRubrica(richiesta(percorso) as never, {
      params: Promise.resolve({}),
    });
    expect(await anteprima.json()).toMatchObject({ alreadyOptedOut: false });

    await ritiroDalLink(richiesta(percorso, 'POST') as never, {
      params: Promise.resolve({}),
    });

    expect(
      (await iscrizione(persona.riservato.id, persona.emailHash)).addressBookPending
    ).toBe(false);
    const dopo = await linkRubrica(richiesta(percorso) as never, {
      params: Promise.resolve({}),
    });
    expect(await dopo.json()).toMatchObject({ alreadyOptedOut: true });
  });
});

describe('il ritiro lascia il segno anche senza la spunta', () => {
  it('voce attiva e iscrizione senza spunta: dopo il ritiro e la conservazione una spunta anonima resta in attesa', async () => {
    const email = `${randomUUID()}@example.org`;
    const emailHash = hashEmail(email);
    await upsertPersonOnRegistration(prisma, {
      emailHash,
      email: encryptPII(email),
      displayName: 'Nome vero',
      optedIn: true,
    });
    const vecchio = await eventoAperto();
    await iscriviti(vecchio.slug, email);
    expect((await iscrizione(vecchio.id, emailHash)).consentFutureCommunications).toBe(
      false
    );

    await ritiraComunicazioni(emailHash);
    await corsaConservazione();
    expect(await prisma.person.count()).toBe(0);

    const evento = await eventoAperto();
    await iscriviti(evento.slug, email, spunta);

    expect(await prisma.person.count()).toBe(0);
    expect((await iscrizione(evento.id, emailHash)).addressBookPending).toBe(true);
  });

  it('un nuovo ritiro non sposta il segno che c’era gia’', async () => {
    const persona = await ritirata();
    const evento = await eventoAperto();
    await iscriviti(evento.slug, persona.email);
    await ritiraComunicazioni(persona.emailHash, new Date('2026-01-01T00:00:00Z'));
    await ritiraComunicazioni(persona.emailHash, new Date('2026-02-01T00:00:00Z'));

    expect(
      (await iscrizione(evento.id, persona.emailHash))
        .consentFutureCommunicationsWithdrawnAt
    ).toEqual(new Date('2026-01-01T00:00:00Z'));
  });
});

describe('lo stop di un invito segue l’indirizzo', () => {
  /** Un invito fermato: la voce cancellata, il ritiro ricordato da un'iscrizione. */
  async function fermatoSenzaVoce() {
    const persona = await ritirata();
    const vecchio = await eventoAperto();
    await iscriviti(vecchio.slug, persona.email);
    await ritiraComunicazioni(persona.emailHash);
    await corsaConservazione();
    expect(await prisma.person.count()).toBe(0);
    const invito = await prisma.eventInvitation.findFirstOrThrow({
      where: { emailHash: persona.emailHash },
    });
    return { ...persona, invito };
  }

  it('da A a B e di nuovo ad A: lo stop resta e non parte niente', async () => {
    const { email, emailHash, riservato, invito } = await fermatoSenzaVoce();

    await cambiaIndirizzo(riservato.id, invito.id, 'altra@example.org');
    expect(
      (await prisma.eventInvitation.findUniqueOrThrow({ where: { id: invito.id } }))
        .declinedAt
    ).toBeNull();
    await cambiaIndirizzo(riservato.id, invito.id, email);

    const riga = await prisma.eventInvitation.findUniqueOrThrow({
      where: { id: invito.id },
    });
    expect(riga.emailHash).toBe(emailHash);
    expect(riga.declinedAt).not.toBeNull();
    expect(await sendInvitations(riservato.id, { locale: 'it' })).toMatchObject({
      sent: 0,
    });
  });

  it('cancellare l’invito e riscriverlo non toglie lo stop', async () => {
    const { email, riservato, invito } = await fermatoSenzaVoce();
    await prisma.eventInvitation.delete({ where: { id: invito.id } });

    const risposta = await aggiungiInvito(
      richiesta(`/api/admin/events/${riservato.id}/invitations`, 'POST', {
        email,
      }) as never,
      { params: Promise.resolve({ id: riservato.id }) }
    );

    expect(risposta.status).toBe(201);
    expect(await sendInvitations(riservato.id, { locale: 'it' })).toMatchObject({
      sent: 0,
    });
  });

  it('un indirizzo senza ritiri parte normalmente', async () => {
    const { riservato, invito } = await fermatoSenzaVoce();

    await cambiaIndirizzo(riservato.id, invito.id, 'altra@example.org');

    expect(await sendInvitations(riservato.id, { locale: 'it' })).toMatchObject({
      sent: 1,
    });
  });
});

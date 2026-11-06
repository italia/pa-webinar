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
import {
  DELETE as cancellaInvito,
  PATCH as cambiaInvito,
} from '@/app/api/admin/events/[id]/invitations/[invId]/route';
import { GET as conservazione } from '@/app/api/cron/rubrica-retention/route';
import { GET as apriLink } from '@/app/api/events/[param]/registrations/enter/route';
import { POST as iscrivi } from '@/app/api/events/[param]/registrations/route';
import { POST as consensi } from '@/app/api/gdpr/consents/route';
import {
  GET as linkRubrica,
  POST as ritiroDalLink,
} from '@/app/api/rubrica/opt-out/route';
import { decryptPII, encryptPII, hashEmail, tryDecryptPII } from '@/lib/crypto/pii';
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
import { invalidateSettingsCache } from '@/lib/settings';

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

/** I dettagli delle righe di registro che dicono che una spunta e' stata tolta. */
async function righeSpuntaTolta(eventId: string) {
  const righe = await prisma.gdprAuditLog.findMany({
    where: { eventId, action: 'CONSENT_WITHDRAWN' },
  });
  return righe
    .map((r) => JSON.parse(r.details ?? '{}') as Record<string, unknown>)
    .filter((d) => d.addressBookPending === 1);
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

/** Le email di conferma accodate, in chiaro. */
const conferme = async () =>
  (await prisma.emailOutbox.findMany({ orderBy: { createdAt: 'asc' } }))
    .filter((r) => (r.metadata as { kind?: string } | null)?.kind === 'confirmation')
    .map((r) => decryptPII(r.text ?? ''));

/** I destinatari delle email di un invito ancora in tabella, con lo stato. */
const emailInviti = async () =>
  (
    await prisma.emailOutbox.findMany({
      where: { dedupKey: { startsWith: 'event-invitation:' } },
    })
  ).map((r) => [decryptPII(r.toAddress), r.status]);

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

describe('l’email di conferma dice della spunta in attesa', () => {
  const NOTA = 'addressBookPendingNote';

  it('su invito: la risposta resta uguale per tutti, e il paragrafo sta nell’email', async () => {
    const persona = await ritirata();
    const senzaSpunta = `${randomUUID()}@example.org`;
    const evento = persona.riservato;
    await prisma.eventInvitation.create({
      data: {
        eventId: evento.id,
        email: encryptPII(senzaSpunta),
        emailHash: hashEmail(senzaSpunta),
      },
    });

    const conAttesa = await iscriviti(evento.slug, persona.email, spunta);
    const normale = await iscriviti(evento.slug, senzaSpunta);

    expect(conAttesa.status).toBe(normale.status);
    expect(await conAttesa.json()).toEqual(await normale.json());
    const testi = await conferme();
    expect(testi).toHaveLength(2);
    expect(testi[0]).toContain(NOTA);
    expect(testi[1]).not.toContain(NOTA);
  });

  it('su un evento aperto, con il link alla pagina dei propri dati', async () => {
    const persona = await ritirata();
    const evento = await eventoAperto();

    await iscriviti(evento.slug, persona.email, spunta);

    const [testo] = await conferme();
    expect(testo).toContain(NOTA);
    expect(testo).toContain('/privacy/');
  });

  it('senza ritiri non c’e’ niente da dire', async () => {
    const evento = await eventoAperto();
    await iscriviti(evento.slug, `${randomUUID()}@example.org`, spunta);
    expect((await conferme())[0]).not.toContain(NOTA);
  });
});

describe('la conferma vale per l’indirizzo', () => {
  /** Due spunte in attesa dello stesso indirizzo, su due eventi. */
  async function dueInAttesa(
    campiSeconda: Partial<Prisma.EventUncheckedCreateInput> = {}
  ) {
    const persona = await ritirata();
    const primo = await eventoAperto();
    const secondo = await eventoAperto();
    await iscriviti(primo.slug, persona.email, spunta);
    await iscriviti(secondo.slug, persona.email, {
      ...spunta,
      organization: 'Ente della seconda',
    });
    if (Object.keys(campiSeconda).length > 0) {
      await prisma.event.update({ where: { id: secondo.id }, data: campiSeconda });
    }
    return {
      persona,
      primo,
      secondo,
      r1: await iscrizione(primo.id, persona.emailHash),
      r2: await iscrizione(secondo.id, persona.emailHash),
    };
  }

  it('chiude ogni spunta in attesa: voce, consenso e registro valgono per tutte', async () => {
    const { persona, primo, secondo, r1 } = await dueInAttesa();

    await daiMieiDati(persona.emailHash, {
      registrationId: r1.id,
      confirmAddressBook: true,
    });

    for (const eventoId of [primo.id, secondo.id]) {
      expect(await iscrizione(eventoId, persona.emailHash)).toMatchObject({
        addressBookPending: false,
        consentFutureCommunications: true,
        personId: persona.id,
      });
      const registro = await prisma.gdprAuditLog.findMany({
        where: {
          eventId: eventoId,
          action: 'CONSENT_RECORDED',
          details: { contains: 'self-service' },
        },
      });
      expect(registro).toHaveLength(1);
    }
    expect(await invitiFermi(persona.emailHash)).toBe(0);
  });

  it('un altro clic dalla seconda iscrizione non trova niente e non rinnova il consenso', async () => {
    const { persona, r1, r2 } = await dueInAttesa();
    await daiMieiDati(persona.emailHash, {
      registrationId: r1.id,
      confirmAddressBook: true,
    });
    const dopo = await prisma.person.findUniqueOrThrow({ where: { id: persona.id } });

    const seconda = await daiMieiDati(persona.emailHash, {
      registrationId: r2.id,
      confirmAddressBook: true,
    });

    expect(seconda.status).toBe(404);
    const voce = await prisma.person.findUniqueOrThrow({ where: { id: persona.id } });
    expect(voce.optedInAt).toEqual(dopo.optedInAt);
    expect(voce.organization).toBe(dopo.organization);
    expect(voce.organization).not.toBe('Ente della seconda');
  });

  it('una spunta su un evento che non offre piu’ la rubrica si chiude senza consenso', async () => {
    const { persona, primo, secondo, r1 } = await dueInAttesa({
      offerAddressBook: false,
    });

    await daiMieiDati(persona.emailHash, {
      registrationId: r1.id,
      confirmAddressBook: true,
    });

    expect(await iscrizione(primo.id, persona.emailHash)).toMatchObject({
      consentFutureCommunications: true,
    });
    expect(await iscrizione(secondo.id, persona.emailHash)).toMatchObject({
      addressBookPending: false,
      consentFutureCommunications: false,
    });
    expect(await righeSpuntaTolta(secondo.id)).toEqual([
      {
        source: 'self-service',
        futureCommunications: 0,
        addressBookPending: 1,
        reason: 'address-book-not-offered',
      },
    ]);
    expect(
      await prisma.gdprAuditLog.count({
        where: { eventId: secondo.id, action: 'CONSENT_RECORDED', details: { contains: 'self-service' } },
      })
    ).toBe(0);
  });
});

describe('dove la rubrica non si propone piu’', () => {
  async function inAttesaPoiSpenta(spegni: () => Promise<unknown>) {
    const persona = await ritirata();
    await corsaConservazione();
    const evento = await eventoAperto();
    await iscriviti(evento.slug, persona.email, spunta);
    await spegni();
    return { persona, evento, reg: await iscrizione(evento.id, persona.emailHash) };
  }

  const prove: [string, () => Promise<unknown>][] = [
    [
      'l’evento non la offre',
      () => prisma.event.updateMany({ data: { offerAddressBook: false } }),
    ],
    [
      'l’installazione l’ha spenta',
      async () => {
        await prisma.siteSetting.upsert({
          where: { id: 'singleton' },
          create: { addressBookEnabled: false },
          update: { addressBookEnabled: false },
        });
        invalidateSettingsCache();
      },
    ],
  ];

  it.each(prove)('%s: la pagina dei propri dati non crea la voce', async (_, spegni) => {
    const { persona, evento, reg } = await inAttesaPoiSpenta(spegni);
    const voci = await prisma.person.count();

    const risposta = await daiMieiDati(persona.emailHash, {
      registrationId: reg.id,
      confirmAddressBook: true,
    });

    expect(risposta.status).toBe(404);
    expect(await prisma.person.count()).toBe(voci);
    expect(await iscrizione(evento.id, persona.emailHash)).toMatchObject({
      addressBookPending: false,
      consentFutureCommunications: false,
    });
    expect(await invitiFermi(persona.emailHash)).toBe(1);
    expect(await righeSpuntaTolta(evento.id)).toEqual([
      {
        source: 'self-service',
        futureCommunications: 0,
        addressBookPending: 1,
        reason: 'address-book-not-offered',
      },
    ]);
  });

  it('il link dell’email non crea la voce, e la sala si apre', async () => {
    const { persona, evento, reg } = await inAttesaPoiSpenta(() =>
      prisma.event.updateMany({ data: { offerAddressBook: false } })
    );
    await browserDi(evento.id, reg.accessToken);
    const voci = await prisma.person.count();

    const risposta = await apri(evento.slug, {
      token: reg.accessToken,
      proof: signRegistrationProof(evento.id, reg.accessToken),
    });

    expect(risposta.status).toBeLessThan(400);
    expect(await prisma.person.count()).toBe(voci);
    expect((await iscrizione(evento.id, persona.emailHash)).addressBookPending).toBe(
      false
    );
    expect(await righeSpuntaTolta(evento.id)).toEqual([
      {
        source: 'registration-link',
        futureCommunications: 0,
        addressBookPending: 1,
        reason: 'address-book-not-offered',
      },
    ]);
  });

  it('una seconda conferma non trova niente e non scrive un’altra riga', async () => {
    const { persona, evento, reg } = await inAttesaPoiSpenta(() =>
      prisma.event.updateMany({ data: { offerAddressBook: false } })
    );
    const conferma = { registrationId: reg.id, confirmAddressBook: true };

    await daiMieiDati(persona.emailHash, conferma);
    await daiMieiDati(persona.emailHash, conferma);

    expect(await righeSpuntaTolta(evento.id)).toHaveLength(1);
  });
});

describe('il registro ricorda la spunta annullata', () => {
  it('dalla pagina dei propri dati: una riga con la spunta annullata', async () => {
    const persona = await ritirata();
    await iscriviti(persona.riservato.slug, persona.email, spunta);
    const reg = await iscrizione(persona.riservato.id, persona.emailHash);

    await daiMieiDati(persona.emailHash, {
      registrationId: reg.id,
      consent: 'futureCommunications',
    });

    const righe = await prisma.gdprAuditLog.findMany({
      where: { eventId: persona.riservato.id, action: 'CONSENT_WITHDRAWN' },
    });
    expect(righe.map((r) => JSON.parse(r.details ?? '{}'))).toEqual([
      { source: 'self-service', futureCommunications: 0, addressBookPending: 1 },
    ]);
  });
});

describe('le email di un invito seguono l’invito', () => {
  /** Un invito su un evento riservato, gia' accodato verso il suo indirizzo. */
  async function invitoInCoda(email = `${randomUUID()}@example.org`) {
    const evento = await eventoAperto({ accessMode: 'INVITATION' });
    const invito = await prisma.eventInvitation.create({
      data: { eventId: evento.id, email: encryptPII(email), emailHash: hashEmail(email) },
    });
    expect(await sendInvitations(evento.id, { locale: 'it' })).toMatchObject({ sent: 1 });
    return { evento, invito, email };
  }

  it.each(['PENDING', 'SENT'] as const)(
    'corretto l’indirizzo dopo un invio %s, l’invito parte verso quello nuovo e solo lì',
    async (stato) => {
      const { evento, invito } = await invitoInCoda();
      await prisma.emailOutbox.updateMany({ data: { status: stato } });

      await cambiaIndirizzo(evento.id, invito.id, 'nuova@example.org');

      expect(await emailInviti()).toEqual([]);
      expect(await sendInvitations(evento.id, { locale: 'it' })).toMatchObject({
        sent: 1,
        skipped: 0,
      });
      expect(await emailInviti()).toEqual([['nuova@example.org', 'PENDING']]);
    }
  );

  it('da A a B e di nuovo ad A l’invito riparte ogni volta', async () => {
    const { evento, invito, email } = await invitoInCoda();

    await cambiaIndirizzo(evento.id, invito.id, 'nuova@example.org');
    await sendInvitations(evento.id, { locale: 'it' });
    await cambiaIndirizzo(evento.id, invito.id, email);

    expect(await sendInvitations(evento.id, { locale: 'it' })).toMatchObject({ sent: 1 });
    expect(await emailInviti()).toEqual([[email, 'PENDING']]);
    expect(
      (await prisma.eventInvitation.findUniqueOrThrow({ where: { id: invito.id } }))
        .sentAt
    ).not.toBeNull();
  });

  it('riscrivendo lo stesso indirizzo l’email resta e non ne parte un’altra', async () => {
    const { evento, invito, email } = await invitoInCoda();

    await cambiaIndirizzo(evento.id, invito.id, email.toUpperCase());

    expect(await emailInviti()).toEqual([[email, 'PENDING']]);
  });

  it('un indirizzo gia’ preso da un altro invito risponde 409 e le email restano', async () => {
    const { evento, invito, email } = await invitoInCoda();
    await prisma.eventInvitation.create({
      data: {
        eventId: evento.id,
        email: encryptPII('occupata@example.org'),
        emailHash: hashEmail('occupata@example.org'),
      },
    });

    const risposta = await cambiaIndirizzo(evento.id, invito.id, 'occupata@example.org');

    expect(risposta.status).toBe(409);
    expect(await emailInviti()).toEqual([[email, 'PENDING']]);
  });

  it('cancellato l’invito, l’email in coda non parte e quella inviata resta', async () => {
    const { evento, invito } = await invitoInCoda();
    const inviata = await invitoInCoda();
    await prisma.emailOutbox.updateMany({
      where: { dedupKey: { contains: inviata.invito.id } },
      data: { status: 'SENT' },
    });

    for (const { eventId, id } of [invito, inviata.invito]) {
      const risposta = await cancellaInvito(
        richiesta(`/api/admin/events/${eventId}/invitations/${id}`, 'DELETE') as never,
        { params: Promise.resolve({ id: eventId, invId: id }) }
      );
      expect(risposta.status).toBe(200);
    }

    expect(await prisma.eventInvitation.count({ where: { eventId: evento.id } })).toBe(0);
    expect(await emailInviti()).toEqual([[inviata.email, 'SENT']]);
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

  it('se la riga era l’unica traccia del ritiro, da A a B e ritorno lo stop si perde', async () => {
    const persona = await ritirata();
    await prisma.person.deleteMany();
    await prisma.registration.deleteMany();
    const invito = await prisma.eventInvitation.findFirstOrThrow({
      where: { emailHash: persona.emailHash },
    });

    await cambiaIndirizzo(persona.riservato.id, invito.id, 'altra@example.org');
    await cambiaIndirizzo(persona.riservato.id, invito.id, persona.email);

    expect(
      (await prisma.eventInvitation.findUniqueOrThrow({ where: { id: invito.id } }))
        .declinedAt
    ).toBeNull();
  });

  it('un indirizzo senza ritiri parte normalmente', async () => {
    const { riservato, invito } = await fermatoSenzaVoce();

    await cambiaIndirizzo(riservato.id, invito.id, 'altra@example.org');

    expect(await sendInvitations(riservato.id, { locale: 'it' })).toMatchObject({
      sent: 1,
    });
  });
});

// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * La rubrica su un database vero: l'email vive nella voce e sopravvive alle
 * iscrizioni, i mesi si contano dal consenso e solo una nuova spunta li rinnova,
 * il ritiro toglie l'indirizzo e ferma gli inviti, senza togliere l'accesso a chi
 * e' nell'elenco di un evento a iscrizione non aperta. In coda il riempimento
 * delle voci nate prima che conservassero l'email: la migrazione gira sulle
 * righe di prova con lo stesso SQL che gira in produzione.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DELETE as cancellaVoce } from '@/app/api/admin/rubrica/[id]/route';
import { GET as elencoRubrica, POST as cercaRubrica } from '@/app/api/admin/rubrica/route';
import { GET as conservazione } from '@/app/api/cron/rubrica-retention/route';
import { POST as cancellazione } from '@/app/api/gdpr/erasure/route';
import { POST as esceDalLink } from '@/app/api/rubrica/opt-out/route';
import messaggi from '@/i18n/messages/it.json';
import { encryptPII, hashEmail, tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { sendInvitations } from '@/lib/email/invitation';
import { isInvited, registrationAccessFor } from '@/lib/events/registration-access';
import { issueGdprToken } from '@/lib/gdpr/request-token';
import { ritiraComunicazioni } from '@/lib/live/consent-withdrawal';
import { upsertPersonOnRegistration } from '@/lib/persons';
import {
  issueRubricaOptOutToken,
  verifyRubricaOptOutToken,
} from '@/lib/persons/opt-out-token';
import { rubricaConPersone } from '@/lib/persons/rubrica-picker';
import { invalidateSettingsCache } from '@/lib/settings';

import {
  creaEvento,
  creaIscrizione,
  entraCome,
  richiesta,
  svuotaDatabase,
} from './fixtures';

// I testi veri del catalogo: una chiave sbagliata qui si vede.
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (chiave: 'addressBookNote' | 'addressBookOptOutLink') =>
    messaggi.email[chiave],
}));

beforeEach(svuotaDatabase);

const senzaParametri = { params: Promise.resolve({}) };
const giorni = (n: number) => new Date(Date.now() - n * 86_400_000);

function nuovoIndirizzo() {
  const email = `${randomUUID()}@example.org`;
  return { email, emailHash: hashEmail(email), cifrata: encryptPII(email) };
}

/** Una voce di rubrica scritta come la scrive un'iscrizione con la spunta. */
async function voce(campi: { optedInAt?: Date | null; retentionMonths?: number } = {}) {
  const indirizzo = nuovoIndirizzo();
  const persona = await prisma.person.create({
    data: {
      emailHash: indirizzo.emailHash,
      email: indirizzo.cifrata,
      displayName: encryptPII('Persona in rubrica'),
      optedInToAddressBook: true,
      optedInAt: new Date(),
      ...campi,
    },
  });
  return { ...indirizzo, persona };
}

async function cerca(corpo: object) {
  await entraCome('ADMIN');
  const risposta = await cercaRubrica(
    richiesta('/api/admin/rubrica', 'POST', corpo) as never,
    senzaParametri
  );
  expect(risposta.status).toBe(200);
  return (await risposta.json()) as {
    rows: { id: string; displayName: string | null; email?: string | null }[];
    total: number;
  };
}

/** Quello che il selettore puo' proporre: ogni indirizzo contiene la chiocciola. */
async function selettore() {
  return (await cerca({ q: '@', withEmail: true })).rows;
}

function corsaConservazione() {
  return conservazione(
    new Request('http://localhost/api/cron/rubrica-retention', {
      headers: { 'x-api-key': process.env.CRON_API_KEY ?? '' },
    }) as never,
    senzaParametri
  );
}

describe('iscrizione e consenso', () => {
  it('la prima spunta salva il cifrato dell’iscrizione, decifrabile dal selettore', async () => {
    const { email, emailHash, cifrata } = nuovoIndirizzo();
    const id = await upsertPersonOnRegistration(prisma, {
      emailHash,
      email: cifrata,
      displayName: 'Nome',
      optedIn: true,
    });
    const riga = await prisma.person.findUniqueOrThrow({ where: { id: id! } });
    expect(riga.email).toBe(cifrata);
    expect((await selettore()).map((r) => r.email)).toEqual([email]);
  });

  it('un’iscrizione senza spunta non sposta il consenso e non tocca la voce', async () => {
    const prima = giorni(100);
    const { persona, emailHash } = await voce({ optedInAt: prima });
    const id = await upsertPersonOnRegistration(prisma, {
      emailHash,
      email: nuovoIndirizzo().cifrata,
      displayName: 'Altro nome',
      optedIn: false,
    });
    expect(id).toBe(persona.id);
    const riga = await prisma.person.findUniqueOrThrow({ where: { id: persona.id } });
    expect(riga).toEqual(persona);
  });

  it('una nuova spunta rinnova la data e aggiorna l’email', async () => {
    const { persona, emailHash } = await voce({ optedInAt: giorni(100) });
    const dopo = nuovoIndirizzo();
    await upsertPersonOnRegistration(prisma, {
      emailHash,
      email: dopo.cifrata,
      optedIn: true,
    });
    const riga = await prisma.person.findUniqueOrThrow({ where: { id: persona.id } });
    expect(riga.optedInAt!.getTime()).toBeGreaterThan(giorni(1).getTime());
    expect(riga.email).toBe(dopo.cifrata);
  });

  it('una spunta dopo il ritiro riapre la voce, con l’indirizzo', async () => {
    const { persona, emailHash, cifrata } = await voce();
    await ritiraComunicazioni(emailHash);
    await upsertPersonOnRegistration(prisma, {
      emailHash,
      email: cifrata,
      optedIn: true,
    });
    const riga = await prisma.person.findUniqueOrThrow({ where: { id: persona.id } });
    expect(riga).toMatchObject({
      optedInToAddressBook: true,
      optedOutAt: null,
      email: cifrata,
    });
  });
});

describe('ricerca', () => {
  /** Una voce come quelle del modulo predefinito: senza ente. */
  async function voceConNome(nome: string) {
    const creata = await voce();
    await prisma.person.update({
      where: { id: creata.persona.id },
      data: { displayName: encryptPII(nome) },
    });
    return creata;
  }

  it("una voce senza ente si trova per nome e per email, e si puo' invitare", async () => {
    const { persona, email } = await voceConNome('Nicolò Prova');
    await voceConNome('Altra Persona');
    for (const q of ['nicolò', 'NICOLO', email.slice(4, 16)]) {
      const { rows, total } = await cerca({ q, withEmail: true });
      expect(rows.map((r) => r.id), q).toEqual([persona.id]);
      expect(rows[0]?.email).toBe(email);
      expect(total).toBe(1);
    }
  });

  it("l'elenco senza testo non restituisce indirizzi, nemmeno a chiederli", async () => {
    const { persona } = await voce();
    await entraCome('ADMIN');
    const risposta = await elencoRubrica(
      richiesta('/api/admin/rubrica?withEmail=1') as never,
      senzaParametri
    );
    const { rows } = (await risposta.json()) as { rows: { id: string }[] };
    expect(rows.map((r) => r.id)).toEqual([persona.id]);
    expect(rows[0]).not.toHaveProperty('email');
  });

  it('una voce si trova per ente, anche dalla pagina della rubrica', async () => {
    const { persona } = await voce();
    await prisma.person.update({
      where: { id: persona.id },
      data: { organization: 'Comune di Prova' },
    });
    const { rows } = await cerca({ q: 'comune di' });
    expect(rows.map((r) => r.id)).toEqual([persona.id]);
    expect(rows[0]).not.toHaveProperty('email');
  });

  it('chi ha ritirato il consenso non si trova nel selettore', async () => {
    const { emailHash } = await voceConNome('Persona Ritirata');
    await ritiraComunicazioni(emailHash);
    expect((await cerca({ q: 'ritirata', withEmail: true })).rows).toEqual([]);
    expect((await cerca({ q: 'ritirata' })).rows).toEqual([]);
    expect((await cerca({ q: 'ritirata', includeOptedOut: true })).rows).toHaveLength(1);
  });
});

describe('selettore', () => {
  it('non dipende dalle iscrizioni: la voce resta quando se ne vanno', async () => {
    const { email, persona } = await voce();
    const evento = await creaEvento();
    const iscrizione = await creaIscrizione(evento.id);
    await prisma.registration.update({
      where: { id: iscrizione.id },
      data: { personId: persona.id },
    });
    await prisma.registration.delete({ where: { id: iscrizione.id } });

    expect(await rubricaConPersone()).toBe(true);
    expect((await selettore()).map((r) => r.email)).toEqual([email]);
  });

  it('una voce senza email non si propone', async () => {
    await prisma.person.create({
      data: {
        emailHash: randomUUID(),
        optedInToAddressBook: true,
        optedInAt: new Date(),
      },
    });
    expect(await rubricaConPersone()).toBe(false);
    expect(await selettore()).toEqual([]);
  });

  it('spenta dall’installazione non si propone, e la voce resta', async () => {
    await voce();
    await prisma.siteSetting.create({ data: { addressBookEnabled: false } });
    invalidateSettingsCache();
    expect(await rubricaConPersone()).toBe(false);
    expect(await prisma.person.count()).toBe(1);
  });
});

describe('conservazione', () => {
  it('conta dal consenso, non dall’ultima attività', async () => {
    const scaduta = await voce({ optedInAt: giorni(800) });
    await prisma.person.update({
      where: { id: scaduta.persona.id },
      data: { lastActiveAt: new Date() },
    });
    const dentro = await voce({ optedInAt: giorni(30) });

    const risposta = await corsaConservazione();

    expect(risposta.status).toBe(200);
    expect(await risposta.json()).toMatchObject({
      expiredDeleted: 1,
      optedOutDeleted: 0,
    });
    expect(await prisma.person.findMany({ select: { id: true } })).toEqual([
      { id: dentro.persona.id },
    ]);
  });

  it('una voce senza data resta: non diventa il 1970', async () => {
    const { persona } = await voce({ optedInAt: null });
    expect(await (await corsaConservazione()).json()).toMatchObject({
      expiredDeleted: 0,
    });
    expect(await prisma.person.count({ where: { id: persona.id } })).toBe(1);
  });

  it('con la voce scaduta spariscono gli inviti non spediti, quelli spediti restano', async () => {
    const { persona, cifrata, emailHash } = await voce({ optedInAt: giorni(800) });
    const evento = await creaEvento();
    const altro = await creaEvento();
    await prisma.eventInvitation.create({
      data: { eventId: evento.id, personId: persona.id, email: cifrata, emailHash },
    });
    const spedito = await prisma.eventInvitation.create({
      data: {
        eventId: altro.id,
        personId: persona.id,
        email: cifrata,
        emailHash,
        sentAt: new Date(),
      },
    });

    await corsaConservazione();

    expect(await prisma.eventInvitation.findMany({ select: { id: true } })).toEqual([
      { id: spedito.id },
    ]);
  });
});

describe('ritiro', () => {
  it('dal link: l’email se ne va subito, la riga alla corsa successiva', async () => {
    const { persona } = await voce();
    const risposta = await esceDalLink(
      new Request(
        `http://localhost/api/rubrica/opt-out?token=${encodeURIComponent(issueRubricaOptOutToken(persona.id))}`,
        { method: 'POST' }
      ) as never,
      senzaParametri
    );
    expect(risposta.status).toBe(200);
    expect(
      await prisma.person.findUniqueOrThrow({ where: { id: persona.id } })
    ).toMatchObject({
      email: null,
      optedInToAddressBook: false,
    });
    expect(await selettore()).toEqual([]);

    expect(await (await corsaConservazione()).json()).toMatchObject({
      optedOutDeleted: 1,
    });
    expect(await prisma.person.count()).toBe(0);
  });

  it('toglie gli inviti non spediti; un invito rimandato dopo il ritiro non parte', async () => {
    const { persona, cifrata, emailHash } = await voce();
    const evento = await creaEvento({
      status: 'PUBLISHED',
      startsAt: giorni(-5),
      endsAt: giorni(-6),
    });
    const altro = await creaEvento({
      status: 'PUBLISHED',
      startsAt: giorni(-5),
      endsAt: giorni(-6),
    });
    await prisma.eventInvitation.create({
      data: { eventId: evento.id, personId: persona.id, email: cifrata, emailHash },
    });
    // Scritto a mano e gia' spedito una volta: niente collegamento alla voce.
    const aMano = await prisma.eventInvitation.create({
      data: { eventId: altro.id, email: cifrata, emailHash, sentAt: giorni(1) },
    });

    await ritiraComunicazioni(emailHash);

    expect(await prisma.eventInvitation.count({ where: { eventId: evento.id } })).toBe(0);
    expect(await sendInvitations(altro.id, { ids: [aMano.id], locale: 'it' })).toEqual({
      sent: 0,
      skipped: 1,
      remaining: 0,
    });
    expect(await prisma.emailOutbox.count()).toBe(0);
  });
});

describe('inviti fermati', () => {
  const aperto = {
    status: 'PUBLISHED',
    startsAt: giorni(-5),
    endsAt: giorni(-6),
  } as const;

  /** Una riga dell'elenco degli invitati, con il suo indirizzo. */
  function invito(
    eventId: string,
    persona: { email: string; emailHash: string; cifrata: string },
    campi: { personId?: string; sentAt?: Date } = {}
  ) {
    return prisma.eventInvitation.create({
      data: { eventId, email: persona.cifrata, emailHash: persona.emailHash, ...campi },
    });
  }

  it('ritiro su un evento aperto: l’invito scritto a mano se ne va, anche dopo la corsa non parte', async () => {
    const persona = await voce();
    const evento = await creaEvento({ ...aperto, accessMode: 'OPEN' });
    await invito(evento.id, persona);

    await ritiraComunicazioni(persona.emailHash);
    await corsaConservazione();

    expect(await prisma.eventInvitation.count()).toBe(0);
    expect(await sendInvitations(evento.id, { locale: 'it' })).toMatchObject({ sent: 0 });
    expect(await prisma.emailOutbox.count()).toBe(0);
  });

  it('ritiro su un evento solo su invito: l’accesso resta, l’email non parte', async () => {
    const persona = await voce();
    const evento = await creaEvento({ ...aperto, accessMode: 'INVITATION' });
    await invito(evento.id, persona);

    await ritiraComunicazioni(persona.emailHash);
    expect(await (await corsaConservazione()).json()).toMatchObject({
      optedOutDeleted: 1,
    });

    expect(await prisma.person.count()).toBe(0);
    expect(await isInvited(prisma, evento.id, persona.email)).toBe(true);
    expect(await registrationAccessFor(evento, true)).toBe('invitation');
    expect(await sendInvitations(evento.id, { locale: 'it' })).toEqual({
      sent: 0,
      skipped: 1,
      remaining: 0,
    });
    expect(await prisma.emailOutbox.count()).toBe(0);
  });

  it('il ritiro vale anche per chi non è in rubrica: l’invito scritto a mano si ferma', async () => {
    const indirizzo = nuovoIndirizzo();
    const evento = await creaEvento({ ...aperto, accessMode: 'INVITATION' });
    await invito(evento.id, indirizzo);

    await ritiraComunicazioni(indirizzo.emailHash);

    expect(await sendInvitations(evento.id, { locale: 'it' })).toMatchObject({ sent: 0 });
    expect(await isInvited(prisma, evento.id, indirizzo.email)).toBe(true);
  });

  it('un invito scritto a mano tra il ritiro e la corsa non parte dopo la corsa', async () => {
    const persona = await voce();
    const evento = await creaEvento({ ...aperto, accessMode: 'INVITATION' });
    await ritiraComunicazioni(persona.emailHash);
    await invito(evento.id, persona);

    await corsaConservazione();

    expect(await sendInvitations(evento.id, { locale: 'it' })).toMatchObject({ sent: 0 });
    expect(await isInvited(prisma, evento.id, persona.email)).toBe(true);
  });

  it('un invito già spedito non si rimanda dopo il ritiro e la corsa', async () => {
    const persona = await voce();
    const evento = await creaEvento({ ...aperto, accessMode: 'OPEN' });
    const riga = await invito(evento.id, persona, { sentAt: giorni(1) });

    await ritiraComunicazioni(persona.emailHash);
    await corsaConservazione();

    expect(
      await sendInvitations(evento.id, { ids: [riga.id], locale: 'it' })
    ).toMatchObject({
      sent: 0,
      skipped: 1,
    });
  });

  it('senza una scelta dell’evento vale il sito: chiuso, la riga è l’elenco di accesso', async () => {
    await prisma.siteSetting.create({ data: { publicRegistrationEnabled: false } });
    invalidateSettingsCache();
    const persona = await voce();
    const evento = await creaEvento({ ...aperto, accessMode: null });
    await invito(evento.id, persona);

    await ritiraComunicazioni(persona.emailHash);

    expect(await isInvited(prisma, evento.id, persona.email)).toBe(true);
  });

  it('voce scaduta su un evento solo su invito: l’accesso resta, l’email non parte', async () => {
    const persona = await voce({ optedInAt: giorni(800) });
    const evento = await creaEvento({ ...aperto, accessMode: 'INVITATION' });
    await invito(evento.id, persona, { personId: persona.persona.id });

    expect(await (await corsaConservazione()).json()).toMatchObject({
      expiredDeleted: 1,
    });

    expect(await isInvited(prisma, evento.id, persona.email)).toBe(true);
    expect(await registrationAccessFor(evento, true)).toBe('invitation');
    expect(await sendInvitations(evento.id, { locale: 'it' })).toMatchObject({ sent: 0 });
  });

  it('voce scaduta: l’invito scritto a mano non è suo e parte', async () => {
    const persona = await voce({ optedInAt: giorni(800) });
    const evento = await creaEvento({ ...aperto, accessMode: 'OPEN' });
    await invito(evento.id, persona);

    await corsaConservazione();

    expect(await sendInvitations(evento.id, { locale: 'it' })).toMatchObject({ sent: 1 });
  });

  it('cancellando la voce a mano gli inviti non partono, e l’elenco di accesso resta', async () => {
    const persona = await voce();
    const libero = await creaEvento({ ...aperto, accessMode: 'OPEN' });
    const riservato = await creaEvento({ ...aperto, accessMode: 'INVITATION' });
    await invito(libero.id, persona, { personId: persona.persona.id });
    await invito(riservato.id, persona, { personId: persona.persona.id });
    await entraCome('ADMIN');

    const risposta = await cancellaVoce(
      richiesta(`/api/admin/rubrica/${persona.persona.id}`, 'DELETE') as never,
      { params: Promise.resolve({ id: persona.persona.id }) }
    );

    expect(risposta.status).toBe(200);
    expect(await prisma.person.count()).toBe(0);
    expect(await prisma.eventInvitation.count({ where: { eventId: libero.id } })).toBe(0);
    expect(await isInvited(prisma, riservato.id, persona.email)).toBe(true);
    expect(await sendInvitations(riservato.id, { locale: 'it' })).toMatchObject({
      sent: 0,
    });
  });

  it('una spunta dal modulo non riapre gli inviti fermati', async () => {
    const persona = await voce();
    const evento = await creaEvento({ ...aperto, accessMode: 'INVITATION' });
    await invito(evento.id, persona);
    await ritiraComunicazioni(persona.emailHash);
    await corsaConservazione();

    await upsertPersonOnRegistration(prisma, {
      emailHash: persona.emailHash,
      email: persona.cifrata,
      optedIn: true,
    });

    expect(await sendInvitations(evento.id, { locale: 'it' })).toMatchObject({ sent: 0 });
  });

  it('il ritiro toglie le email in coda degli inviti, anche con la voce sparita', async () => {
    const persona = await voce();
    const evento = await creaEvento({ ...aperto, accessMode: 'OPEN' });
    await invito(evento.id, persona);
    expect(await sendInvitations(evento.id, { locale: 'it' })).toMatchObject({ sent: 1 });
    // Una fallita in attesa di un nuovo tentativo e una gia' partita, di due inviti.
    const altri = await creaEvento({ ...aperto, accessMode: 'INVITATION' });
    const fallito = await invito(altri.id, persona, { sentAt: giorni(1) });
    const riservato = await creaEvento({ ...aperto, accessMode: 'INVITATION' });
    const spedito = await invito(riservato.id, persona, { sentAt: giorni(1) });
    await prisma.emailOutbox.createMany({
      data: [
        {
          toAddress: persona.cifrata,
          subject: 'Invito',
          html: 'x',
          status: 'FAILED',
          dedupKey: `event-invitation:${fallito.id}:primo`,
        },
        {
          toAddress: persona.cifrata,
          subject: 'Invito',
          html: 'x',
          status: 'SENT',
          dedupKey: `event-invitation:${spedito.id}:primo`,
        },
        // Un'altra email: non e' un invito e resta.
        { toAddress: persona.cifrata, subject: 'Conferma', html: 'x' },
      ],
    });

    await ritiraComunicazioni(persona.emailHash);

    const rimaste = await prisma.emailOutbox.findMany({ select: { subject: true, status: true } });
    expect(rimaste).toHaveLength(2);
    expect(rimaste).toEqual(
      expect.arrayContaining([
        { subject: 'Invito', status: 'SENT' },
        { subject: 'Conferma', status: 'PENDING' },
      ])
    );
  });

  it('la scadenza della voce toglie dalla coda solo gli inviti nati dalla rubrica', async () => {
    const persona = await voce({ optedInAt: giorni(800) });
    const evento = await creaEvento({ ...aperto, accessMode: 'OPEN' });
    await invito(evento.id, persona, { personId: persona.persona.id });
    expect(await sendInvitations(evento.id, { locale: 'it' })).toMatchObject({ sent: 1 });
    const altro = nuovoIndirizzo();
    await invito(evento.id, altro);
    expect(await sendInvitations(evento.id, { locale: 'it' })).toMatchObject({ sent: 1 });
    expect(await prisma.emailOutbox.count()).toBe(2);

    await corsaConservazione();

    expect(await prisma.emailOutbox.count()).toBe(1);
  });

  it('la cancellazione chiesta dalla persona toglie gli inviti e tutte le loro email', async () => {
    const persona = await voce();
    const evento = await creaEvento({ ...aperto, accessMode: 'OPEN' });
    await invito(evento.id, persona);
    await sendInvitations(evento.id, { locale: 'it' });
    await prisma.emailOutbox.updateMany({ data: { status: 'SENT' } });
    const riservato = await creaEvento({ ...aperto, accessMode: 'INVITATION' });
    await invito(riservato.id, persona);
    await sendInvitations(riservato.id, { locale: 'it' });
    expect(await prisma.emailOutbox.count()).toBe(2);

    const risposta = await cancellazione(
      new Request(
        `http://localhost/api/gdpr/erasure?t=${issueGdprToken('erasure', persona.emailHash)}`,
        { method: 'POST', headers: { 'x-forwarded-for': '10.7.0.1' } }
      ) as never,
      senzaParametri
    );

    expect(risposta.status).toBe(200);
    expect(await prisma.eventInvitation.count()).toBe(0);
    expect(await prisma.emailOutbox.count()).toBe(0);
  });
});

describe('indici', () => {
  it('iscrizioni e inviti si cercano per indirizzo senza scandire la tabella', async () => {
    const indici = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE indexdef LIKE '%(email_hash)'
        AND tablename IN ('registrations', 'event_invitations')`;
    expect(indici.map((i) => i.indexname).sort()).toEqual([
      'event_invitations_email_hash_idx',
      'registrations_email_hash_idx',
    ]);
  });
});

describe('la corsa e una spunta concorrente', () => {
  /** Scrive `mentre` subito dopo la lettura numero `n` delle voci. */
  function dopoLaLettura(n: number, mentre: () => Promise<unknown>) {
    const originale = prisma.person.findMany.bind(prisma.person);
    let letture = 0;
    return vi.spyOn(prisma.person, 'findMany').mockImplementation(((args: never) => {
      letture += 1;
      const lettura = originale(args);
      return letture === n ? lettura.then(async (r: unknown) => (await mentre(), r)) : lettura;
    }) as never);
  }

  const rinnova = (emailHash: string, email: string) =>
    upsertPersonOnRegistration(prisma, { emailHash, email, optedIn: true });

  it('una voce ritirata che rispunta dopo la lettura resta, con email e inviti', async () => {
    const persona = await voce();
    const evento = await creaEvento({
      status: 'PUBLISHED',
      accessMode: 'INVITATION',
      startsAt: giorni(-5),
      endsAt: giorni(-6),
    });
    await prisma.eventInvitation.create({
      data: {
        eventId: evento.id,
        email: persona.cifrata,
        emailHash: persona.emailHash,
        personId: persona.persona.id,
      },
    });
    await ritiraComunicazioni(persona.emailHash);
    await prisma.eventInvitation.updateMany({ data: { declinedAt: null } });
    const spia = dopoLaLettura(1, () => rinnova(persona.emailHash, persona.cifrata));

    const esito = await (await corsaConservazione()).json();
    spia.mockRestore();

    expect(esito).toMatchObject({ optedOutDeleted: 0 });
    expect(
      await prisma.person.findUniqueOrThrow({ where: { id: persona.persona.id } })
    ).toMatchObject({ optedInToAddressBook: true, email: persona.cifrata });
    expect(await prisma.eventInvitation.count({ where: { declinedAt: { not: null } } })).toBe(0);
  });

  it('una voce scaduta che rispunta dopo la lettura resta', async () => {
    const persona = await voce({ optedInAt: giorni(800) });
    // La seconda lettura e' quella delle voci da far scadere.
    const spia = dopoLaLettura(2, () => rinnova(persona.emailHash, persona.cifrata));

    const esito = await (await corsaConservazione()).json();
    spia.mockRestore();

    expect(esito).toMatchObject({ expiredDeleted: 0 });
    expect(await prisma.person.count()).toBe(1);
  });
});

describe('inviti', () => {
  it('trova la voce per impronta e porta un link di uscita', async () => {
    const { persona, cifrata, emailHash } = await voce();
    const evento = await creaEvento({
      status: 'PUBLISHED',
      startsAt: giorni(-5),
      endsAt: giorni(-6),
    });
    await prisma.eventInvitation.create({
      data: { eventId: evento.id, email: cifrata, emailHash },
    });
    expect(await sendInvitations(evento.id, { locale: 'it' })).toMatchObject({ sent: 1 });
    const mail = await prisma.emailOutbox.findFirstOrThrow();
    const testo = tryDecryptPII(mail.text) ?? '';
    expect(testo).toContain(messaggi.email.addressBookNote);
    expect(testo).toContain(`${messaggi.email.addressBookOptOutLink}: http`);
    const token = new URL(testo.match(/https?:\S+opt-out\S+/)![0]).searchParams.get(
      'token'
    )!;
    expect(verifyRubricaOptOutToken(token)).toEqual({ personId: persona.id });
  });
});

describe('riempimento delle voci esistenti', () => {
  const sql = readFileSync(
    path.resolve(
      __dirname,
      '../../../prisma/migrations/20261105210000_rubrica_con_email/migration.sql'
    ),
    'utf8'
  );

  /** Le istruzioni della migrazione, una alla volta, come le passa il driver. */
  async function applicaMigrazione() {
    const istruzioni = sql
      .split('\n')
      .filter((riga) => !riga.startsWith('--'))
      .join('\n')
      .split(';')
      .map((i) => i.trim())
      .filter(Boolean);
    expect(istruzioni).toHaveLength(3);
    for (const istruzione of istruzioni) await prisma.$executeRawUnsafe(istruzione);
  }

  async function iscrizioneDi(
    eventId: string,
    emailHash: string,
    email: string,
    quando: Date
  ) {
    return prisma.registration.create({
      data: {
        eventId,
        displayName: encryptPII('Persona Iscritta'),
        email: encryptPII(email),
        emailHash,
        consentGiven: true,
        consentTimestamp: quando,
        accessToken: randomUUID(),
        createdAt: quando,
      },
    });
  }

  it('in rubrica con iscrizioni: prende il cifrato dell’ultima, decifrabile dal selettore', async () => {
    const { email, emailHash } = nuovoIndirizzo();
    const persona = await prisma.person.create({
      data: { emailHash, optedInToAddressBook: true, optedInAt: giorni(100) },
    });
    const primo = await creaEvento();
    const secondo = await creaEvento();
    await iscrizioneDi(primo.id, emailHash, 'indirizzo-vecchio@example.org', giorni(100));
    const ultima = await iscrizioneDi(secondo.id, emailHash, email, giorni(10));

    await applicaMigrazione();

    const riga = await prisma.person.findUniqueOrThrow({ where: { id: persona.id } });
    expect(riga.email).toBe(ultima.email);
    expect(tryDecryptPII(riga.email)).toBe(email);
    expect((await selettore()).map((r) => r.email)).toEqual([email]);
  });

  it('in rubrica senza iscrizioni: resta senza email e fuori dal selettore', async () => {
    const persona = await prisma.person.create({
      data: {
        emailHash: randomUUID(),
        optedInToAddressBook: true,
        optedInAt: giorni(100),
      },
    });
    await applicaMigrazione();
    expect(
      (await prisma.person.findUniqueOrThrow({ where: { id: persona.id } })).email
    ).toBeNull();
    expect(await selettore()).toEqual([]);
  });

  it('chi ha ritirato non si riempie e non cambia', async () => {
    const { emailHash } = nuovoIndirizzo();
    const persona = await prisma.person.create({
      data: {
        emailHash,
        optedInToAddressBook: false,
        optedOutAt: giorni(5),
        optedInAt: null,
      },
    });
    await iscrizioneDi(
      (await creaEvento()).id,
      emailHash,
      'ritirata@example.org',
      giorni(10)
    );

    await applicaMigrazione();

    expect(await prisma.person.findUniqueOrThrow({ where: { id: persona.id } })).toEqual(
      persona
    );
  });

  it('in rubrica senza data di consenso: prende l’ultima attività, e da lì scade', async () => {
    const ultimaAttivita = giorni(800);
    const persona = await prisma.person.create({
      data: {
        emailHash: randomUUID(),
        optedInToAddressBook: true,
        optedInAt: null,
        lastActiveAt: ultimaAttivita,
      },
    });

    await applicaMigrazione();

    expect(
      (await prisma.person.findUniqueOrThrow({ where: { id: persona.id } })).optedInAt
    ).toEqual(ultimaAttivita);
    expect(await (await corsaConservazione()).json()).toMatchObject({
      expiredDeleted: 1,
    });
  });

  it('una spunta rinnovata con la versione precedente sposta la data del consenso', async () => {
    const { emailHash } = nuovoIndirizzo();
    const persona = await prisma.person.create({
      data: { emailHash, optedInToAddressBook: true, optedInAt: giorni(180) },
    });
    const ultimaSpunta = giorni(17);
    await prisma.registration.update({
      where: {
        id: (
          await iscrizioneDi((await creaEvento()).id, emailHash, 'p@example.org', ultimaSpunta)
        ).id,
      },
      data: { consentFutureCommunications: true },
    });
    // Un'iscrizione piu' recente senza spunta non conta.
    await iscrizioneDi((await creaEvento()).id, emailHash, 'p@example.org', giorni(3));

    await applicaMigrazione();

    expect(
      (await prisma.person.findUniqueOrThrow({ where: { id: persona.id } })).optedInAt
    ).toEqual(ultimaSpunta);
  });

  it('la data del consenso non scende mai, e senza spunte resta', async () => {
    const recente = nuovoIndirizzo();
    const consenso = giorni(5);
    const persona = await prisma.person.create({
      data: {
        emailHash: recente.emailHash,
        optedInToAddressBook: true,
        optedInAt: consenso,
      },
    });
    const vecchia = await iscrizioneDi(
      (await creaEvento()).id,
      recente.emailHash,
      recente.email,
      giorni(100)
    );
    await prisma.registration.update({
      where: { id: vecchia.id },
      data: { consentFutureCommunications: true },
    });

    await applicaMigrazione();

    expect(
      (await prisma.person.findUniqueOrThrow({ where: { id: persona.id } })).optedInAt
    ).toEqual(consenso);
  });

  it('una spunta rinnovata non sposta la data di chi ha ritirato', async () => {
    const { emailHash } = nuovoIndirizzo();
    const persona = await prisma.person.create({
      data: { emailHash, optedInToAddressBook: false, optedOutAt: giorni(1) },
    });
    const iscritta = await iscrizioneDi(
      (await creaEvento()).id,
      emailHash,
      'p@example.org',
      giorni(3)
    );
    await prisma.registration.update({
      where: { id: iscritta.id },
      data: { consentFutureCommunications: true },
    });

    await applicaMigrazione();

    expect(await prisma.person.findUniqueOrThrow({ where: { id: persona.id } })).toEqual(
      persona
    );
  });

  it('senza data ma con una spunta nota prende la spunta, non l’ultima attività', async () => {
    const { emailHash } = nuovoIndirizzo();
    const persona = await prisma.person.create({
      data: {
        emailHash,
        optedInToAddressBook: true,
        optedInAt: null,
        lastActiveAt: giorni(2),
      },
    });
    const quando = giorni(40);
    const iscritta = await iscrizioneDi(
      (await creaEvento()).id,
      emailHash,
      'p@example.org',
      quando
    );
    await prisma.registration.update({
      where: { id: iscritta.id },
      data: { consentFutureCommunications: true },
    });

    await applicaMigrazione();

    expect(
      (await prisma.person.findUniqueOrThrow({ where: { id: persona.id } })).optedInAt
    ).toEqual(quando);
  });

  it('la corsa quotidiana ripara le voci scritte dopo la migrazione, come la migrazione', async () => {
    const { email, emailHash } = nuovoIndirizzo();
    const persona = await prisma.person.create({
      data: { emailHash, optedInToAddressBook: true, optedInAt: new Date() },
    });
    const ritirata = await prisma.person.create({
      data: {
        emailHash: hashEmail('ritirata@example.org'),
        optedInToAddressBook: false,
      },
    });
    await iscrizioneDi((await creaEvento()).id, ritirata.emailHash, 'ritirata@example.org', giorni(1));
    await iscrizioneDi((await creaEvento()).id, emailHash, 'vecchio@example.org', giorni(9));
    const ultima = await iscrizioneDi((await creaEvento()).id, emailHash, email, giorni(1));

    const esito = await (await corsaConservazione()).json();

    expect(esito).toMatchObject({ emailsFilled: 1 });
    expect(
      (await prisma.person.findUniqueOrThrow({ where: { id: persona.id } })).email
    ).toBe(ultima.email);
    expect(
      (await prisma.person.findUniqueOrThrow({ where: { id: ritirata.id } })).email
    ).toBeNull();
    expect((await selettore()).map((r) => r.email)).toEqual([email]);
  });

  it('una voce che ha gia’ l’email non cambia, e una seconda passata non fa niente', async () => {
    const { persona, emailHash, cifrata } = await voce();
    await iscrizioneDi(
      (await creaEvento()).id,
      emailHash,
      'altro@example.org',
      new Date()
    );
    await applicaMigrazione();
    await applicaMigrazione();
    expect(
      (await prisma.person.findUniqueOrThrow({ where: { id: persona.id } })).email
    ).toBe(cifrata);
  });
});

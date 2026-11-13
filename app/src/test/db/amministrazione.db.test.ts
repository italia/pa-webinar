// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Accesso dello staff e pannelli di amministrazione su un database vero:
 * consumo atomico del link, filtri sugli enum, unicita', JSON e colonne uuid.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { POST as esciDallaSessione } from '@/app/api/admin/logout/route';
import { GET as elencoModeratori } from '@/app/api/admin/moderators/route';
import { PUT as aggiornaModello } from '@/app/api/admin/question-templates/[id]/route';
import { POST as creaModello } from '@/app/api/admin/question-templates/route';
import {
  DELETE as cancellaContatto,
  GET as leggiContatto,
} from '@/app/api/admin/rubrica/[id]/route';
import { PATCH as modificaEtichetta } from '@/app/api/admin/tags/[id]/route';
import {
  GET as leggiModelli,
  POST as creaModelloEvento,
} from '@/app/api/admin/templates/route';
import { POST as aggiungiOrganizzatore } from '@/app/api/events/[param]/organizers/route';
import { POST as accessoRegistrazione } from '@/app/api/events/[param]/recording/access/route';
import { POST as rimandaLink } from '@/app/api/events/[param]/registrations/resend/route';
import { POST as verificaPassword } from '@/app/api/events/[param]/verify-password/route';
import { hashJoinPassword } from '@/lib/auth/password';
import { consumaLinkAccesso, inviaLinkAccesso } from '@/lib/auth/staff-login';
import { prisma } from '@/lib/db';

import { creaEvento, entraCome, richiesta, svuotaDatabase } from './fixtures';

beforeEach(svuotaDatabase);

const senzaParametri = { params: Promise.resolve({}) };

describe('link di accesso dello staff', () => {
  async function linkValido(scadeTra = 60_000) {
    const account = await entraCome('ORGANIZER');
    const token = randomBytes(32).toString('base64url');
    await prisma.staffLoginToken.create({
      data: {
        accountId: account.id,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + scadeTra),
      },
    });
    return { account, token };
  }

  it('dieci clic contemporanei aprono una sessione sola', async () => {
    const { account, token } = await linkValido();

    const esiti = await Promise.all(
      Array.from({ length: 10 }, () => consumaLinkAccesso(token))
    );

    expect(esiti.filter((e) => e === account.id)).toHaveLength(1);
    expect(esiti.filter((e) => e === null)).toHaveLength(9);
  });

  it('un link scaduto non apre niente', async () => {
    const { token } = await linkValido(-1000);
    expect(await consumaLinkAccesso(token)).toBeNull();
  });

  it('un account disattivato non entra col link gia’ spedito', async () => {
    const { account, token } = await linkValido();
    await prisma.staffAccount.update({
      where: { id: account.id },
      data: { active: false },
    });
    expect(await consumaLinkAccesso(token)).toBeNull();
  });

  it('sul database resta l’impronta del token, e la mail va in coda', async () => {
    const account = await entraCome('ORGANIZER');

    await inviaLinkAccesso(
      { id: account.id, email: account.email, name: account.name },
      'it'
    );

    const riga = await prisma.staffLoginToken.findFirstOrThrow({
      where: { accountId: account.id },
    });
    expect(riga.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const mail = await prisma.emailOutbox.findFirstOrThrow();
    expect(JSON.stringify(mail)).not.toContain(riga.tokenHash);
  });
});

describe('uscita dalla sessione', () => {
  it('chi ha una sessione lascia una riga di audit', async () => {
    await entraCome('ADMIN');
    const risposta = await esciDallaSessione(
      richiesta('/api/admin/logout', 'POST') as never,
      senzaParametri
    );
    expect(risposta.status).toBe(200);
    expect(await prisma.adminAuditLog.count({ where: { action: 'ADMIN_LOGOUT' } })).toBe(
      1
    );
  });

  it('chi non ce l’ha non ne lascia', async () => {
    await esciDallaSessione(
      richiesta('/api/admin/logout', 'POST') as never,
      senzaParametri
    );
    expect(await prisma.adminAuditLog.count()).toBe(0);
  });
});

describe('password di un evento', () => {
  function prova(slug: string, password: unknown) {
    return verificaPassword(
      richiesta(`/api/events/${slug}/verify-password`, 'POST', { password }) as never,
      {
        params: Promise.resolve({ param: slug }),
      }
    );
  }

  it('apre con quella giusta, non con le altre', async () => {
    const evento = await creaEvento({ joinPasswordHash: hashJoinPassword('segreta') });
    expect((await prova(evento.slug, 'sbagliata')).ok).toBe(false);
    expect((await prova(evento.slug, 'segreta')).status).toBe(200);
  });

  it('un hash guasto sulla riga non apre con nessuna password', async () => {
    const evento = await creaEvento({ joinPasswordHash: 'scrypt:zz:zz' });
    const altro = await creaEvento({ joinPasswordHash: 'zz:zz' });
    expect((await prova(evento.slug, 'qualunque')).ok).toBe(false);
    expect((await prova(altro.slug, 'qualunque')).ok).toBe(false);
  });
});

describe('modelli di evento', () => {
  it('si leggono solo da amministratore', async () => {
    const leggi = () =>
      leggiModelli(richiesta('/api/admin/templates') as never, senzaParametri);
    await prisma.eventTemplate.create({ data: { name: 'Modello di prova' } });

    expect((await leggi()).status).toBe(401);
    await entraCome('ORGANIZER');
    expect((await leggi()).ok).toBe(false);
    await entraCome('ADMIN');
    const risposta = await leggi();
    expect(risposta.status).toBe(200);
    expect(JSON.stringify(await risposta.json())).toContain('Modello di prova');
  });

  it('un modello con i campi JSON vuoti si salva', async () => {
    await entraCome('ADMIN');
    const risposta = await creaModelloEvento(
      richiesta('/api/admin/templates', 'POST', {
        name: 'Con JSON vuoti',
        descriptionTemplate: null,
        permissionMatrix: null,
      }) as never,
      senzaParametri
    );
    expect(risposta.status).toBeLessThan(300);
    expect(await prisma.eventTemplate.count({ where: { name: 'Con JSON vuoti' } })).toBe(
      1
    );
  });
});

describe('elenco dei moderatori', () => {
  function elenco(query = '') {
    return elencoModeratori(
      richiesta(`/api/admin/moderators${query}`) as never,
      senzaParametri
    );
  }

  it('filtra per stato sulla colonna vera e tiene fuori le bozze', async () => {
    await entraCome('ADMIN');
    const inDiretta = await creaEvento({ status: 'LIVE' });
    await creaEvento({ status: 'ENDED' });
    await creaEvento({ status: 'DRAFT' });

    const filtrati = (await (await elenco('?status=LIVE')).json()) as {
      rows: { id: string }[];
    };
    const tutti = (await (await elenco()).json()) as { rows: { id: string }[] };

    expect(filtrati.rows.map((r) => r.id)).toEqual([inDiretta.id]);
    expect(tutti.rows).toHaveLength(2);
  });

  it('uno stato che non esiste risponde 422', async () => {
    await entraCome('ADMIN');
    expect((await elenco('?status=INESISTENTE')).status).toBe(422);
  });
});

describe('etichette', () => {
  function modifica(id: string, corpo: unknown) {
    return modificaEtichetta(
      richiesta(`/api/admin/tags/${id}`, 'PATCH', corpo) as never,
      {
        params: Promise.resolve({ id }),
      }
    );
  }

  it('i nomi restano un oggetto per lingua', async () => {
    await entraCome('ADMIN');
    const tag = await prisma.tag.create({
      data: { slug: 'prova', name: { it: 'Prova' } },
    });

    const risposta = await modifica(tag.id, { name: { it: 'Nuovo', en: 'New' } });

    expect(risposta.status).toBe(200);
    expect((await prisma.tag.findUniqueOrThrow({ where: { id: tag.id } })).name).toEqual({
      it: 'Nuovo',
      en: 'New',
    });
  });

  it('un indirizzo gia’ usato risponde 409, un’etichetta sparita 404', async () => {
    await entraCome('ADMIN');
    await prisma.tag.create({ data: { slug: 'occupato', name: { it: 'Occupato' } } });
    const tag = await prisma.tag.create({
      data: { slug: 'libero', name: { it: 'Libero' } },
    });

    expect((await modifica(tag.id, { slug: 'occupato' })).status).toBe(409);
    expect((await modifica(randomUUID(), { slug: 'altro' })).status).toBe(404);
  });
});

describe('modelli di domande', () => {
  it('una domanda copiata da un altro modello resta, con un id nuovo', async () => {
    await entraCome('ADMIN');
    const idCopiato = randomUUID();

    const risposta = await creaModello(
      richiesta('/api/admin/question-templates', 'POST', {
        name: 'Modello con copia',
        items: [{ id: idCopiato, prompt: { it: 'Com’e’ andata?' }, type: 'OPEN_TEXT' }],
      }) as never,
      senzaParametri
    );

    expect(risposta.status).toBe(201);
    const domande = await prisma.questionItem.findMany();
    expect(domande).toHaveLength(1);
    expect(domande[0]!.id).not.toBe(idCopiato);
  });
});

describe('modifica di un modello di domande', () => {
  async function modelloConDomanda(name: string) {
    return prisma.questionTemplate.create({
      data: {
        name,
        items: { create: { prompt: { it: 'Domanda' }, type: 'OPEN_TEXT', sortOrder: 0 } },
      },
      include: { items: true },
    });
  }

  it('una domanda presa da un altro modello si aggiunge, e l’originale resta dov’e’', async () => {
    await entraCome('ADMIN');
    const modello = await modelloConDomanda('Destinazione');
    const altro = await modelloConDomanda('Origine');
    const mia = modello.items[0]!;
    const copiata = altro.items[0]!;

    const risposta = await aggiornaModello(
      richiesta(`/api/admin/question-templates/${modello.id}`, 'PUT', {
        items: [
          { id: mia.id, prompt: { it: 'Domanda mia' }, type: 'OPEN_TEXT' },
          { id: copiata.id, prompt: { it: 'Domanda copiata' }, type: 'OPEN_TEXT' },
        ],
      }) as never,
      { params: Promise.resolve({ id: modello.id }) }
    );

    expect(risposta.status).toBe(200);
    expect(await prisma.questionItem.count({ where: { templateId: modello.id } })).toBe(
      2
    );
    expect(
      await prisma.questionItem.findUniqueOrThrow({ where: { id: copiata.id } })
    ).toMatchObject({
      templateId: altro.id,
      prompt: { it: 'Domanda' },
    });
  });
});

describe('corpi non validi sulle rotte pubbliche', () => {
  it.each([
    ['rimanda il link', rimandaLink, 'registrations/resend'],
    ['accesso al video', accessoRegistrazione, 'recording/access'],
  ])('%s risponde come sempre a un corpo `null`', async (_nome, rotta, percorso) => {
    const evento = await creaEvento();

    const risposta = await rotta(
      richiesta(`/api/events/${evento.slug}/${percorso}`, 'POST', null) as never,
      { params: Promise.resolve({ param: evento.slug }) }
    );

    expect(risposta.status).toBe(200);
  });
});

describe('organizzatori di un evento', () => {
  function aggiungi(evento: { slug: string; moderatorToken: string }, corpo: unknown) {
    return aggiungiOrganizzatore(
      richiesta(
        `/api/events/${evento.slug}/organizers`,
        'POST',
        corpo,
        evento.moderatorToken
      ) as never,
      { params: Promise.resolve({ param: evento.slug }) }
    );
  }

  it('il sito si salva se e’ http, si rifiuta altrimenti', async () => {
    const evento = await creaEvento();

    const buono = await aggiungi(evento, {
      name: 'Ente',
      websiteUrl: 'https://example.org',
    });
    const cattivo = await aggiungi(evento, {
      name: 'Ente',
      websiteUrl: 'javascript:alert(1)',
    });

    expect(buono.status).toBe(201);
    expect(cattivo.status).toBe(422);
    expect(await prisma.eventOrganizer.count({ where: { eventId: evento.id } })).toBe(1);
  });
});

describe('rubrica', () => {
  it('un id malformato non diventa un errore del database', async () => {
    await entraCome('ADMIN');
    const contesto = { params: Promise.resolve({ id: 'non-e-un-uuid' }) };

    const lettura = await leggiContatto(
      richiesta('/api/admin/rubrica/non-e-un-uuid') as never,
      contesto
    );
    const cancellazione = await cancellaContatto(
      richiesta('/api/admin/rubrica/non-e-un-uuid', 'DELETE') as never,
      contesto
    );

    expect(lettura.status).toBe(404);
    expect(cancellazione.status).toBe(404);
  });

  it('cancellare un contatto lascia il relatore senza collegamento', async () => {
    await entraCome('ADMIN');
    const evento = await creaEvento({ status: 'ENDED' });
    const sessione = await prisma.callSession.create({
      data: { eventId: evento.id, jitsiRoomName: 'stanza', startedAt: new Date() },
    });
    const registrazione = await prisma.recording.create({
      data: {
        callSessionId: sessione.id,
        eventId: evento.id,
        blobKey: 'recordings/x.mp4',
      },
    });
    const contatto = await prisma.person.create({ data: { emailHash: randomUUID() } });
    const relatore = await prisma.speaker.create({
      data: {
        recordingId: registrazione.id,
        diarLabel: 'SPEAKER_00',
        personId: contatto.id,
      },
    });

    const risposta = await cancellaContatto(
      richiesta(`/api/admin/rubrica/${contatto.id}`, 'DELETE') as never,
      {
        params: Promise.resolve({ id: contatto.id }),
      }
    );

    expect(risposta.status).toBe(200);
    expect(
      (await prisma.speaker.findUniqueOrThrow({ where: { id: relatore.id } })).personId
    ).toBeNull();
  });
});

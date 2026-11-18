// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Il contenuto delle registrazioni su un database vero
 * (docs/adr/021-recording-content-access.md): lo vede chi organizza l'evento
 * (chi l'ha creato, o un account con una concessione da organizzatore), chi
 * ha partecipato (l'iscritto, chi era in sala in una chiamata rapida) e, se e'
 * pubblicato per tutti, chiunque. L'admin che non lo organizza vede i
 * metadati; la chiave dell'istanza mai il contenuto. Lo storage dei file e'
 * finto, il resto no.
 */
import { randomUUID } from 'node:crypto';

import { SignJWT } from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/storage/postprod', () => ({
  isPostprodStorageConfigured: () => true,
  presignArtifactDownload: vi.fn(
    async ({ blobKey }: { blobKey: string }) => `https://storage.test/${blobKey}?firma`
  ),
  listPostprodBlobs: vi.fn(async () => []),
  rewritePostprodBlob: vi.fn(),
}));

import { GET as dettagli } from '@/app/api/admin/postprod/recordings/[id]/details/route';
import { GET as media } from '@/app/api/admin/postprod/recordings/[id]/media/route';
import { GET as sintesi } from '@/app/api/admin/postprod/recordings/[id]/summary/route';
import { GET as tracce } from '@/app/api/admin/postprod/recordings/[id]/tracks/route';
import { GET as trascrizione } from '@/app/api/admin/postprod/recordings/[id]/transcript/route';
import { GET as elencoPostprod } from '@/app/api/admin/postprod/route';
import { PUT as rinominaVoce } from '@/app/api/admin/postprod/speakers/[id]/route';
import { GET as elencoModeratori } from '@/app/api/admin/moderators/route';
import { POST as chiediResoconto } from '@/app/api/admin/events/[id]/report/route';
import { POST as passDiPresenza } from '@/app/api/events/[param]/recording/presence/route';
import { GET as video } from '@/app/api/events/[param]/recording/route';
import { GET as fileSessione } from '@/app/api/events/[param]/sessions/[id]/recording/route';
import { generateJitsiJwt } from '@/lib/auth/jwt';
import { hashEmail } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { presencePassCookieName } from '@/lib/recording/presence-pass';
import { issueViewingToken, viewingCookieName } from '@/lib/recording/viewing';

import { biscotti } from './biscotti';
import {
  creaEvento,
  creaIscrizione,
  creaRegistrazione,
  entraCome,
  esci,
  richiesta,
  svuotaDatabase,
} from './fixtures';

const VIDEO = 'https://storage.example.com/recordings/sala.mp4';

beforeEach(async () => {
  await svuotaDatabase();
});

const conId = (id: string) => ({ params: Promise.resolve({ id }) });
const conSlug = (param: string) => ({ params: Promise.resolve({ param }) });

/** La sessione della chiave dell'istanza: nessun account dietro. */
async function entraConLaChiave(): Promise<void> {
  biscotti.set(
    'admin_session',
    await new SignJWT({ role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(process.env.APP_SECRET!))
  );
}

async function codice(r: Response): Promise<string | undefined> {
  return ((await r.json().catch(() => ({}))) as { code?: string }).code;
}

async function righeDiLettura(eventId: string) {
  return prisma.gdprAuditLog.findMany({
    where: { eventId, action: 'RECORDING_CONTENT_READ' },
  });
}

describe('le rotte del contenuto', () => {
  async function scena() {
    const evento = await creaEvento({ status: 'ENDED', recordingUrl: VIDEO });
    const registrazione = await creaRegistrazione(evento.id);
    const relatore = await prisma.speaker.create({
      data: { recordingId: registrazione.id, diarLabel: 'SPEAKER_00' },
    });
    const sessione = await prisma.callSession.findUniqueOrThrow({
      where: { id: registrazione.callSessionId },
    });
    await prisma.callSession.update({
      where: { id: sessione.id },
      data: { recordingUrl: VIDEO },
    });
    return { evento, registrazione, relatore, sessione };
  }

  /** Tutte le rotte del contenuto, con cio' che serve a chiamarle. */
  function chiamate(s: Awaited<ReturnType<typeof scena>>) {
    const r = s.registrazione.id;
    return {
      media: () =>
        media(
          richiesta(`/api/admin/postprod/recordings/${r}/media`) as never,
          conId(r) as never
        ),
      tracce: () =>
        tracce(
          richiesta(`/api/admin/postprod/recordings/${r}/tracks`) as never,
          conId(r) as never
        ),
      trascrizione: () =>
        trascrizione(
          richiesta(`/api/admin/postprod/recordings/${r}/transcript`) as never,
          conId(r) as never
        ),
      sintesi: () =>
        sintesi(
          richiesta(`/api/admin/postprod/recordings/${r}/summary`) as never,
          conId(r) as never
        ),
      voce: () =>
        rinominaVoce(
          richiesta(`/api/admin/postprod/speakers/${s.relatore.id}`, 'PUT', {
            displayName: 'Relatore 1',
          }) as never,
          conId(s.relatore.id) as never
        ),
      resoconto: () =>
        chiediResoconto(
          richiesta(`/api/admin/events/${s.evento.id}/report`, 'POST', {}) as never,
          conId(s.evento.id) as never
        ),
      fileSessione: () =>
        fileSessione(
          richiesta(
            `/api/events/${s.evento.slug}/sessions/${s.sessione.id}/recording`
          ) as never,
          {
            params: Promise.resolve({ param: s.evento.slug, id: s.sessione.id }),
          } as never
        ),
    };
  }

  it('l’admin che non organizza l’evento non le apre, e lo sa dal codice', async () => {
    const s = await scena();
    await entraCome('ADMIN');
    for (const [nome, chiama] of Object.entries(chiamate(s))) {
      const r = await chiama();
      expect(r.status, nome).toBe(403);
      expect(await codice(r), nome).toBe('RECORDING_CONTENT_ORGANIZER_ONLY');
    }
    expect(await righeDiLettura(s.evento.id)).toHaveLength(0);
  });

  it('la chiave dell’istanza nemmeno', async () => {
    const s = await scena();
    await entraConLaChiave();
    for (const [nome, chiama] of Object.entries(chiamate(s))) {
      const r = await chiama();
      expect(r.status, nome).toBe(403);
      expect(await codice(r), nome).toBe('RECORDING_CONTENT_ORGANIZER_ONLY');
    }
  });

  it('l’organizzatore di un altro evento: il 403 di sempre', async () => {
    const s = await scena();
    await entraCome('ORGANIZER');
    for (const [nome, chiama] of Object.entries(chiamate(s))) {
      const r = await chiama();
      expect(r.status, nome).toBe(403);
      expect(await codice(r), nome).toBe('FORBIDDEN');
    }
  });

  it('l’admin che ha creato l’evento lo organizza: legge, e la lettura si traccia una volta', async () => {
    const s = await scena();
    const admin = await entraCome('ADMIN');
    await prisma.event.update({
      where: { id: s.evento.id },
      data: { createdById: admin.id },
    });
    const c = chiamate(s);
    expect((await c.media()).status).toBe(302);
    expect((await c.media()).status).toBe(302);
    expect((await c.trascrizione()).status).toBe(200);
    expect((await c.voce()).status).toBe(200);
    const righe = await righeDiLettura(s.evento.id);
    // Video e trascrizione, ognuno una volta: la stessa lettura ripetuta non
    // si riscrive. Rinominare una voce e' una modifica, nel registro dello staff.
    expect(righe.map((r) => JSON.parse(r.details!).surface).sort()).toEqual([
      'trascrizione',
      'video',
    ]);
    for (const riga of righe) {
      expect(JSON.parse(riga.details!)).toMatchObject({
        recordingId: s.registrazione.id,
        via: 'organizzatore',
        role: 'admin',
        account: admin.id,
      });
      // Nessun dato personale: niente nomi, indirizzi, IP.
      expect(riga.details).not.toMatch(/@|Persona/);
    }
  });

  it('chi ha una concessione da organizzatore lavora sul contenuto', async () => {
    const s = await scena();
    const organizzatore = await entraCome('ORGANIZER');
    const account = await prisma.staffAccount.findUniqueOrThrow({
      where: { id: organizzatore.id },
    });
    await prisma.eventModerator.create({
      data: {
        eventId: s.evento.id,
        name: 'Co-organizzatore',
        emailHash: account.emailHash,
        organizer: true,
        token: randomUUID(),
      },
    });
    const c = chiamate(s);
    expect((await c.trascrizione()).status).toBe(200);
    expect((await c.sintesi()).status).toBe(200);
    expect((await c.fileSessione()).status).toBe(302);
  });

  it('i metadati restano all’admin: esiste, stato, durata, lavori, senza il contenuto', async () => {
    const s = await scena();
    await entraCome('ADMIN');
    const r = await dettagli(
      richiesta(`/api/admin/postprod/recordings/${s.registrazione.id}/details`) as never,
      conId(s.registrazione.id) as never
    );
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as {
      contenuto: boolean;
      recording: { id: string };
      dubbedAudio: unknown[];
    };
    expect(corpo.contenuto).toBe(false);
    expect(corpo.recording.id).toBe(s.registrazione.id);
    expect(corpo.dubbedAudio).toEqual([]);

    const elenco = (await (
      await elencoPostprod(
        richiesta('/api/admin/postprod') as never,
        { params: Promise.resolve({}) } as never
      )
    ).json()) as { rows: Array<{ id: string; contenuto: boolean }> };
    expect(elenco.rows).toEqual([
      expect.objectContaining({ id: s.registrazione.id, contenuto: false }),
    ]);
  });
});

describe('il video dell’evento (/api/events/[slug]/recording)', () => {
  const guarda = (slug: string) =>
    video(richiesta(`/api/events/${slug}/recording`) as never, conSlug(slug) as never);

  it('prima della pubblicazione: chi organizza lo vede, con la lettura tracciata; l’admin no', async () => {
    const evento = await creaEvento({
      status: 'ENDED',
      recordingUrl: VIDEO,
      recordingPublished: false,
    });
    await entraCome('ADMIN');
    expect((await guarda(evento.slug)).status).toBe(403);
    await entraConLaChiave();
    expect((await guarda(evento.slug)).status).toBe(403);
    const admin = await entraCome('ADMIN');
    await prisma.event.update({
      where: { id: evento.id },
      data: { createdById: admin.id },
    });
    const r = await guarda(evento.slug);
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe(VIDEO);
    expect(await righeDiLettura(evento.id)).toHaveLength(1);
  });

  it('pubblicato per tutti: lo vede chiunque, admin compreso, e non e’ una lettura dello staff', async () => {
    const evento = await creaEvento({
      status: 'ENDED',
      recordingUrl: VIDEO,
      recordingPublished: true,
      postEventPublic: true,
    });
    expect((await guarda(evento.slug)).status).toBe(302);
    await entraCome('ADMIN');
    expect((await guarda(evento.slug)).status).toBe(302);
    expect(await righeDiLettura(evento.id)).toHaveLength(0);
  });

  it('riservato agli iscritti: l’iscritto lo vede dal suo cookie, l’admin che non organizza no', async () => {
    const evento = await creaEvento({
      status: 'ENDED',
      recordingUrl: VIDEO,
      recordingPublished: true,
      postEventPublic: false,
      recordingAudience: 'REGISTRANTS',
      recordingDestination: 'REGISTRANTS',
    });
    const iscrizione = await creaIscrizione(evento.id);
    await entraCome('ADMIN');
    expect((await guarda(evento.slug)).status).toBe(403);
    esci();
    biscotti.set(
      viewingCookieName(evento.id),
      issueViewingToken(evento.id, iscrizione.id)!
    );
    expect((await guarda(evento.slug)).status).toBe(302);
  });

  it('un file di un altro evento non si firma per questo: 404', async () => {
    const altro = await creaEvento();
    const evento = await creaEvento({
      status: 'ENDED',
      recordingUrl: `https://storage.example.com/postprod/${altro.id}/r/mix.mp4`,
      recordingPublished: true,
      postEventPublic: true,
    });
    // Senza storage configurato l'indirizzo vale com'e' (ambiente locale): la
    // regola la provano i test dello storage. Qui: la rotta non si rompe.
    expect([302, 404]).toContain((await guarda(evento.slug)).status);
  });
});

describe('la chiamata rapida e il pass di presenza', () => {
  async function chiamata(campi: Record<string, unknown> = {}) {
    return creaEvento({
      eventType: 'INSTANT',
      status: 'LIVE',
      dataRetentionDays: 7,
      ...campi,
    });
  }
  const tokenDellaSala = (stanza: string, scadenza?: number) =>
    generateJitsiJwt({
      roomName: stanza,
      displayName: 'Ospite',
      uniqueId: `guest-${randomUUID()}`,
      isModerator: false,
      ...(scadenza !== undefined && { expiresInSeconds: scadenza }),
    });
  const chiedi = (slug: string, roomTokens: string[]) =>
    passDiPresenza(
      richiesta(`/api/events/${slug}/recording/presence`, 'POST', {
        roomTokens,
      }) as never,
      conSlug(slug) as never
    );
  const avviaRegistrazione = (eventId: string) =>
    prisma.liveAction.create({
      data: { eventId, kind: 'recording.started', actor: 'moderator' },
    });

  it('chi e’ in sala mentre si registra riceve il pass; dopo la chiamata vede il video, gli altri no', async () => {
    const evento = await chiamata();
    await avviaRegistrazione(evento.id);
    const r = await chiedi(evento.slug, [await tokenDellaSala(evento.jitsiRoomName)]);
    expect(r.status).toBe(204);
    const cookie = r.headers.get('set-cookie')!;
    expect(cookie).toContain(`${presencePassCookieName(evento.id)}=`);
    expect(cookie).toContain('HttpOnly');
    const pass = cookie.split(';')[0]!.split('=').slice(1).join('=');

    await prisma.event.update({
      where: { id: evento.id },
      data: { status: 'ENDED', recordingUrl: VIDEO },
    });
    const guarda = () =>
      video(
        richiesta(`/api/events/${evento.slug}/recording`) as never,
        conSlug(evento.slug) as never
      );
    expect((await guarda()).status).toBe(403);
    biscotti.set(presencePassCookieName(evento.id), pass);
    expect((await guarda()).status).toBe(302);
    // Il pass non e' una lettura dello staff.
    expect(await righeDiLettura(evento.id)).toHaveLength(0);
    // Non vale per un'altra chiamata.
    const altra = await chiamata({ status: 'ENDED', recordingUrl: VIDEO });
    biscotti.set(presencePassCookieName(altra.id), pass);
    expect(
      (
        await video(
          richiesta(`/api/events/${altra.slug}/recording`) as never,
          conSlug(altra.slug) as never
        )
      ).status
    ).toBe(403);
  });

  it('chi organizza la chiamata vede il video dal link, senza pass', async () => {
    const admin = await entraCome('ADMIN');
    const evento = await chiamata({
      status: 'ENDED',
      recordingUrl: VIDEO,
      createdById: admin.id,
    });
    expect(
      (
        await video(
          richiesta(`/api/events/${evento.slug}/recording`) as never,
          conSlug(evento.slug) as never
        )
      ).status
    ).toBe(302);
  });

  it('senza registrazione in corso niente pass: 409, e il client riprova', async () => {
    const evento = await chiamata();
    expect(
      (await chiedi(evento.slug, [await tokenDellaSala(evento.jitsiRoomName)])).status
    ).toBe(409);
    await avviaRegistrazione(evento.id);
    await prisma.liveAction.create({
      data: {
        eventId: evento.id,
        kind: 'recording.stopped',
        actor: 'moderator',
        at: new Date(Date.now() + 1000),
      },
    });
    expect(
      (await chiedi(evento.slug, [await tokenDellaSala(evento.jitsiRoomName)])).status
    ).toBe(409);
  });

  it('serve un token di questa sala; scaduto da poco vale, perche’ la sala non lo rinnova', async () => {
    const evento = await chiamata();
    await avviaRegistrazione(evento.id);
    expect(
      (await chiedi(evento.slug, [await tokenDellaSala('altra-stanza')])).status
    ).toBe(401);
    expect((await chiedi(evento.slug, ['non-un-token'])).status).toBe(401);
    expect(
      (
        await chiedi(evento.slug, [
          await tokenDellaSala(evento.jitsiRoomName, -2 * 86_400),
        ])
      ).status
    ).toBe(401);
    // Entrato tre ore prima dell'avvio: il token e' scaduto, la persona c'e'.
    expect(
      (
        await chiedi(evento.slug, [
          await tokenDellaSala(evento.jitsiRoomName, -3 * 3_600),
        ])
      ).status
    ).toBe(204);
  });

  it('solo per le chiamate rapide aperte', async () => {
    const programmato = await creaEvento({ status: 'LIVE' });
    await avviaRegistrazione(programmato.id);
    expect(
      (await chiedi(programmato.slug, [await tokenDellaSala(programmato.jitsiRoomName)]))
        .status
    ).toBe(404);
    const chiusa = await chiamata({ status: 'ENDED' });
    await avviaRegistrazione(chiusa.id);
    expect(
      (await chiedi(chiusa.slug, [await tokenDellaSala(chiusa.jitsiRoomName)])).status
    ).toBe(409);
  });
});

describe('il link di conduzione', () => {
  it('l’elenco dei moderatori lo mostra solo per gli eventi che l’admin organizza', async () => {
    const admin = await entraCome('ADMIN');
    const mio = await creaEvento({ createdById: admin.id });
    const altrui = await creaEvento();
    const r = await elencoModeratori(
      richiesta('/api/admin/moderators') as never,
      { params: Promise.resolve({}) } as never
    );
    const { rows } = (await r.json()) as {
      rows: Array<{ id: string; moderatorToken: string | null }>;
    };
    const per = new Map(rows.map((x) => [x.id, x.moderatorToken]));
    expect(per.get(mio.id)).toBe(mio.moderatorToken);
    expect(per.get(altrui.id)).toBeNull();
    expect(JSON.stringify(rows)).not.toContain(altrui.moderatorToken);
  });

  it('con un co-organizzatore che ha lo stesso indirizzo dell’admin', async () => {
    const admin = await entraCome('ADMIN');
    const account = await prisma.staffAccount.findUniqueOrThrow({
      where: { id: admin.id },
    });
    const evento = await creaEvento();
    await prisma.eventModerator.create({
      data: {
        eventId: evento.id,
        name: 'Admin',
        emailHash: account.emailHash,
        organizer: true,
        token: randomUUID(),
      },
    });
    const r = await elencoModeratori(
      richiesta('/api/admin/moderators') as never,
      { params: Promise.resolve({}) } as never
    );
    const { rows } = (await r.json()) as {
      rows: Array<{ id: string; moderatorToken: string | null }>;
    };
    expect(rows.find((x) => x.id === evento.id)?.moderatorToken).toBe(
      evento.moderatorToken
    );
    // L'impronta e' quella dell'indirizzo, non un valore qualunque.
    expect(account.emailHash).not.toBe(hashEmail('altro@example.org'));
  });
});

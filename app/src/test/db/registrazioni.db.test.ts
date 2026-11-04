/**
 * Cancellazione e pubblicazione dei video, annullamento della post-produzione:
 * transazioni, cascate e tipi delle colonne su un database vero. Lo storage dei
 * file e' finto, il resto no.
 */
import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { cancellaBlob } = vi.hoisted(() => ({ cancellaBlob: vi.fn() }));
vi.mock('@/lib/storage/recordings', () => ({
  deleteRecordingBlob: cancellaBlob,
  generateRecordingSasUrl: vi.fn(),
}));

import { POST as annulla } from '@/app/api/admin/postprod/recordings/[id]/cancel/route';
import { PUT as mappaRelatore } from '@/app/api/admin/postprod/speakers/[id]/route';
import { PATCH as pubblica } from '@/app/api/admin/publications/[id]/route';
import { POST as creaPubblicazione } from '@/app/api/admin/publications/route';
import { DELETE as cancellaVideo } from '@/app/api/events/[param]/recording/route';
import { PUT as aggiornaEvento } from '@/app/api/events/[param]/route';
import {
  DELETE as cancellaSessione,
  GET as leggiSessione,
} from '@/app/api/events/[param]/sessions/[id]/route';
import { POST as reclama } from '@/app/api/internal/recorder-claim/route';
import { encryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';

import {
  creaEvento,
  creaLavoro,
  creaRegistrazione,
  creaSessione,
  entraCome,
  esci,
  richiesta,
  svuotaDatabase,
} from './fixtures';

const VIDEO = 'https://storage.example.com/recordings/sala.mp4';
const CON_VIDEO = {
  status: 'ENDED' as const,
  recordingUrl: VIDEO,
  recordingPublished: true,
  recordingPublishedAt: new Date(),
  recordingFileSize: BigInt(5_000_000_000),
  recordingDuration: 3600,
};

beforeEach(async () => {
  cancellaBlob.mockReset();
  await svuotaDatabase();
});

function togliSessione(slug: string, id: string, token: string) {
  return cancellaSessione(
    richiesta(`/api/events/${slug}/sessions/${id}`, 'DELETE', undefined, token) as never,
    {
      params: Promise.resolve({ param: slug, id }),
    }
  );
}

describe('cancellazione di una sessione', () => {
  it('toglie il video dall’evento, se era il suo, e lo traccia', async () => {
    const evento = await creaEvento(CON_VIDEO);
    const sessione = await creaSessione(evento.id, { recordingUrl: VIDEO });

    const risposta = await togliSessione(evento.slug, sessione.id, evento.moderatorToken);

    expect(risposta.status).toBe(200);
    expect(cancellaBlob).toHaveBeenCalledWith(VIDEO);
    expect(
      await prisma.callSession.findUnique({ where: { id: sessione.id } })
    ).toBeNull();
    const dopo = await prisma.event.findUniqueOrThrow({ where: { id: evento.id } });
    expect(dopo).toMatchObject({
      recordingUrl: null,
      recordingPublished: false,
      recordingPublishedAt: null,
      recordingFileSize: null,
      recordingDuration: null,
    });
    const [traccia] = await prisma.gdprAuditLog.findMany({
      where: { eventId: evento.id },
    });
    expect(traccia).toMatchObject({ action: 'RECORDING_DELETED', recordCount: 1 });
    expect(JSON.parse(traccia!.details!)).toEqual({
      callSession: sessione.id,
      wasEventRecording: true,
    });
  });

  it('lascia stare l’evento se il file era un altro', async () => {
    const evento = await creaEvento(CON_VIDEO);
    const sessione = await creaSessione(evento.id, { recordingUrl: `${VIDEO}.vecchio` });

    await togliSessione(evento.slug, sessione.id, evento.moderatorToken);

    const dopo = await prisma.event.findUniqueOrThrow({ where: { id: evento.id } });
    expect(dopo).toMatchObject({ recordingUrl: VIDEO, recordingPublished: true });
    const [traccia] = await prisma.gdprAuditLog.findMany({
      where: { eventId: evento.id },
    });
    expect(JSON.parse(traccia!.details!)).toMatchObject({ wasEventRecording: false });
  });

  it('toglie anche la scadenza del video, che non passa al prossimo', async () => {
    const evento = await creaEvento({ ...CON_VIDEO, recordingDeleteAfterDays: 30 });
    const sessione = await creaSessione(evento.id, { recordingUrl: VIDEO });

    await togliSessione(evento.slug, sessione.id, evento.moderatorToken);

    expect(
      await prisma.event.findUniqueOrThrow({ where: { id: evento.id } })
    ).toMatchObject({
      recordingDeleteAfterDays: null,
    });
  });

  it('un file che non si cancella non blocca la cancellazione', async () => {
    const evento = await creaEvento(CON_VIDEO);
    const sessione = await creaSessione(evento.id, { recordingUrl: VIDEO });
    cancellaBlob.mockRejectedValueOnce(new Error('storage irraggiungibile'));
    const errori = vi.spyOn(console, 'error').mockImplementation(() => {});

    const risposta = await togliSessione(evento.slug, sessione.id, evento.moderatorToken);

    expect(errori).toHaveBeenCalled();
    errori.mockRestore();
    expect(risposta.status).toBe(200);
    expect(await prisma.callSession.count({ where: { id: sessione.id } })).toBe(0);
  });

  it('una sessione con la sola riga della registrazione la traccia', async () => {
    const evento = await creaEvento();
    const registrazione = await creaRegistrazione(evento.id);

    await togliSessione(evento.slug, registrazione.callSessionId, evento.moderatorToken);

    expect(cancellaBlob).not.toHaveBeenCalled();
    expect(
      await prisma.gdprAuditLog.count({ where: { action: 'RECORDING_DELETED' } })
    ).toBe(1);
  });

  it('una sessione senza file non lascia tracce', async () => {
    const evento = await creaEvento(CON_VIDEO);
    const sessione = await creaSessione(evento.id);

    await togliSessione(evento.slug, sessione.id, evento.moderatorToken);

    expect(cancellaBlob).not.toHaveBeenCalled();
    expect(await prisma.gdprAuditLog.count()).toBe(0);
  });

  it('porta via la registrazione e i suoi lavori, non quelli delle altre sessioni', async () => {
    const evento = await creaEvento();
    const registrazione = await creaRegistrazione(evento.id);
    await creaLavoro(registrazione.id, 'DONE');
    const altra = await creaRegistrazione(evento.id);
    await creaLavoro(altra.id, 'DONE');

    const risposta = await togliSessione(
      evento.slug,
      registrazione.callSessionId,
      evento.moderatorToken
    );

    expect(risposta.status).toBe(200);
    expect(await prisma.recording.findMany({ select: { id: true } })).toEqual([
      { id: altra.id },
    ]);
    expect(await prisma.postprodJob.count()).toBe(1);
  });

  it('se la transazione fallisce non si perde niente sul database', async () => {
    const evento = await creaEvento(CON_VIDEO);
    const sessione = await creaSessione(evento.id, { recordingUrl: VIDEO });
    const scrittura = vi
      .spyOn(prisma.gdprAuditLog, 'create')
      .mockImplementationOnce((() =>
        prisma.gdprAuditLog.create({
          data: { eventId: randomUUID(), action: 'RECORDING_DELETED', recordCount: 1 },
        })) as never);
    const errori = vi.spyOn(console, 'error').mockImplementation(() => {});

    const risposta = await togliSessione(evento.slug, sessione.id, evento.moderatorToken);

    scrittura.mockRestore();
    errori.mockRestore();
    expect(risposta.status).toBeGreaterThanOrEqual(500);
    expect(cancellaBlob).not.toHaveBeenCalled();
    expect(await prisma.callSession.count({ where: { id: sessione.id } })).toBe(1);
    expect(
      await prisma.event.findUniqueOrThrow({ where: { id: evento.id } })
    ).toMatchObject({
      recordingUrl: VIDEO,
      recordingPublished: true,
    });
  });

  it('il token di un altro evento non cancella niente', async () => {
    const evento = await creaEvento();
    const altro = await creaEvento();
    const sessione = await creaSessione(evento.id);

    const risposta = await togliSessione(evento.slug, sessione.id, altro.moderatorToken);

    expect(risposta.status).toBe(404);
    expect(await prisma.callSession.count()).toBe(1);
  });

  it('un id malformato risponde 404, non errore del database', async () => {
    const evento = await creaEvento();
    const risposta = await leggiSessione(
      richiesta(
        `/api/events/${evento.slug}/sessions/abc`,
        'GET',
        undefined,
        evento.moderatorToken
      ) as never,
      { params: Promise.resolve({ param: evento.slug, id: 'abc' }) }
    );
    expect(risposta.status).toBe(404);
  });
});

describe('cancellazione del video dell’evento', () => {
  it('svuota anche il file temporaneo e la sua scadenza', async () => {
    const evento = await creaEvento({
      ...CON_VIDEO,
      tempRecordingUrl: `${VIDEO}.temp`,
      tempRecordingStartedAt: new Date(),
      recordingDeleteAfterDays: 30,
    });

    const risposta = await cancellaVideo(
      richiesta(
        `/api/events/${evento.slug}/recording`,
        'DELETE',
        undefined,
        evento.moderatorToken
      ) as never,
      { params: Promise.resolve({ param: evento.slug }) }
    );

    expect(risposta.status).toBe(200);
    expect(cancellaBlob).toHaveBeenCalledTimes(2);
    expect(
      await prisma.event.findUniqueOrThrow({ where: { id: evento.id } })
    ).toMatchObject({
      recordingUrl: null,
      recordingPublished: false,
      recordingFileSize: null,
      tempRecordingUrl: null,
      tempRecordingStartedAt: null,
      recordingDeleteAfterDays: null,
    });
  });
});

describe('modifica dell’evento col link di conduzione', () => {
  it('togliere il video toglie anche pubblicazione, peso e durata', async () => {
    const evento = await creaEvento({ ...CON_VIDEO, recordingDeleteAfterDays: 30 });

    const risposta = await aggiornaEvento(
      richiesta(
        `/api/events/${evento.id}`,
        'PUT',
        { recordingUrl: null, recordingPublished: true, recordingDuration: 60 },
        evento.moderatorToken
      ) as never,
      { params: Promise.resolve({ param: evento.id }) }
    );

    expect(risposta.status).toBe(200);
    expect(
      await prisma.event.findUniqueOrThrow({ where: { id: evento.id } })
    ).toMatchObject({
      recordingUrl: null,
      recordingPublished: false,
      recordingPublishedAt: null,
      recordingFileSize: null,
      recordingDuration: null,
      recordingDeleteAfterDays: null,
    });
  });
});

describe('pubblicazione', () => {
  function aggiorna(id: string, corpo: unknown) {
    return pubblica(richiesta(`/api/admin/publications/${id}`, 'PATCH', corpo) as never, {
      params: Promise.resolve({ id }),
    });
  }

  it('togliere il video toglie anche la pubblicazione, qualunque cosa chieda il corpo', async () => {
    await entraCome('ADMIN');
    const evento = await creaEvento(CON_VIDEO);

    const risposta = await aggiorna(evento.id, {
      recordingUrl: null,
      recordingPublished: true,
    });

    expect(risposta.status).toBe(200);
    expect(
      await prisma.event.findUniqueOrThrow({ where: { id: evento.id } })
    ).toMatchObject({
      recordingUrl: null,
      recordingPublished: false,
      recordingPublishedAt: null,
      recordingFileSize: null,
      recordingDuration: null,
    });
    expect(
      await prisma.adminAuditLog.count({ where: { action: 'EVENT_PUBLICATION_UPDATE' } })
    ).toBe(1);
  });

  it('peso e durata nel corpo non sopravvivono alla rimozione del video', async () => {
    await entraCome('ADMIN');
    const evento = await creaEvento({ ...CON_VIDEO, recordingEnabled: false });

    await aggiorna(evento.id, {
      recordingUrl: null,
      recordingFileSize: 5000,
      recordingDuration: 60,
    });

    expect(
      await prisma.event.findUniqueOrThrow({ where: { id: evento.id } })
    ).toMatchObject({
      recordingFileSize: null,
      recordingDuration: null,
      recordingEnabled: false,
    });
  });

  it('un video caricato si pubblica, con le dimensioni oltre i 32 bit', async () => {
    await entraCome('ADMIN');
    const evento = await creaEvento({ status: 'ENDED' });

    const risposta = await aggiorna(evento.id, {
      recordingUrl: VIDEO,
      recordingFileSize: 5_000_000_000,
    });

    expect(risposta.status).toBe(200);
    const dopo = await prisma.event.findUniqueOrThrow({ where: { id: evento.id } });
    expect(dopo).toMatchObject({
      recordingUrl: VIDEO,
      recordingPublished: true,
      recordingEnabled: true,
    });
    expect(dopo.recordingPublishedAt).toBeInstanceOf(Date);
    expect(dopo.recordingFileSize).toBe(BigInt(5_000_000_000));
  });

  it('un indirizzo che non e’ http non arriva sulla riga', async () => {
    await entraCome('ADMIN');
    const evento = await creaEvento({ status: 'ENDED' });

    const risposta = await aggiorna(evento.id, { recordingUrl: 'javascript:alert(1)' });

    expect(risposta.status).toBe(422);
    expect(
      (await prisma.event.findUniqueOrThrow({ where: { id: evento.id } })).recordingUrl
    ).toBeNull();
  });

  it('l’organizzatore gestisce solo i propri eventi', async () => {
    const organizzatore = await entraCome('ORGANIZER');
    const suo = await creaEvento({ status: 'ENDED', createdById: organizzatore.id });
    const altrui = await creaEvento({ status: 'ENDED' });

    expect((await aggiorna(suo.id, { libraryListed: true })).status).toBe(200);
    expect((await aggiorna(altrui.id, { libraryListed: true })).status).toBe(403);
  });

  it('senza sessione non si tocca niente', async () => {
    const evento = await creaEvento({ status: 'ENDED' });
    esci();
    expect((await aggiorna(evento.id, { libraryListed: true })).status).toBe(401);
  });

  describe('storica', () => {
    function crea(corpo: Record<string, unknown>) {
      return creaPubblicazione(
        richiesta('/api/admin/publications', 'POST', {
          title: { it: 'Incontro di prova' },
          startsAt: '2026-01-10T10:00:00.000Z',
          endsAt: '2026-01-10T11:00:00.000Z',
          recordingUrl: VIDEO,
          ...corpo,
        }) as never,
        { params: Promise.resolve({}) }
      );
    }

    it('un titolo senza lettere latine ha comunque un indirizzo, e due titoli uguali due indirizzi', async () => {
      await entraCome('ADMIN');

      const prima = await crea({ title: { it: '日本語の題名' } });
      const seconda = await crea({ title: { it: '日本語の題名' } });

      expect(prima.status).toBe(201);
      expect(seconda.status).toBe(201);
      const eventi = await prisma.event.findMany({ select: { slug: true } });
      expect(eventi).toHaveLength(2);
      expect(eventi[0]!.slug).toMatch(/^evento/);
      expect(new Set(eventi.map((e) => e.slug)).size).toBe(2);
    });

    it('la fine deve venire dopo l’inizio', async () => {
      await entraCome('ADMIN');
      const risposta = await crea({ endsAt: '2026-01-10T09:00:00.000Z' });
      expect(risposta.status).toBe(422);
      expect(await prisma.event.count()).toBe(0);
    });
  });
});

describe('annullamento della post-produzione', () => {
  function ferma(id: string) {
    return annulla(
      richiesta(`/api/admin/postprod/recordings/${id}/cancel`, 'POST') as never,
      {
        params: Promise.resolve({ id }),
      }
    );
  }

  it.each(['POSTPROD_QUEUED', 'POSTPROD_RUNNING'] as const)(
    '%s diventa fallita',
    async (status) => {
      await entraCome('ADMIN');
      const evento = await creaEvento({ status: 'ENDED' });
      const registrazione = await creaRegistrazione(evento.id, status);
      await creaLavoro(registrazione.id, 'PENDING');

      const risposta = await ferma(registrazione.id);

      expect(await risposta.json()).toEqual({ ok: true, cancelled: 1 });
      expect(
        (await prisma.recording.findUniqueOrThrow({ where: { id: registrazione.id } }))
          .status
      ).toBe('POSTPROD_FAILED');
    }
  );

  it.each(['READY', 'POSTPROD_DONE', 'POSTPROD_PARTIAL'] as const)(
    'una registrazione %s resta com’e’, i lavori aperti si fermano e quelli finiti no',
    async (status) => {
      await entraCome('ADMIN');
      const evento = await creaEvento({ status: 'ENDED' });
      const registrazione = await creaRegistrazione(evento.id, status);
      const aperti = await Promise.all(
        (['PENDING', 'CLAIMED', 'RUNNING'] as const).map((s) =>
          creaLavoro(registrazione.id, s)
        )
      );
      const finito = await creaLavoro(registrazione.id, 'DONE');

      const risposta = await ferma(registrazione.id);

      expect(await risposta.json()).toEqual({ ok: true, cancelled: 3 });
      expect(
        (await prisma.recording.findUniqueOrThrow({ where: { id: registrazione.id } }))
          .status
      ).toBe(status);
      const lavori = await prisma.postprodJob.findMany({
        where: { id: { in: aperti.map((l) => l.id) } },
      });
      expect(
        lavori.every((l) => l.status === 'FAILED' && l.lastError === 'cancelled by admin')
      ).toBe(true);
      expect(
        (await prisma.postprodJob.findUniqueOrThrow({ where: { id: finito.id } })).status
      ).toBe('DONE');
    }
  );

  it('ripeterlo non cambia niente', async () => {
    await entraCome('ADMIN');
    const evento = await creaEvento({ status: 'ENDED' });
    const registrazione = await creaRegistrazione(evento.id, 'POSTPROD_QUEUED');
    await creaLavoro(registrazione.id, 'PENDING');

    await ferma(registrazione.id);
    const seconda = await ferma(registrazione.id);

    expect(await seconda.json()).toEqual({ ok: true, cancelled: 0 });
  });

  it('una registrazione che non esiste risponde 404', async () => {
    await entraCome('ADMIN');
    expect((await ferma(randomUUID())).status).toBe(404);
  });

  it('un id malformato non diventa un errore del database', async () => {
    await entraCome('ADMIN');
    expect((await ferma('non-e-un-uuid')).status).toBe(404);
  });
});

describe('relatori della post-produzione', () => {
  async function relatore() {
    const evento = await creaEvento({ status: 'ENDED' });
    const registrazione = await creaRegistrazione(evento.id);
    return prisma.speaker.create({
      data: { recordingId: registrazione.id, diarLabel: 'SPEAKER_00' },
    });
  }

  function mappa(id: string, corpo: unknown) {
    return mappaRelatore(
      richiesta(`/api/admin/postprod/speakers/${id}`, 'PUT', corpo) as never,
      {
        params: Promise.resolve({ id }),
      }
    );
  }

  function persona(displayName: string | null) {
    return prisma.person.create({ data: { emailHash: randomUUID(), displayName } });
  }

  it('collegare una persona riporta il suo nome leggibile', async () => {
    await entraCome('ADMIN');
    const riga = await relatore();
    const contatto = await persona(encryptPII('Nome in rubrica'));

    const risposta = await mappa(riga.id, { displayName: null, personId: contatto.id });

    expect(risposta.status).toBe(200);
    expect(
      await prisma.speaker.findUniqueOrThrow({ where: { id: riga.id } })
    ).toMatchObject({
      personId: contatto.id,
      displayName: 'Nome in rubrica',
    });
  });

  it('una persona senza nome lascia il relatore senza nome', async () => {
    await entraCome('ADMIN');
    const riga = await relatore();
    const contatto = await persona(null);

    await mappa(riga.id, { displayName: null, personId: contatto.id });

    expect(
      (await prisma.speaker.findUniqueOrThrow({ where: { id: riga.id } })).displayName
    ).toBeNull();
  });

  it('un id malformato non diventa un errore del database', async () => {
    await entraCome('ADMIN');
    expect((await mappa('non-e-un-uuid', { displayName: 'Nome' })).status).toBe(404);
  });
});

describe('avvio del recorder', () => {
  function chiedi(corpo: unknown) {
    const request = richiesta('/api/internal/recorder-claim', 'POST', corpo);
    request.headers.set('x-api-key', process.env.CRON_API_KEY!);
    return reclama(request as never, { params: Promise.resolve({}) });
  }

  it('riceve stanza e credenziali della registrazione assegnata', async () => {
    const evento = await creaEvento();
    const registrazione = await creaRegistrazione(evento.id, 'READY');

    const risposta = await chiedi({ recordingId: registrazione.id });

    expect(risposta.status).toBe(200);
    expect(await risposta.json()).toMatchObject({
      recordingId: registrazione.id,
      eventId: evento.id,
      roomName: evento.jitsiRoomName,
      jwt: expect.any(String),
    });
  });

  it('una registrazione che non esiste risponde 404', async () => {
    expect((await chiedi({ recordingId: randomUUID() })).status).toBe(404);
  });
});

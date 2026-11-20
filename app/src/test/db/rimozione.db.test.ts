// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * La rimozione di una persona da una registrazione, su un database vero: la
 * richiesta da «I miei dati» e dallo staff, la deroga, il lavoro REDACT preso e
 * consegnato, e cosa cambia nella registrazione. Lo storage e il cartello sono
 * finti, il resto no.
 */
import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { storage } = vi.hoisted(() => {
  const prefisso = 'https://storage.example.com/bucket/';
  return {
    storage: {
      publicUrl: (key: string) => `${prefisso}${key}`,
      keyFromUrl: (url: string) =>
        url.startsWith(prefisso) ? url.slice(prefisso.length) : null,
      delete: vi.fn(async () => true),
      list: vi.fn(
        async (): Promise<Array<{ key: string; sizeBytes: number | null }>> => []
      ),
      getUploadUrl: vi.fn(async (key: string) => ({
        uploadUrl: `https://storage.example.com/put/${key}`,
        publicUrl: `${prefisso}${key}`,
      })),
      getDownloadUrl: vi.fn(
        async (key: string) => `https://storage.example.com/get/${key}`
      ),
    },
  };
});
vi.mock('@/lib/storage', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getRecordingsStorage: () => storage,
}));
vi.mock('@/lib/recording/redaction/card', () => ({
  cartelloRimozione: vi.fn(async () => 'UE5H'),
}));

import { GET as leggi } from '@/app/api/admin/recording-removals/[id]/route';
import { GET as media } from '@/app/api/admin/recording-removals/[id]/media/route';
import { POST as respingi } from '@/app/api/admin/recording-removals/[id]/reject/route';
import { POST as avvia } from '@/app/api/admin/recording-removals/[id]/start/route';
import { POST as invia } from '@/app/api/admin/recording-removals/[id]/submit/route';
import { GET as persone } from '@/app/api/admin/recording-removals/people/route';
import { POST as creaDalloStaff } from '@/app/api/admin/recording-removals/route';
import { POST as chiediDaIMieiDati } from '@/app/api/gdpr/recording-removal/route';
import { POST as reclama } from '@/app/api/internal/postprod-claim/route';
import { POST as avanza } from '@/app/api/internal/postprod-progress/route';
import { POST as consegna } from '@/app/api/internal/recording-redaction/route';
import { encryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { issueGdprToken } from '@/lib/gdpr/request-token';
import { derogaPerRimozione } from '@/lib/recording/redaction/access';

import {
  creaEvento,
  creaIscrizione,
  entraCome,
  esci,
  richiesta,
  svuotaDatabase,
} from './fixtures';

const T0 = new Date('2026-11-10T10:00:00Z');
const VIDEO = 'recordings/sala.mp4';
const INDIRIZZO = `https://storage.example.com/bucket/${VIDEO}`;
const secondi = (s: number) => new Date(T0.getTime() + s * 1000);

function interna(url: string, corpo: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.CRON_API_KEY ?? '',
    },
    body: JSON.stringify(corpo),
  });
}

const parametri = (id: string) => ({ params: Promise.resolve({ id }) });

/** Un evento con un video registrato, una persona iscritta che c'era, la sua traccia e una trascrizione AI. */
async function scena() {
  await prisma.siteSetting.create({ data: { id: 'singleton', aiPipelineEnabled: true } });
  const evento = await creaEvento({
    status: 'ENDED',
    recordingEnabled: true,
    aiTranscriptEnabled: true,
    recordingUrl: INDIRIZZO,
    recordingPublished: true,
  });
  const iscrizione = await creaIscrizione(evento.id);
  const sessione = await prisma.callSession.create({
    data: {
      eventId: evento.id,
      jitsiRoomName: evento.jitsiRoomName,
      startedAt: T0,
      endedAt: secondi(600),
      recordingUrl: INDIRIZZO,
      recordingFilename: 'sala.mp4',
      dominantSpeakerLog: [
        { atMs: 100_000, participantId: 'ep-persona', displayName: 'Persona Iscritta' },
        { atMs: 130_000, participantId: 'ep-altro', displayName: 'Altra persona' },
      ],
    },
  });
  const registrazione = await prisma.recording.create({
    data: {
      callSessionId: sessione.id,
      eventId: evento.id,
      blobKey: VIDEO,
      durationSec: 600,
      mediaStartedAt: T0,
      sourceLanguage: 'it',
      status: 'POSTPROD_DONE',
    },
  });
  const posto = `reg-${iscrizione.id}-abcd1234`;
  await prisma.roomOccupant.createMany({
    data: [
      {
        eventId: evento.id,
        endpointId: 'ep-persona',
        seatId: posto,
        joinedAt: secondi(60),
        leftAt: secondi(180),
      },
      {
        eventId: evento.id,
        endpointId: 'ep-altro',
        seatId: `guest-${randomUUID()}`,
        joinedAt: secondi(0),
      },
    ],
  });
  await prisma.captionSegment.createMany({
    data: [
      {
        eventId: evento.id,
        messageId: 'm1',
        endpointId: 'ep-persona',
        seatId: posto,
        text: encryptPII('una frase'),
        startedAt: secondi(100),
        endedAt: secondi(104),
      },
      {
        eventId: evento.id,
        messageId: 'm2',
        endpointId: 'ep-altro',
        startedAt: secondi(140),
        endedAt: secondi(142),
      },
    ],
  });
  await prisma.recordingTrack.createMany({
    data: [
      {
        recordingId: registrazione.id,
        participantId: 'ep-persona',
        blobKey: `recordings/multitrack/${evento.id}/${registrazione.id}/audio/persona.opus`,
        startOffsetMs: 60_000,
        durationMs: 120_000,
      },
      {
        recordingId: registrazione.id,
        participantId: 'ep-altro',
        blobKey: `recordings/multitrack/${evento.id}/${registrazione.id}/audio/altro.opus`,
      },
    ],
  });
  const lavoro = await prisma.postprodJob.create({
    data: {
      recordingId: registrazione.id,
      kind: 'TRANSCRIBE',
      payload: {},
      idempotencyKey: randomUUID(),
      status: 'DONE',
    },
  });
  await prisma.postprodArtifact.createMany({
    data: [
      {
        recordingId: registrazione.id,
        jobId: lavoro.id,
        type: 'TRANSCRIPT_JSON',
        blobKey: `postprod/${evento.id}/${registrazione.id}/001/transcript.raw.json`,
        mimeType: 'application/json',
        contentHash: 'a'.repeat(64),
        modelId: 'large-v3',
      },
      {
        recordingId: registrazione.id,
        jobId: lavoro.id,
        type: 'WAVEFORM_JSON',
        blobKey: `postprod/${evento.id}/${registrazione.id}/001/waveform.json`,
        mimeType: 'application/json',
        contentHash: 'b'.repeat(64),
        inlineBody: encryptPII(
          '{"version":1,"duration":600,"buckets":2,"peaks":[0.1,0.2]}'
        ),
      },
    ],
  });
  await prisma.speaker.create({
    data: {
      recordingId: registrazione.id,
      diarLabel: 'SPEAKER_00',
      displayName: 'Persona Iscritta',
    },
  });
  return { evento, iscrizione, registrazione, posto };
}

beforeEach(async () => {
  storage.delete.mockClear();
  storage.list.mockReset().mockResolvedValue([]);
  esci();
  await svuotaDatabase();
});

describe('la richiesta da «I miei dati»', () => {
  it('nasce con gli intervalli proposti e una riga nel registro GDPR, una sola finche’ e’ aperta', async () => {
    const { evento, iscrizione, registrazione } = await scena();
    const token = issueGdprToken('consents', iscrizione.emailHash);
    const chiedi = () =>
      chiediDaIMieiDati(
        richiesta('/api/gdpr/recording-removal', 'POST', {
          token,
          registrationId: iscrizione.id,
        }) as never,
        { params: Promise.resolve({}) }
      );

    const prima = await chiedi();
    expect(prima.status).toBe(200);
    expect(await prima.json()).toEqual({ requested: 1 });
    expect(await (await chiedi()).json()).toEqual({ requested: 0 });

    const [r] = await prisma.recordingRedactionRequest.findMany();
    expect(r).toMatchObject({
      eventId: evento.id,
      recordingId: registrazione.id,
      source: 'self-service',
      status: 'OPEN',
      registrationId: iscrizione.id,
      emailHash: iscrizione.emailHash,
      endpointIds: ['ep-persona'],
    });
    // Il nome resta cifrato, copiato dall'iscrizione.
    expect(r!.displayName).toBe(iscrizione.displayName);
    const fonti = (
      r!.proposedIntervals as Array<{ start: number; end: number; source: string }>
    ).map((i) => [i.source, i.start, i.end]);
    expect(fonti).toEqual(
      expect.arrayContaining([
        ['presence', 60, 180],
        ['track', 60, 180],
        ['speech', 99, 105],
      ])
    );
    const traccia = await prisma.gdprAuditLog.findFirst({
      where: { action: 'RECORDING_REDACTION_REQUESTED' },
    });
    expect(JSON.parse(traccia!.details!)).toMatchObject({
      requestId: r!.id,
      source: 'self-service',
    });
    expect(traccia!.details).not.toContain('Persona');
  });

  it('non vale con il token di un altro indirizzo', async () => {
    const { iscrizione } = await scena();
    const risposta = await chiediDaIMieiDati(
      richiesta('/api/gdpr/recording-removal', 'POST', {
        token: issueGdprToken('consents', 'f'.repeat(64)),
        registrationId: iscrizione.id,
      }) as never,
      { params: Promise.resolve({}) }
    );
    expect(risposta.status).toBe(404);
    expect(await prisma.recordingRedactionRequest.count()).toBe(0);
  });
});

describe('la deroga', () => {
  it('apre la registrazione solo a un amministratore con un account, solo con la richiesta aperta', async () => {
    const { registrazione, posto } = await scena();
    const admin = await entraCome('ADMIN');
    const creata = await creaDalloStaff(
      richiesta('/api/admin/recording-removals', 'POST', {
        recordingId: registrazione.id,
        seatIds: [posto, 'reg-inventato-00000000'],
        name: 'Persona Iscritta',
        note: 'Arrivata per email',
      }) as never,
      { params: Promise.resolve({}) }
    );
    expect(creata.status).toBe(201);
    const { id } = (await creata.json()) as { id: string };
    const r = await prisma.recordingRedactionRequest.findUniqueOrThrow({ where: { id } });
    expect(r.seatIds).toEqual([posto]);
    expect(r.source).toBe('admin');

    expect(
      await derogaPerRimozione({ role: 'admin', accountId: admin.id }, registrazione.id)
    ).toMatchObject({
      requestId: id,
      accountId: admin.id,
    });
    expect(
      await derogaPerRimozione({ role: 'admin', accountId: null }, registrazione.id)
    ).toBeNull();
    expect(
      await derogaPerRimozione(
        { role: 'organizer', accountId: admin.id, emailHash: 'x' },
        registrazione.id
      )
    ).toBeNull();

    const video = await media(
      richiesta(`/api/admin/recording-removals/${id}/media`) as never,
      parametri(id)
    );
    expect(video.status).toBe(302);
    expect(video.headers.get('location')).toBe(
      `https://storage.example.com/get/${VIDEO}`
    );
    const accesso = await prisma.adminAuditLog.findFirst({
      where: { action: 'RECORDING_REDACTION_ACCESS' },
    });
    expect(accesso).toMatchObject({
      actorHash: `admin:${admin.id}`,
      target: registrazione.id,
    });
    expect(JSON.parse(accesso!.details!)).toMatchObject({
      requestId: id,
      resource: 'media',
    });

    // Respinta, la deroga finisce.
    expect(
      (
        await respingi(
          richiesta(`/api/admin/recording-removals/${id}/reject`, 'POST', {
            note: 'Non compare',
          }) as never,
          parametri(id)
        )
      ).status
    ).toBe(200);
    const dopo = await media(
      richiesta(`/api/admin/recording-removals/${id}/media`) as never,
      parametri(id)
    );
    expect(dopo.status).toBe(403);
    expect(
      await prisma.gdprAuditLog.count({
        where: { action: 'RECORDING_REDACTION_REJECTED' },
      })
    ).toBe(1);
  });

  it('l’elenco di chi era in sala raggruppa i posti di un’iscrizione', async () => {
    const { registrazione, iscrizione, posto } = await scena();
    await entraCome('ADMIN');
    const risposta = await persone(
      richiesta(
        `/api/admin/recording-removals/people?recordingId=${registrazione.id}`
      ) as never,
      { params: Promise.resolve({}) }
    );
    const { people } = (await risposta.json()) as {
      people: Array<Record<string, unknown>>;
    };
    expect(people).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: `reg:${iscrizione.id}`,
          name: 'Persona Iscritta',
          kind: 'registrant',
          seatIds: [posto],
          inVideo: true,
        }),
        expect.objectContaining({ kind: 'guest', name: 'Altra persona' }),
      ])
    );
    expect(JSON.stringify(people)).not.toContain('ep-persona');
  });
});

describe('dal video al video ripulito', () => {
  it('accoda il lavoro, il worker lo prende e consegna, la registrazione cambia', async () => {
    const { evento, registrazione, posto } = await scena();
    const admin = await entraCome('ADMIN');
    const creata = await creaDalloStaff(
      richiesta('/api/admin/recording-removals', 'POST', {
        recordingId: registrazione.id,
        seatIds: [posto],
        name: 'Persona Iscritta',
      }) as never,
      { params: Promise.resolve({}) }
    );
    const { id } = (await creata.json()) as { id: string };
    expect(
      (
        await avvia(
          richiesta(`/api/admin/recording-removals/${id}/start`, 'POST') as never,
          parametri(id)
        )
      ).status
    ).toBe(200);
    expect(
      (await prisma.recordingRedactionRequest.findUniqueOrThrow({ where: { id } })).status
    ).toBe('IN_PROGRESS');

    const inviata = await invia(
      richiesta(`/api/admin/recording-removals/${id}/submit`, 'POST', {
        intervals: [
          { start: 60, end: 120 },
          { start: 110, end: 180 },
          { start: 590, end: 900 },
        ],
      }) as never,
      parametri(id)
    );
    expect(await inviata.json()).toEqual({ status: 'PROCESSING' });
    const r = await prisma.recordingRedactionRequest.findUniqueOrThrow({ where: { id } });
    expect(r.status).toBe('PROCESSING');
    // Nessun taglio sulla durata salvata: la taglia il worker sul file vero.
    expect(r.intervals).toEqual([
      { start: 60, end: 180 },
      { start: 590, end: 900 },
    ]);
    const lavoro = await prisma.postprodJob.findUniqueOrThrow({
      where: { id: r.jobId! },
    });
    // Un lavoro dell'evento: la registrazione sta nel payload.
    expect(lavoro).toMatchObject({
      kind: 'REDACT',
      eventId: evento.id,
      recordingId: null,
      status: 'PENDING',
    });

    const presa = await reclama(
      interna('/api/internal/postprod-claim', {
        workerId: 'w',
        kinds: ['REDACT'],
      }) as never,
      {
        params: Promise.resolve({}),
      }
    );
    const ordine = (await presa.json()) as Record<string, unknown> & {
      uploadTargets: { redactedVideo: { blobKey: string } };
      redaction: { intervals: unknown; card: string };
      attempts: number;
    };
    const chiave = `recordings/redacted/${evento.id}/${registrazione.id}/${id}.mp4`;
    expect(ordine).toMatchObject({
      kind: 'REDACT',
      jobId: lavoro.id,
      sourceDownloadUrl: `https://storage.example.com/get/${VIDEO}`,
      uploadTargets: { redactedVideo: { blobKey: chiave, contentType: 'video/mp4' } },
      redaction: { intervals: r.intervals, card: 'UE5H', durationSec: 600 },
    });

    // L'avanzamento con il numero del claim rinnova il lease.
    const vivo = await avanza(
      interna('/api/internal/postprod-progress', {
        jobId: lavoro.id,
        status: 'RUNNING',
        attempt: ordine.attempts,
        percent: 40,
      }) as never,
      { params: Promise.resolve({}) }
    );
    expect(await vivo.json()).toMatchObject({ ok: true, status: 'RUNNING' });

    storage.list.mockResolvedValue([
      {
        key: `postprod/${evento.id}/${registrazione.id}/001/transcript.raw.json`,
        sizeBytes: 1,
      },
      {
        key: `postprod/${evento.id}/${registrazione.id}/002/transcript.raw.json`,
        sizeBytes: 1,
      },
    ]);
    const consegnata = await consegna(
      interna('/api/internal/recording-redaction', {
        jobId: lavoro.id,
        attempt: ordine.attempts,
        blobKey: chiave,
        sizeBytes: 1234,
        durationSec: 600,
      }) as never,
      { params: Promise.resolve({}) }
    );
    expect(await consegnata.json()).toMatchObject({
      ok: true,
      videoReplaced: true,
      tracksDeleted: 1,
      captionSegmentsDeleted: 1,
      outputsDeleted: 2,
      rerun: true,
      intervals: 2,
      secondsRemoved: 130,
    });

    const nuova = await prisma.recording.findUniqueOrThrow({
      where: { id: registrazione.id },
    });
    expect(nuova).toMatchObject({
      blobKey: chiave,
      fileSizeBytes: BigInt(1234),
      runCount: 2,
      status: 'POSTPROD_QUEUED',
    });
    expect(
      await prisma.event.findUniqueOrThrow({ where: { id: evento.id } })
    ).toMatchObject({
      recordingUrl: `https://storage.example.com/bucket/${chiave}`,
      recordingPublished: true,
    });
    expect(
      await prisma.callSession.findUniqueOrThrow({
        where: { id: registrazione.callSessionId },
      })
    ).toMatchObject({
      recordingUrl: `https://storage.example.com/bucket/${chiave}`,
      recordingFilename: `redacted/${evento.id}/${registrazione.id}/${id}.mp4`,
    });
    // La traccia della persona se ne va, quella dell'altra resta.
    expect((await prisma.recordingTrack.findMany()).map((t) => t.participantId)).toEqual([
      'ep-altro',
    ]);
    expect((await prisma.captionSegment.findMany()).map((c) => c.messageId)).toEqual([
      'm2',
    ]);
    expect(await prisma.speaker.count()).toBe(0);
    // Il registro di chi parla tiene le voci della persona, senza il nome.
    expect(
      (
        await prisma.callSession.findUniqueOrThrow({
          where: { id: registrazione.callSessionId },
        })
      ).dominantSpeakerLog
    ).toEqual([
      { atMs: 100_000, participantId: 'ep-persona' },
      { atMs: 130_000, participantId: 'ep-altro', displayName: 'Altra persona' },
    ]);
    expect(await prisma.postprodArtifact.count()).toBe(0);
    // La pipeline riparte su una run nuova.
    // Dal video completo, come prima: la conferma delle voci vale per il video ripulito.
    expect(
      await prisma.postprodJob.count({
        where: { recordingId: registrazione.id, kind: 'TRANSCRIBE', status: 'PENDING' },
      })
    ).toBe(1);
    expect(
      await prisma.postprodJob.findUniqueOrThrow({ where: { id: lavoro.id } })
    ).toMatchObject({ status: 'DONE' });
    expect(
      await prisma.recordingRedactionRequest.findUniqueOrThrow({ where: { id } })
    ).toMatchObject({ status: 'CLOSED' });
    const fatta = await prisma.gdprAuditLog.findFirst({
      where: { action: 'RECORDING_REDACTED' },
    });
    expect(JSON.parse(fatta!.details!)).toMatchObject({
      requestId: id,
      videoReplaced: true,
      rerun: true,
    });

    // Dopo il commit: il video originale, la traccia della persona, il
    // manifesto, i file della run vecchia. Quelli della run nuova restano.
    const cancellati = storage.delete.mock.calls.map((c) => (c as unknown[])[0]);
    expect(cancellati).toEqual(
      expect.arrayContaining([
        VIDEO,
        `recordings/multitrack/${evento.id}/${registrazione.id}/audio/persona.opus`,
        `recordings/multitrack/${evento.id}/${registrazione.id}/tracks.json`,
        `postprod/${evento.id}/${registrazione.id}/001/transcript.raw.json`,
      ])
    );
    expect(cancellati).not.toContain(
      `postprod/${evento.id}/${registrazione.id}/002/transcript.raw.json`
    );

    // La richiesta e' chiusa: la deroga e' finita.
    expect(
      await derogaPerRimozione({ role: 'admin', accountId: admin.id }, registrazione.id)
    ).toBeNull();
    // Una seconda consegna dello stesso lavoro non rifa' niente.
    const ancora = await consegna(
      interna('/api/internal/recording-redaction', {
        jobId: lavoro.id,
        attempt: ordine.attempts,
        blobKey: chiave,
      }) as never,
      { params: Promise.resolve({}) }
    );
    expect(await ancora.json()).toEqual({ ok: true, alreadyDelivered: true });
  });

  it('con un video servono intervalli, e una rimozione alla volta per registrazione', async () => {
    const { registrazione, posto } = await scena();
    await entraCome('ADMIN');
    const crea = async () =>
      (
        (await (
          await creaDalloStaff(
            richiesta('/api/admin/recording-removals', 'POST', {
              recordingId: registrazione.id,
              seatIds: [posto],
              name: 'P',
            }) as never,
            { params: Promise.resolve({}) }
          )
        ).json()) as { id: string }
      ).id;
    const prima = await crea();
    const seconda = await crea();
    const vuota = await invia(
      richiesta(`/api/admin/recording-removals/${prima}/submit`, 'POST', {
        intervals: [],
      }) as never,
      parametri(prima)
    );
    expect(vuota.status).toBe(422);
    expect(
      (await prisma.recordingRedactionRequest.findUniqueOrThrow({ where: { id: prima } }))
        .status
    ).toBe('OPEN');
    await invia(
      richiesta(`/api/admin/recording-removals/${prima}/submit`, 'POST', {
        intervals: [{ start: 1, end: 2 }],
      }) as never,
      parametri(prima)
    );
    const insieme = await invia(
      richiesta(`/api/admin/recording-removals/${seconda}/submit`, 'POST', {
        intervals: [{ start: 3, end: 4 }],
      }) as never,
      parametri(seconda)
    );
    expect(insieme.status).toBe(409);
    expect(await prisma.postprodJob.count({ where: { kind: 'REDACT' } })).toBe(1);
  });

  it('un lavoro fallito per sempre riporta subito la richiesta allo staff', async () => {
    const { registrazione, posto } = await scena();
    await prisma.siteSetting.update({
      where: { id: 'singleton' },
      data: { aiJobMaxAttempts: 1 },
    });
    await entraCome('ADMIN');
    const { id } = (await (
      await creaDalloStaff(
        richiesta('/api/admin/recording-removals', 'POST', {
          recordingId: registrazione.id,
          seatIds: [posto],
          name: 'P',
        }) as never,
        { params: Promise.resolve({}) }
      )
    ).json()) as { id: string };
    await invia(
      richiesta(`/api/admin/recording-removals/${id}/submit`, 'POST', {
        intervals: [{ start: 1, end: 2 }],
      }) as never,
      parametri(id)
    );
    const ordine = (await (
      await reclama(
        interna('/api/internal/postprod-claim', {
          workerId: 'w',
          kinds: ['REDACT'],
        }) as never,
        {
          params: Promise.resolve({}),
        }
      )
    ).json()) as { jobId: string; attempts: number };
    await avanza(
      interna('/api/internal/postprod-progress', {
        jobId: ordine.jobId,
        status: 'FAILED',
        attempt: ordine.attempts,
        error: 'ffmpeg exited 1',
      }) as never,
      { params: Promise.resolve({}) }
    );
    expect(
      await prisma.recordingRedactionRequest.findUniqueOrThrow({ where: { id } })
    ).toMatchObject({
      status: 'IN_PROGRESS',
      lastError: 'ffmpeg exited 1',
    });
  });

  it('una pipeline in corso senza ancora una trascrizione riparte sul video ripulito', async () => {
    const { evento, registrazione, posto } = await scena();
    await prisma.postprodArtifact.deleteMany();
    await prisma.postprodJob.updateMany({ data: { status: 'RUNNING' } });
    await entraCome('ADMIN');
    const { id } = (await (
      await creaDalloStaff(
        richiesta('/api/admin/recording-removals', 'POST', {
          recordingId: registrazione.id,
          seatIds: [posto],
          name: 'P',
        }) as never,
        { params: Promise.resolve({}) }
      )
    ).json()) as { id: string };
    await invia(
      richiesta(`/api/admin/recording-removals/${id}/submit`, 'POST', {
        intervals: [{ start: 1, end: 2 }],
      }) as never,
      parametri(id)
    );
    const ordine = (await (
      await reclama(
        interna('/api/internal/postprod-claim', {
          workerId: 'w',
          kinds: ['REDACT'],
        }) as never,
        {
          params: Promise.resolve({}),
        }
      )
    ).json()) as { jobId: string; attempts: number };
    const consegnata = await consegna(
      interna('/api/internal/recording-redaction', {
        jobId: ordine.jobId,
        attempt: ordine.attempts,
        blobKey: `recordings/redacted/${evento.id}/${registrazione.id}/${id}.mp4`,
      }) as never,
      { params: Promise.resolve({}) }
    );
    expect(await consegnata.json()).toMatchObject({
      ok: true,
      outputsDeleted: 0,
      jobsClosed: 1,
      rerun: true,
    });
    expect(
      await prisma.postprodJob.count({
        where: { recordingId: registrazione.id, status: 'RUNNING' },
      })
    ).toBe(0);
    expect(
      (await prisma.recording.findUniqueOrThrow({ where: { id: registrazione.id } }))
        .status
    ).toBe('POSTPROD_QUEUED');
  });

  it('se il video e’ cambiato nel frattempo, il lavoro si chiude e la richiesta torna allo staff', async () => {
    const { registrazione, posto } = await scena();
    await entraCome('ADMIN');
    const { id } = (await (
      await creaDalloStaff(
        richiesta('/api/admin/recording-removals', 'POST', {
          recordingId: registrazione.id,
          seatIds: [posto],
          name: 'P',
        }) as never,
        { params: Promise.resolve({}) }
      )
    ).json()) as { id: string };
    await invia(
      richiesta(`/api/admin/recording-removals/${id}/submit`, 'POST', {
        intervals: [{ start: 1, end: 2 }],
      }) as never,
      parametri(id)
    );
    await prisma.recording.update({
      where: { id: registrazione.id },
      data: { blobKey: 'recordings/altro.mp4' },
    });

    const presa = await reclama(
      interna('/api/internal/postprod-claim', {
        workerId: 'w',
        kinds: ['REDACT'],
      }) as never,
      {
        params: Promise.resolve({}),
      }
    );
    expect(presa.status).toBe(204);
    const { request: vista } = (await (
      await leggi(
        richiesta(`/api/admin/recording-removals/${id}`) as never,
        parametri(id)
      )
    ).json()) as { request: { status: string; lastError: string } };
    expect(vista.status).toBe('IN_PROGRESS');
    expect(vista.lastError).toMatch(/no longer has the video/);
  });

  it('senza video (solo tracce) la rimozione si applica subito', async () => {
    const { evento, registrazione, posto } = await scena();
    await prisma.recording.update({
      where: { id: registrazione.id },
      data: { blobKey: `recordings/multitrack/${evento.id}/` },
    });
    await prisma.postprodJob.updateMany({ data: { kind: 'TRANSCRIBE_MULTITRACK' } });
    await entraCome('ADMIN');
    const { id } = (await (
      await creaDalloStaff(
        richiesta('/api/admin/recording-removals', 'POST', {
          recordingId: registrazione.id,
          seatIds: [posto],
          name: 'P',
        }) as never,
        { params: Promise.resolve({}) }
      )
    ).json()) as { id: string };
    const risposta = await invia(
      richiesta(`/api/admin/recording-removals/${id}/submit`, 'POST', {
        intervals: [],
      }) as never,
      parametri(id)
    );
    // L'altra traccia non ha il consenso alla trascrizione: dalle tracce non
    // riparte niente, e mai dal video completo che nessuno ha confermato.
    expect(await risposta.json()).toMatchObject({
      status: 'CLOSED',
      videoReplaced: false,
      tracksDeleted: 1,
      rerun: false,
    });
    expect(
      await prisma.postprodJob.count({
        where: { kind: { in: ['REDACT', 'TRANSCRIBE'] } },
      })
    ).toBe(0);
    expect(
      (await prisma.recording.findUniqueOrThrow({ where: { id: registrazione.id } }))
        .status
    ).toBe('READY');
    expect((await prisma.recordingTrack.findMany()).map((t) => t.participantId)).toEqual([
      'ep-altro',
    ]);
  });
});

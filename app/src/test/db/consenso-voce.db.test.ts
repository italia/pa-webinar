// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Il video di una registrazione nuova e la conferma sulle voci, su un database
 * vero: il default della colonna, la transazione che annulla gli interruttori,
 * i lavori che compaiono solo con la conferma, la voce della chiusura e i nomi
 * della trascrizione pubblica.
 */
import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as generaPerEvento } from '@/app/api/admin/events/[id]/generate-ai/route';
import { POST as generaPerRegistrazione } from '@/app/api/admin/postprod/recordings/[id]/generate-ai/route';
import { POST as rilancia } from '@/app/api/admin/postprod/recordings/[id]/rerun/route';
import { GET as trascrizione } from '@/app/api/events/[param]/postprod/transcript/route';
import { POST as prendiLavoro } from '@/app/api/internal/postprod-claim/route';
import { POST as manifest } from '@/app/api/internal/multitrack-manifest/route';
import { GET as contaCoda } from '@/app/api/internal/postprod-pending/route';
import { POST as webhook } from '@/app/api/webhooks/recording/route';
import { MOTIVO_TRACCE_ASSENTI } from '@/lib/ai/track-inputs';
import { CAPTIONS_TRANSCRIPT_MODEL } from '@/lib/captions/transcript';
import { encryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { caricaDatiChiusura, statoChiusura } from '@/lib/events/closing';

import {
  creaEvento,
  creaIscrizione,
  creaLavoro,
  creaRegistrazione,
  creaSessione,
  entraCome,
  richiesta,
  svuotaDatabase,
} from './fixtures';

// Fuori da Next il caricamento dei testi non c'e': serve solo l'etichetta.
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (_chiave: string, v: { n: number }) => `Voce ${v.n}`,
}));

// Il worker non scarica niente: degli indirizzi firmati basta la forma.
vi.mock('@/lib/storage/postprod', async (originale) => ({
  ...(await originale<object>()),
  presignArtifactDownload: async ({ blobKey }: { blobKey: string }) =>
    `https://giu/${blobKey}`,
  presignArtifactUpload: async ({ blobKey }: { blobKey: string }) => ({
    uploadUrl: `https://su/${blobKey}`,
  }),
}));

const CHIAVE = 'chiave-delle-prove-sul-database';

beforeEach(async () => {
  await svuotaDatabase();
  await prisma.siteSetting.create({ data: { id: 'singleton', aiPipelineEnabled: true } });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

async function eventoConcluso(campi: Parameters<typeof creaEvento>[0] = {}) {
  return creaEvento({
    status: 'ENDED',
    recordingEnabled: true,
    aiTranscriptEnabled: true,
    endsAt: new Date(Date.now() - 3_600_000),
    ...campi,
  });
}

function arriva(evento: { jitsiRoomName: string }) {
  return webhook(
    richiesta(
      '/api/webhooks/recording',
      'POST',
      {
        roomName: evento.jitsiRoomName,
        recordingUrl: 'https://storage.example.org/bucket/recordings/video.mp4',
        filename: `${randomUUID()}.mp4`,
        duration: 120,
      },
      CHIAVE
    ) as never,
    { params: Promise.resolve({}) }
  );
}

/** Una traccia con il consenso della persona, al testo della versione data. */
async function tracciaDiIscritto(eventId: string, recordingId: string, versione: number) {
  const { iscrizione, endpoint } = await personaInSala(eventId, versione);
  await prisma.recordingTrack.create({
    data: { recordingId, participantId: endpoint, blobKey: `tracce/${randomUUID()}.ogg` },
  });
  return iscrizione;
}

async function personaInSala(eventId: string, versione: number) {
  const iscrizione = await creaIscrizione(eventId);
  await prisma.registration.update({
    where: { id: iscrizione.id },
    data: { consentMultitrack: true, consentMultitrackVersion: versione },
  });
  const endpoint = `ep-${randomUUID()}`;
  await prisma.roomOccupant.create({
    data: { eventId, endpointId: endpoint, seatId: `reg-${iscrizione.id}-a`, joinedAt: new Date() },
  });
  return { iscrizione, endpoint };
}

/** Il segnaposto multitraccia, come lo lascia il registratore in diretta. */
async function creaSegnaposto(eventId: string) {
  const rec = await creaRegistrazione(eventId);
  return prisma.recording.update({
    where: { id: rec.id },
    data: { blobKey: `recordings/multitrack/${eventId}/` },
  });
}

function consegnaTracce(eventId: string, recordingId: string, participantId: string) {
  return manifest(
    new Request('http://localhost/api/internal/multitrack-manifest', {
      method: 'POST',
      headers: { 'x-api-key': CHIAVE, 'content-type': 'application/json' },
      body: JSON.stringify({
        eventId,
        recordingId,
        tracks: [
          {
            participantId,
            blobKey: `recordings/multitrack/${eventId}/${recordingId}/${randomUUID()}.ogg`,
          },
        ],
      }),
    }) as never,
    { params: Promise.resolve({}) }
  );
}

async function voceTrascrizione(eventId: string, staff = true) {
  const dati = await caricaDatiChiusura(eventId);
  return statoChiusura(dati!, { staff }).voci.find((v) => v.voce === 'trascrizione');
}

function genera(eventId: string, corpo: unknown = {}) {
  return generaPerEvento(
    richiesta(`/api/admin/events/${eventId}/generate-ai`, 'POST', corpo) as never,
    { params: Promise.resolve({ id: eventId }) }
  );
}

describe('il segno sulla registrazione', () => {
  it('ogni registrazione creata senza dirlo nasce sotto la regola', async () => {
    const evento = await creaEvento();
    expect((await creaRegistrazione(evento.id)).transcriptConsentRule).toBe(true);
  });

  it('il default di colonna e’ vero: nessun creatore deve scriverlo', async () => {
    const [colonna] = await prisma.$queryRaw<
      { column_default: string; is_nullable: string }[]
    >`
      SELECT column_default, is_nullable FROM information_schema.columns
      WHERE table_name = 'recordings' AND column_name = 'transcript_consent_rule'`;
    expect(colonna).toEqual({ column_default: 'true', is_nullable: 'NO' });
  });
});

describe('il video nuovo senza tracce per persona', () => {
  it('il webhook non accoda niente e lo dice, la chiusura lo mette tra le cose da fare', async () => {
    const evento = await eventoConcluso();
    const risposta = await arriva(evento);
    expect(risposta.status).toBe(200);
    const corpo = (await risposta.json()) as {
      recordingId: string;
      postprodEnqueued: number;
      postprodAwaitsVoiceConsent: boolean;
    };
    expect(corpo).toMatchObject({
      postprodEnqueued: 0,
      postprodAwaitsVoiceConsent: true,
    });
    expect(await prisma.postprodJob.count()).toBe(0);
    await expect(voceTrascrizione(evento.id)).resolves.toMatchObject({
      stato: 'da-fare',
      caso: 'daConfermare',
      recordingId: corpo.recordingId,
    });
    await expect(voceTrascrizione(evento.id, false)).resolves.toMatchObject({
      stato: 'non-serve',
      caso: 'soloStaff',
    });
  });

  it('avviare senza conferma da’ 409 e annulla gli interruttori accesi; con la conferma parte', async () => {
    const evento = await eventoConcluso({ aiTranscriptEnabled: false });
    const rec = await creaRegistrazione(evento.id);
    await entraCome('ADMIN');

    const rifiuto = await genera(evento.id, { summary: true });
    expect(rifiuto.status).toBe(409);
    await expect(rifiuto.json()).resolves.toMatchObject({
      code: 'VOICE_CONSENT_REQUIRED',
    });
    expect(await prisma.postprodJob.count()).toBe(0);
    const fermo = await prisma.event.findUniqueOrThrow({ where: { id: evento.id } });
    expect([fermo.aiTranscriptEnabled, fermo.aiSummaryEnabled]).toEqual([false, false]);

    const ok = await genera(evento.id, { summary: true, allVoicesConsented: true });
    expect(ok.status).toBe(200);
    const lavori = await prisma.postprodJob.findMany({ select: { kind: true } });
    expect(lavori.map((l) => l.kind).sort()).toEqual(['SUMMARIZE', 'TRANSCRIBE']);
    expect(
      (await prisma.recording.findUniqueOrThrow({ where: { id: rec.id } })).status
    ).toBe('POSTPROD_QUEUED');
    await expect(voceTrascrizione(evento.id)).resolves.toMatchObject({
      stato: 'in-corso',
      caso: 'inLavorazione',
    });
  });

  it('un rilancio senza conferma lascia la registrazione dov’e’', async () => {
    const evento = await eventoConcluso();
    const rec = await creaRegistrazione(evento.id);
    await entraCome('ADMIN');
    const r = await rilancia(
      richiesta(`/api/admin/postprod/recordings/${rec.id}/rerun`, 'POST', {}) as never,
      { params: Promise.resolve({ id: rec.id }) }
    );
    expect(r.status).toBe(409);
    const dopo = await prisma.recording.findUniqueOrThrow({ where: { id: rec.id } });
    expect([dopo.status, dopo.runCount]).toEqual(['READY', rec.runCount]);
  });

  it('anche «Genera AI» dalla pagina della registrazione la chiede', async () => {
    const evento = await eventoConcluso({ aiTranscriptEnabled: false });
    const rec = await creaRegistrazione(evento.id);
    await entraCome('ADMIN');
    const r = await generaPerRegistrazione(
      richiesta(
        `/api/admin/postprod/recordings/${rec.id}/generate-ai`,
        'POST',
        {}
      ) as never,
      { params: Promise.resolve({ id: rec.id }) }
    );
    expect(r.status).toBe(409);
    expect(
      (await prisma.event.findUniqueOrThrow({ where: { id: evento.id } }))
        .aiTranscriptEnabled
    ).toBe(false);
  });

  it('con le tracce per persona la pipeline parte da sola, senza conferma', async () => {
    const evento = await eventoConcluso({ multitrackRecordingEnabled: true });
    const rec = await creaRegistrazione(evento.id);
    await tracciaDiIscritto(evento.id, rec.id, 2);
    await entraCome('ADMIN');
    expect((await genera(evento.id)).status).toBe(200);
    const lavori = await prisma.postprodJob.findMany({ select: { kind: true } });
    expect(lavori.map((l) => l.kind)).toContain('TRANSCRIBE_MULTITRACK');
    await expect(voceTrascrizione(evento.id)).resolves.not.toMatchObject({
      caso: 'daConfermare',
    });
  });

  describe('tracce che nessun consenso lascia trascrivere', () => {
    it('avviare da’ 422, nessun lavoro, e gli interruttori tornano com’erano', async () => {
      const evento = await eventoConcluso({
        multitrackRecordingEnabled: true,
        aiTranscriptEnabled: false,
      });
      const rec = await creaRegistrazione(evento.id);
      await tracciaDiIscritto(evento.id, rec.id, 1);
      await entraCome('ADMIN');

      const risposta = await genera(evento.id);

      expect(risposta.status).toBe(422);
      expect(await risposta.json()).toMatchObject({ code: 'NO_TRANSCRIBABLE_TRACKS' });
      expect(await prisma.postprodJob.count()).toBe(0);
      const dopo = await prisma.event.findUniqueOrThrow({ where: { id: evento.id } });
      expect(dopo.aiTranscriptEnabled).toBe(false);
    });

    it('un rilancio lascia la registrazione e il contatore dove sono', async () => {
      const evento = await eventoConcluso({ multitrackRecordingEnabled: true });
      const rec = await creaRegistrazione(evento.id);
      await tracciaDiIscritto(evento.id, rec.id, 1);
      await entraCome('ADMIN');

      const risposta = await rilancia(
        richiesta(`/api/admin/postprod/recordings/${rec.id}/rerun`, 'POST', {}) as never,
        { params: Promise.resolve({ id: rec.id }) }
      );

      expect(risposta.status).toBe(422);
      const dopo = await prisma.recording.findUniqueOrThrow({ where: { id: rec.id } });
      expect(dopo).toMatchObject({ runCount: rec.runCount, status: rec.status });
    });

    it('un lavoro rimasto senza tracce in coda si chiude prima di contare la coda', async () => {
      const evento = await eventoConcluso({ multitrackRecordingEnabled: true });
      const rec = await creaRegistrazione(evento.id);
      await tracciaDiIscritto(evento.id, rec.id, 1);
      await prisma.recording.update({ where: { id: rec.id }, data: { status: 'POSTPROD_QUEUED' } });
      const lavoro = await prisma.postprodJob.create({
        data: {
          recordingId: rec.id,
          kind: 'TRANSCRIBE_MULTITRACK',
          payload: { runId: randomUUID(), sourceLanguage: 'it' },
          idempotencyKey: randomUUID(),
          status: 'PENDING',
        },
      });

      const risposta = await contaCoda(
        new Request('http://localhost/api/internal/postprod-pending', {
          headers: { 'x-api-key': CHIAVE },
        }) as never,
        { params: Promise.resolve({}) }
      );

      expect(await risposta.json()).toMatchObject({ runnable: 0, desiredGpu: 0 });
      expect(await prisma.postprodJob.findUniqueOrThrow({ where: { id: lavoro.id } })).toMatchObject({
        status: 'FAILED',
        lastError: MOTIVO_TRACCE_ASSENTI,
      });
      expect(await prisma.recording.findUniqueOrThrow({ where: { id: rec.id } })).toMatchObject({
        status: 'POSTPROD_PARTIAL',
      });
    });

    it('una radice chiusa senza tracce non si riapre con Genera AI', async () => {
      const evento = await eventoConcluso({ multitrackRecordingEnabled: true, aiSummaryEnabled: true });
      const rec = await creaRegistrazione(evento.id);
      const iscrizione = await tracciaDiIscritto(evento.id, rec.id, 2);
      await entraCome('ADMIN');
      expect((await genera(evento.id, { summary: true })).status).toBe(200);

      await prisma.registration.update({
        where: { id: iscrizione.id },
        data: { consentMultitrackVersion: 1 },
      });
      const coda = await contaCoda(
        new Request('http://localhost/api/internal/postprod-pending', {
          headers: { 'x-api-key': CHIAVE },
        }) as never,
        { params: Promise.resolve({}) }
      );
      expect(await coda.json()).toMatchObject({ desiredGpu: 0 });
      expect(await prisma.recording.findUniqueOrThrow({ where: { id: rec.id } })).toMatchObject({
        status: 'POSTPROD_PARTIAL',
      });

      const risposta = await genera(evento.id, { summary: true });

      expect(risposta.status).toBe(422);
      expect(await risposta.json()).toMatchObject({ code: 'NO_TRANSCRIBABLE_TRACKS' });
      expect(await prisma.recording.findUniqueOrThrow({ where: { id: rec.id } })).toMatchObject({
        status: 'POSTPROD_PARTIAL',
      });
    });

    it('un lavoro con una traccia trascrivibile resta in coda', async () => {
      const evento = await eventoConcluso({ multitrackRecordingEnabled: true });
      const rec = await creaRegistrazione(evento.id);
      await tracciaDiIscritto(evento.id, rec.id, 2);
      await prisma.postprodJob.create({
        data: {
          recordingId: rec.id,
          kind: 'TRANSCRIBE_MULTITRACK',
          payload: { runId: randomUUID(), sourceLanguage: 'it' },
          idempotencyKey: randomUUID(),
          status: 'PENDING',
        },
      });

      const risposta = await contaCoda(
        new Request('http://localhost/api/internal/postprod-pending', {
          headers: { 'x-api-key': CHIAVE },
        }) as never,
        { params: Promise.resolve({}) }
      );

      expect(await risposta.json()).toMatchObject({ runnable: 1, desiredGpu: 1 });
    });
  });

  describe('tracce che il registratore non ha ancora consegnato', () => {
    it('Genera AI lascia accesa l’AI e il manifest fa partire la pipeline', async () => {
      const evento = await eventoConcluso({
        multitrackRecordingEnabled: true,
        aiTranscriptEnabled: false,
      });
      const rec = await creaSegnaposto(evento.id);
      await entraCome('ADMIN');

      const risposta = await genera(evento.id, { summary: true });

      expect(risposta.status).toBe(200);
      expect(await risposta.json()).toMatchObject({ enqueued: 0, tracksPending: true });
      expect(await prisma.postprodJob.count()).toBe(0);
      expect(await prisma.recording.findUniqueOrThrow({ where: { id: rec.id } })).toMatchObject({
        status: 'READY',
      });
      expect(await prisma.event.findUniqueOrThrow({ where: { id: evento.id } })).toMatchObject({
        aiTranscriptEnabled: true,
        aiSummaryEnabled: true,
      });

      const { endpoint } = await personaInSala(evento.id, 2);
      const consegna = await consegnaTracce(evento.id, rec.id, endpoint);

      expect(consegna.status).toBe(200);
      const lavori = await prisma.postprodJob.findMany({ select: { kind: true } });
      expect(lavori.map((l) => l.kind).sort()).toEqual(['SUMMARIZE', 'TRANSCRIBE_MULTITRACK']);
      expect(await prisma.recording.findUniqueOrThrow({ where: { id: rec.id } })).toMatchObject({
        status: 'POSTPROD_QUEUED',
      });
    });

    it('Genera AI dalla registrazione risponde allo stesso modo', async () => {
      const evento = await eventoConcluso({ aiTranscriptEnabled: false });
      const rec = await creaSegnaposto(evento.id);
      await entraCome('ADMIN');

      const risposta = await generaPerRegistrazione(
        richiesta(`/api/admin/postprod/recordings/${rec.id}/generate-ai`, 'POST', {}) as never,
        { params: Promise.resolve({ id: rec.id }) }
      );

      expect(await risposta.json()).toMatchObject({ enqueued: 0, tracksPending: true });
    });

    it('un rilancio lo dice e lascia registrazione e contatore dove sono', async () => {
      const evento = await eventoConcluso();
      const rec = await creaSegnaposto(evento.id);
      await entraCome('ADMIN');

      const risposta = await rilancia(
        richiesta(`/api/admin/postprod/recordings/${rec.id}/rerun`, 'POST', {}) as never,
        { params: Promise.resolve({ id: rec.id }) }
      );

      expect(risposta.status).toBe(409);
      expect(await risposta.json()).toMatchObject({ code: 'TRACKS_PENDING' });
      expect(await prisma.recording.findUniqueOrThrow({ where: { id: rec.id } })).toMatchObject({
        runCount: rec.runCount,
        status: 'READY',
      });
    });

    it('tracce gia\' arrivate e tolte, a segnaposto rimasto: resta il 422', async () => {
      const evento = await eventoConcluso({ aiTranscriptEnabled: false });
      const rec = await creaSegnaposto(evento.id);
      await prisma.recording.update({ where: { id: rec.id }, data: { mediaStartedAt: new Date() } });
      await entraCome('ADMIN');

      const risposta = await genera(evento.id);

      expect(risposta.status).toBe(422);
      expect(await risposta.json()).toMatchObject({ code: 'NO_TRANSCRIBABLE_TRACKS' });
      expect(await prisma.event.findUniqueOrThrow({ where: { id: evento.id } })).toMatchObject({
        aiTranscriptEnabled: false,
      });
    });
  });

  it('senza AI sull’evento non c’e’ niente da confermare', async () => {
    const evento = await eventoConcluso({ aiTranscriptEnabled: false });
    await creaRegistrazione(evento.id);
    await expect(voceTrascrizione(evento.id)).resolves.toMatchObject({ caso: 'nessuna' });
  });

  it('una trascrizione dai sottotitoli pronta vince sul video fermo', async () => {
    const evento = await eventoConcluso({ captionsTranscriptEnabled: true });
    const rec = await creaRegistrazione(evento.id);
    const lavoro = await creaLavoro(rec.id, 'DONE');
    await prisma.postprodArtifact.create({
      data: {
        recordingId: rec.id,
        jobId: lavoro.id,
        type: 'TRANSCRIPT_JSON',
        blobKey: '',
        mimeType: 'application/json',
        contentHash: randomUUID().replaceAll('-', ''),
        modelId: CAPTIONS_TRANSCRIPT_MODEL,
      },
    });
    await expect(voceTrascrizione(evento.id)).resolves.toMatchObject({
      caso: 'prontaSottotitoli',
      recordingId: rec.id,
    });
  });
});

describe('il video nato prima della regola', () => {
  it('si accoda come prima, e la chiusura non chiede niente', async () => {
    const evento = await eventoConcluso();
    const rec = await creaRegistrazione(evento.id);
    await prisma.recording.update({
      where: { id: rec.id },
      data: { transcriptConsentRule: false },
    });
    await expect(voceTrascrizione(evento.id)).resolves.toMatchObject({ caso: 'nessuna' });
    await entraCome('ADMIN');
    expect((await genera(evento.id)).status).toBe(200);
    expect(await prisma.postprodJob.count()).toBeGreaterThan(0);
  });

  it('in un evento con righe vecchie e nuove decide la riga in esame', async () => {
    const evento = await eventoConcluso();
    const vecchia = await creaRegistrazione(evento.id);
    await prisma.recording.update({
      where: { id: vecchia.id },
      data: { transcriptConsentRule: false },
    });
    const nuova = await creaRegistrazione(evento.id);
    await expect(voceTrascrizione(evento.id)).resolves.toMatchObject({
      caso: 'daConfermare',
      recordingId: nuova.id,
    });
  });
});

describe('i nomi della trascrizione pubblica', () => {
  const NOME = 'Anna Bianchi';

  /** Un video pubblicato, con una voce sola che il registro attribuisce a una persona. */
  async function videoPubblicato(
    consenso: { dato: boolean; versione?: number },
    segno = true
  ) {
    const evento = await eventoConcluso({
      recordingPublished: true,
      recordingUrl: 'https://storage.example.org/video.mp4',
    });
    const iscrizione = await creaIscrizione(evento.id);
    await prisma.registration.update({
      where: { id: iscrizione.id },
      data: {
        consentMultitrack: consenso.dato,
        consentMultitrackVersion: consenso.dato ? (consenso.versione ?? 2) : null,
      },
    });
    const endpoint = 'ep-anna';
    await prisma.roomOccupant.create({
      data: {
        eventId: evento.id,
        endpointId: endpoint,
        seatId: `reg-${iscrizione.id}-a`,
        joinedAt: new Date(),
      },
    });
    const sessione = await creaSessione(evento.id, {
      dominantSpeakerLog: [{ atMs: 0, participantId: endpoint, displayName: NOME }],
    });
    const rec = await prisma.recording.create({
      data: {
        callSessionId: sessione.id,
        eventId: evento.id,
        blobKey: `recordings/${randomUUID()}.mp4`,
        status: 'POSTPROD_DONE',
        ...(segno ? {} : { transcriptConsentRule: false }),
      },
    });
    const lavoro = await creaLavoro(rec.id, 'DONE');
    await prisma.postprodArtifact.create({
      data: {
        recordingId: rec.id,
        jobId: lavoro.id,
        type: 'TRANSCRIPT_JSON',
        blobKey: '',
        mimeType: 'application/json',
        contentHash: randomUUID().replaceAll('-', ''),
        inlineBody: encryptPII(
          JSON.stringify({
            segments: [{ start: 0, end: 5, text: 'Buongiorno', speaker: 'SPEAKER_00' }],
          })
        ),
      },
    });
    await prisma.speaker.create({
      data: { recordingId: rec.id, diarLabel: 'SPEAKER_00' },
    });
    return evento;
  }

  async function nomeMostrato(slug: string) {
    const r = await trascrizione(
      richiesta(`/api/events/${slug}/postprod/transcript`) as never,
      { params: Promise.resolve({ param: slug }) }
    );
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { segments: { speakerName: string | null }[] };
    return corpo.segments[0]!.speakerName;
  }

  it('video nuovo, consenso negato: il nome non si mostra', async () => {
    const evento = await videoPubblicato({ dato: false });
    expect(await nomeMostrato(evento.slug)).toBe('Voce 1');
  });

  it('video nuovo, consenso al testo che comprende il nome: si mostra', async () => {
    const evento = await videoPubblicato({ dato: true, versione: 2 });
    expect(await nomeMostrato(evento.slug)).toBe(NOME);
  });

  it('video nuovo, consenso al testo vecchio: non si mostra', async () => {
    const evento = await videoPubblicato({ dato: true, versione: 1 });
    expect(await nomeMostrato(evento.slug)).toBe('Voce 1');
  });

  it('video nato prima della regola: i nomi restano, anche con il consenso negato', async () => {
    const evento = await videoPubblicato({ dato: false }, false);
    expect(await nomeMostrato(evento.slug)).toBe(NOME);
  });

  /**
   * Una registrazione per tracce: il worker riceve dal claim il nome della
   * traccia e lo salva sulla voce, come fa con lo speakerMap. La voce porta
   * l'id della traccia e il registro di chi parlava attribuisce la stessa voce.
   */
  async function dalleTracce(versione: number, segno = true) {
    const evento = await eventoConcluso({
      multitrackRecordingEnabled: true,
      recordingPublished: true,
      recordingUrl: 'https://storage.example.org/video.mp4',
    });
    const iscrizione = await creaIscrizione(evento.id);
    await prisma.registration.update({
      where: { id: iscrizione.id },
      data: { consentMultitrack: true, consentMultitrackVersion: versione },
    });
    const endpoint = 'ep-anna';
    await prisma.roomOccupant.create({
      data: {
        eventId: evento.id,
        endpointId: endpoint,
        seatId: `reg-${iscrizione.id}-a`,
        joinedAt: new Date(),
      },
    });
    const sessione = await creaSessione(evento.id, {
      dominantSpeakerLog: [{ atMs: 0, participantId: endpoint, displayName: NOME }],
    });
    const rec = await prisma.recording.create({
      data: {
        callSessionId: sessione.id,
        eventId: evento.id,
        blobKey: `recordings/${randomUUID()}.mp4`,
        status: 'POSTPROD_DONE',
        ...(segno ? {} : { transcriptConsentRule: false }),
      },
    });
    await prisma.recordingTrack.create({
      data: {
        recordingId: rec.id,
        participantId: endpoint,
        displayName: encryptPII(NOME),
        blobKey: `tracce/${randomUUID()}.ogg`,
      },
    });
    await prisma.postprodJob.create({
      data: {
        recordingId: rec.id,
        kind: 'TRANSCRIBE_MULTITRACK',
        payload: { runId: randomUUID(), sourceLanguage: 'it' },
        idempotencyKey: randomUUID(),
        status: 'PENDING',
      },
    });

    const presa = await prendiLavoro(
      new Request('http://localhost/api/internal/postprod-claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': CHIAVE },
        body: JSON.stringify({ workerId: 'prova', kinds: ['TRANSCRIBE_MULTITRACK'] }),
      }) as never,
      { params: Promise.resolve({}) }
    );
    // Nessuna traccia da trascrivere: il worker non riceve il lavoro.
    const { inputs } = (presa.status === 204 ? { inputs: [] } : await presa.json()) as {
      inputs: { role: string; participantId: string; displayName: string | null }[];
    };
    const traccia = inputs.find((i) => i.role === 'track');

    const lavoro = await creaLavoro(rec.id, 'DONE');
    await prisma.postprodArtifact.create({
      data: {
        recordingId: rec.id,
        jobId: lavoro.id,
        type: 'TRANSCRIPT_JSON',
        blobKey: '',
        mimeType: 'application/json',
        contentHash: randomUUID().replaceAll('-', ''),
        inlineBody: encryptPII(
          JSON.stringify({
            segments: [{ start: 0, end: 5, text: 'Buongiorno', speaker: endpoint }],
          })
        ),
      },
    });
    await prisma.speaker.create({
      data: {
        recordingId: rec.id,
        diarLabel: endpoint,
        displayName: traccia?.displayName ?? null,
      },
    });
    return { evento, endpoint, traccia };
  }

  it('tracce su video nuovo, consenso al testo vecchio: non si trascrivono e il nome non si mostra', async () => {
    const { evento, traccia } = await dalleTracce(1);
    expect(traccia).toBeUndefined();
    expect(await nomeMostrato(evento.slug)).toBe('Voce 1');
    await expect(
      prisma.postprodJob.findFirstOrThrow({ where: { kind: 'TRANSCRIBE_MULTITRACK' } })
    ).resolves.toMatchObject({ status: 'FAILED', lastError: MOTIVO_TRACCE_ASSENTI });
  });

  it('tracce su video nuovo, consenso al testo che comprende il nome: si mostra', async () => {
    const { evento, endpoint, traccia } = await dalleTracce(2);
    expect(traccia).toMatchObject({ participantId: endpoint, displayName: NOME });
    expect(await nomeMostrato(evento.slug)).toBe(NOME);
  });

  it('tracce nate prima della regola: il nome resta con il testo vecchio', async () => {
    const { evento, endpoint, traccia } = await dalleTracce(1, false);
    expect(traccia).toMatchObject({ participantId: endpoint, displayName: NOME });
    expect(await nomeMostrato(evento.slug)).toBe(NOME);
  });
});

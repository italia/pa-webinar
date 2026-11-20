// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import type { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const consensi = vi.hoisted(() => ({
  conConsenso: vi.fn(async (_e: string, endpoint: readonly string[], _v: number) => new Set(endpoint)),
  ritirati: vi.fn(async (_e: string, _endpoint: readonly string[]) => new Set<string>()),
}));
vi.mock('@/lib/captions/room', async (originale) => ({
  ...(await originale<object>()),
  endpointConConsenso: consensi.conConsenso,
  endpointRitirati: consensi.ritirati,
}));

import { enqueuePostprodForRecording } from './enqueue';

function txCon(recording: Record<string, unknown>) {
  const siteSetting = { findUnique: vi.fn(async () => ({ aiPipelineEnabled: true })) };
  const postprodArtifact = { findFirst: vi.fn(async () => null as unknown) };
  const tx = {
    recording: { findUnique: vi.fn(async () => recording) },
    postprodArtifact,
    siteSetting,
  } as unknown as Prisma.TransactionClient;
  return { tx, siteSetting, postprodArtifact };
}

const evento = {
  id: 'ev-1',
  aiTranscriptEnabled: true,
  aiSummaryEnabled: true,
  aiTranslationEnabled: false,
  aiDubbingEnabled: false,
  multitrackRecordingEnabled: false,
  captionsTranscriptEnabled: false,
  aiTargetLocales: null,
};

describe('enqueuePostprodForRecording', () => {
  it('non accoda niente per una registrazione «solo sottotitoli», senza file', async () => {
    const { tx, siteSetting } = txCon({ id: 'rec-1', blobKey: '', runCount: 0, event: evento });
    const esito = await enqueuePostprodForRecording(tx, { recordingId: 'rec-1' });
    expect(esito).toEqual({ enqueued: 0, skippedExisting: 0, jobIds: [] });
    // Si ferma prima di leggere le impostazioni: nessun lavoro possibile.
    expect(siteSetting.findUnique).not.toHaveBeenCalled();
  });

  it("non accoda niente se la trascrizione AI è spenta per l'evento", async () => {
    const { tx } = txCon({
      id: 'rec-1',
      blobKey: 'recordings/ev-1/a.mp4',
      runCount: 0,
      event: { ...evento, aiTranscriptEnabled: false },
    });
    const esito = await enqueuePostprodForRecording(tx, { recordingId: 'rec-1' });
    expect(esito.enqueued).toBe(0);
  });

  it('non accoda niente sopra una trascrizione dai sottotitoli corretta a mano', async () => {
    const { tx, siteSetting, postprodArtifact } = txCon({
      id: 'rec-1',
      blobKey: 'recordings/ev-1/a.mp4',
      runCount: 0,
      event: evento,
    });
    postprodArtifact.findFirst.mockResolvedValue({ id: 'art-1' });
    const esito = await enqueuePostprodForRecording(tx, { recordingId: 'rec-1' });
    expect(esito.enqueued).toBe(0);
    expect(siteSetting.findUnique).not.toHaveBeenCalled();
  });

  describe('video completo di un evento che chiede il consenso voce per voce', () => {
    function txCompleta(
      event: Record<string, unknown>,
      tracce: { frase?: boolean; segno?: boolean; tracce?: number } = {}
    ) {
      const { tx } = txCon({
        id: 'rec-1',
        blobKey: 'recordings/ev-1/a.mp4',
        runCount: 0,
        transcriptConsentRule: tracce.segno ?? false,
        event,
      });
      const t = tx as unknown as Record<string, unknown>;
      const update = vi.fn(async () => ({}));
      const create = vi.fn(async () => ({ id: `job-${create.mock.calls.length}` }));
      (t.recording as Record<string, unknown>).update = update;
      t.recordingTrack = {
        count: vi.fn(async () => tracce.tracce ?? 0),
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () =>
          Array.from({ length: tracce.tracce ?? 0 }, (_, i) => ({
            participantId: `ep-${i}`,
            displayName: null,
            blobKey: `tracce/${i}.ogg`,
            startOffsetMs: 0,
          }))
        ),
      };
      t.postprodJob = { findUnique: vi.fn(async () => null), create };
      t.captionSegment = { findFirst: vi.fn(async () => (tracce.frase ? { id: 'f' } : null)) };
      t.multitrackConsent = { findFirst: vi.fn(async () => null) };
      return { tx, update, create };
    }

    it('senza conferma chiede la conferma (409) e non tocca la registrazione', async () => {
      const { tx, update, create } = txCompleta({ ...evento, multitrackRecordingEnabled: true });
      await expect(enqueuePostprodForRecording(tx, { recordingId: 'rec-1' })).rejects.toMatchObject({
        statusCode: 409,
        code: 'VOICE_CONSENT_REQUIRED',
      });
      expect(update).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });

    it('il webhook salta in silenzio', async () => {
      const { tx, create } = txCompleta({ ...evento, multitrackRecordingEnabled: true });
      const esito = await enqueuePostprodForRecording(tx, { recordingId: 'rec-1', seServeConferma: 'salta' });
      expect(esito).toEqual({ enqueued: 0, skippedExisting: 0, jobIds: [], voiceConsentRequired: true });
      expect(create).not.toHaveBeenCalled();
    });

    it("vale anche se l'interruttore e' stato spento dopo l'evento: restano le frasi salvate", async () => {
      const { tx } = txCompleta(evento, { frase: true });
      const esito = await enqueuePostprodForRecording(tx, { recordingId: 'rec-1', seServeConferma: 'salta' });
      expect(esito.voiceConsentRequired).toBe(true);
    });

    it('la trascrizione dai sottotitoli senza il servizio installato non chiede niente', async () => {
      const { tx } = txCompleta({ ...evento, captionsTranscriptEnabled: true });
      const esito = await enqueuePostprodForRecording(tx, { recordingId: 'rec-1' });
      expect(esito.voiceConsentRequired).toBeUndefined();
      expect(esito.enqueued).toBeGreaterThan(0);
    });

    it('con la conferma esplicita lo trascrive', async () => {
      const { tx, create } = txCompleta({ ...evento, multitrackRecordingEnabled: true });
      const esito = await enqueuePostprodForRecording(tx, { recordingId: 'rec-1', allVoicesConsented: true });
      expect(esito.voiceConsentRequired).toBeUndefined();
      expect(esito.enqueued).toBeGreaterThan(0);
      expect(create).toHaveBeenCalled();
    });

    it('un evento che registra solo il video della sala lo trascrive come prima', async () => {
      const { tx } = txCompleta(evento);
      const esito = await enqueuePostprodForRecording(tx, { recordingId: 'rec-1' });
      expect(esito.enqueued).toBeGreaterThan(0);
    });

    describe('con il segno della registrazione', () => {
      it('senza conferma: 409 a chi la avvia, e niente lavori', async () => {
        const { tx, update, create } = txCompleta(evento, { segno: true });
        await expect(
          enqueuePostprodForRecording(tx, { recordingId: 'rec-1' })
        ).rejects.toMatchObject({ statusCode: 409, code: 'VOICE_CONSENT_REQUIRED' });
        expect(update).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
      });

      it('il webhook salta e lo dice', async () => {
        const { tx, create } = txCompleta(evento, { segno: true });
        await expect(
          enqueuePostprodForRecording(tx, { recordingId: 'rec-1', seServeConferma: 'salta' })
        ).resolves.toEqual({
          enqueued: 0,
          skippedExisting: 0,
          jobIds: [],
          voiceConsentRequired: true,
        });
        expect(create).not.toHaveBeenCalled();
      });

      it('con la conferma esplicita trascrive il video', async () => {
        const { tx, create } = txCompleta(evento, { segno: true });
        const esito = await enqueuePostprodForRecording(tx, {
          recordingId: 'rec-1',
          allVoicesConsented: true,
        });
        expect(esito.enqueued).toBeGreaterThan(0);
        expect(create.mock.calls[0]).toMatchObject([{ data: { kind: 'TRANSCRIBE' } }]);
      });

      it('le tracce per persona non chiedono conferma: contengono solo chi ha acconsentito', async () => {
        const { tx, create } = txCompleta(evento, { segno: true, tracce: 2 });
        const esito = await enqueuePostprodForRecording(tx, { recordingId: 'rec-1' });
        expect(esito.enqueued).toBeGreaterThan(0);
        expect(create.mock.calls[0]).toMatchObject([
          { data: { kind: 'TRANSCRIBE_MULTITRACK' } },
        ]);
      });

      it('il manifest delle tracce non chiede conferma', async () => {
        const { tx } = txCompleta(evento, { segno: true, tracce: 1 });
        const esito = await enqueuePostprodForRecording(tx, {
          recordingId: 'rec-1',
          multitrack: true,
        });
        expect(esito.enqueued).toBeGreaterThan(0);
      });

      describe('tracce per persona che non si possono trascrivere', () => {
        beforeEach(() => {
          consensi.conConsenso.mockClear();
          consensi.ritirati.mockClear();
        });

        it('solo consensi al testo vecchio: 422 e nessun lavoro, a chi la avvia a mano', async () => {
          consensi.conConsenso.mockResolvedValueOnce(new Set());
          const { tx, update, create } = txCompleta(evento, { segno: true, tracce: 2 });
          await expect(
            enqueuePostprodForRecording(tx, { recordingId: 'rec-1' })
          ).rejects.toMatchObject({ statusCode: 422, code: 'NO_TRANSCRIBABLE_TRACKS' });
          expect(update).not.toHaveBeenCalled();
          expect(create).not.toHaveBeenCalled();
          expect(consensi.conConsenso).toHaveBeenCalledWith('ev-1', ['ep-0', 'ep-1'], 2);
        });

        it('il manifest salta e lo dice', async () => {
          consensi.conConsenso.mockResolvedValueOnce(new Set());
          const { tx, update, create } = txCompleta(evento, { segno: true, tracce: 1 });
          await expect(
            enqueuePostprodForRecording(tx, {
              recordingId: 'rec-1',
              multitrack: true,
              seMancanoTracce: 'salta',
            })
          ).resolves.toEqual({
            enqueued: 0,
            skippedExisting: 0,
            jobIds: [],
            noTranscribableTracks: true,
          });
          expect(update).not.toHaveBeenCalled();
          expect(create).not.toHaveBeenCalled();
        });

        it('vale anche senza il segno, se tutti hanno ritirato', async () => {
          consensi.ritirati.mockResolvedValueOnce(new Set(['ep-0']));
          const { tx, create } = txCompleta(evento, { segno: false, tracce: 1 });
          await expect(
            enqueuePostprodForRecording(tx, { recordingId: 'rec-1' })
          ).rejects.toMatchObject({ code: 'NO_TRANSCRIBABLE_TRACKS' });
          expect(create).not.toHaveBeenCalled();
          expect(consensi.conConsenso).not.toHaveBeenCalled();
        });

        it('una traccia sola basta', async () => {
          consensi.conConsenso.mockResolvedValueOnce(new Set(['ep-1']));
          const { tx, create } = txCompleta(evento, { segno: true, tracce: 2 });
          const esito = await enqueuePostprodForRecording(tx, { recordingId: 'rec-1' });
          expect(esito.enqueued).toBeGreaterThan(0);
          expect(create).toHaveBeenCalled();
        });

        it('su una radice gia\' accodata la sintesi si aggiunge anche a tracce cancellate', async () => {
          const { tx, create } = txCompleta(
            { ...evento, multitrackRecordingEnabled: true },
            { segno: true, tracce: 0 }
          );
          const t = tx as unknown as { postprodJob: { findUnique: ReturnType<typeof vi.fn> } };
          t.postprodJob.findUnique
            .mockResolvedValueOnce({ status: 'DONE' })
            .mockResolvedValueOnce({ id: 'radice' });
          const esito = await enqueuePostprodForRecording(tx, {
            recordingId: 'rec-1',
            multitrack: true,
          });
          expect(esito).toMatchObject({ enqueued: 1, skippedExisting: 1 });
          expect(create.mock.calls).toMatchObject([
            [{ data: { kind: 'SUMMARIZE', dependsOnId: 'radice' } }],
          ]);
        });

        it('una radice fallita non basta: senza tracce resta il 422', async () => {
          const { tx, update, create } = txCompleta(
            { ...evento, multitrackRecordingEnabled: true },
            { segno: true, tracce: 0 }
          );
          const t = tx as unknown as { postprodJob: { findUnique: ReturnType<typeof vi.fn> } };
          t.postprodJob.findUnique.mockResolvedValueOnce({ status: 'FAILED' });
          await expect(
            enqueuePostprodForRecording(tx, { recordingId: 'rec-1', multitrack: true })
          ).rejects.toMatchObject({ statusCode: 422, code: 'NO_TRANSCRIBABLE_TRACKS' });
          expect(update).not.toHaveBeenCalled();
          expect(create).not.toHaveBeenCalled();
        });

        describe('sul segnaposto del registratore', () => {
          const SEGNAPOSTO = 'recordings/multitrack/ev-1/';

          function txSegnaposto(mediaStartedAt: Date | null) {
            const { tx, update, create } = txCompleta(evento, { segno: true, tracce: 0 });
            const t = tx as unknown as { recording: { findUnique: ReturnType<typeof vi.fn> } };
            t.recording.findUnique.mockResolvedValueOnce({
              id: 'rec-1',
              blobKey: SEGNAPOSTO,
              runCount: 0,
              transcriptConsentRule: true,
              mediaStartedAt,
              event: evento,
            });
            return { tx, update, create };
          }

          it('senza manifest le tracce sono in arrivo: nessun errore, nessun lavoro', async () => {
            const { tx, update, create } = txSegnaposto(null);
            await expect(enqueuePostprodForRecording(tx, { recordingId: 'rec-1' })).resolves.toEqual({
              enqueued: 0,
              skippedExisting: 0,
              jobIds: [],
              tracksPending: true,
            });
            expect(update).not.toHaveBeenCalled();
            expect(create).not.toHaveBeenCalled();
          });

          it('con il manifest gia\' arrivato e le righe cancellate resta il 422', async () => {
            const { tx } = txSegnaposto(new Date());
            await expect(
              enqueuePostprodForRecording(tx, { recordingId: 'rec-1' })
            ).rejects.toMatchObject({ code: 'NO_TRANSCRIBABLE_TRACKS' });
          });

          it('il manifest non aspetta se stesso: salta e lo dice', async () => {
            const { tx } = txSegnaposto(null);
            await expect(
              enqueuePostprodForRecording(tx, {
                recordingId: 'rec-1',
                multitrack: true,
                seMancanoTracce: 'salta',
              })
            ).resolves.toMatchObject({ enqueued: 0, noTranscribableTracks: true });
          });
        });
      });

      it('AI spenta o pipeline in pausa: non serve nessuna conferma, non parte niente', async () => {
        const { tx } = txCompleta({ ...evento, aiTranscriptEnabled: false }, { segno: true });
        await expect(
          enqueuePostprodForRecording(tx, { recordingId: 'rec-1' })
        ).resolves.toEqual({ enqueued: 0, skippedExisting: 0, jobIds: [] });
      });
    });
  });
});

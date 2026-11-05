import type { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

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
    function txCompleta(event: Record<string, unknown>, tracce: { frase?: boolean } = {}) {
      const { tx } = txCon({ id: 'rec-1', blobKey: 'recordings/ev-1/a.mp4', runCount: 0, event });
      const t = tx as unknown as Record<string, unknown>;
      const update = vi.fn(async () => ({}));
      const create = vi.fn(async () => ({ id: `job-${create.mock.calls.length}` }));
      (t.recording as Record<string, unknown>).update = update;
      t.recordingTrack = { count: vi.fn(async () => 0), findFirst: vi.fn(async () => null) };
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
  });
});

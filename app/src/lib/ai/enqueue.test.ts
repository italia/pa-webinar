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
});

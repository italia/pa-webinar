// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
/**
 * La pagina di una registrazione calcola con le regole vere se serve la
 * conferma sulle voci: il segno si legge dalla riga in esame, non dall'evento.
 */
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  recording: vi.fn(),
  site: vi.fn(),
  frase: vi.fn(),
  prova: vi.fn(),
  traccia: vi.fn(),
  tracce: vi.fn(),
  registrazionePubblica: vi.fn(),
  puoGestire: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    recording: { findUnique: h.recording },
    siteSetting: { findUnique: h.site },
    captionSegment: { findFirst: h.frase },
    multitrackConsent: { findFirst: h.prova },
    recordingTrack: { findFirst: h.traccia, count: h.tracce },
  },
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('notFound');
  },
}));
vi.mock('next-intl/server', () => ({ getLocale: async () => 'it' }));
vi.mock('@/lib/auth/staff-page', () => ({
  staffOLogin: async () => ({ role: 'admin', accountId: null }),
}));
vi.mock('@/lib/auth/staff-session', () => ({ puoGestire: h.puoGestire }));
vi.mock('@/lib/captions/transcript', () => ({
  registrazionePubblica: h.registrazionePubblica,
}));
vi.mock('@/components/admin/access-denied', () => ({ default: () => null }));
vi.mock('@/components/admin/recording-manage-client', () => ({ default: () => null }));
vi.mock('@/components/admin/recording-tabs', () => ({
  recordingTabFrom: () => 'overview',
}));
vi.mock('@/components/admin/admin-page-title', () => ({ adminPageMetadata: vi.fn() }));

import RecordingManagePage from './page';

const ID = '11111111-2222-4333-8444-555555555555';

function riga(extra: Record<string, unknown> = {}, evento: Record<string, unknown> = {}) {
  return {
    id: ID,
    status: 'READY',
    durationSec: 60,
    sourceLanguage: 'it',
    createdAt: new Date('2026-11-05T10:00:00Z'),
    eventId: 'ev-1',
    blobKey: 'recordings/a.mp4',
    transcriptConsentRule: true,
    event: {
      title: { it: 'Evento' },
      slug: 'evento',
      multitrackRecordingEnabled: false,
      captionsTranscriptEnabled: false,
      liveCaptionsEnabled: true,
      aiTranscriptEnabled: true,
      ...evento,
    },
    ...extra,
  };
}

async function props() {
  const el = (await RecordingManagePage({
    params: Promise.resolve({ recordingId: ID }),
  })) as ReactElement<Record<string, unknown>>;
  return el.props;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.puoGestire.mockResolvedValue(true);
  h.site.mockResolvedValue({ liveCaptionsEnabled: true, aiPipelineEnabled: true });
  h.recording.mockResolvedValue(riga());
  h.frase.mockResolvedValue(null);
  h.prova.mockResolvedValue(null);
  h.traccia.mockResolvedValue(null);
  h.tracce.mockResolvedValue(0);
  h.registrazionePubblica.mockResolvedValue(null);
});

describe('la conferma sulle voci', () => {
  it('legge il segno dalla registrazione: lo chiede il select', async () => {
    await props();
    expect(h.recording.mock.calls[0]![0]).toMatchObject({
      select: { transcriptConsentRule: true },
    });
  });

  it('video nuovo con AI accesa: conferma e avviso', async () => {
    await expect(props()).resolves.toMatchObject({
      confermaVoci: true,
      avvisoConfermaVoci: true,
      restaDaiSottotitoli: false,
    });
  });

  it('video nato prima della regola: nessuna conferma', async () => {
    h.recording.mockResolvedValue(riga({ transcriptConsentRule: false }));
    await expect(props()).resolves.toMatchObject({
      confermaVoci: false,
      avvisoConfermaVoci: false,
      restaDaiSottotitoli: false,
    });
    expect(h.frase).toHaveBeenCalledTimes(1);
    expect(h.registrazionePubblica).not.toHaveBeenCalled();
  });

  it('AI spenta per l’evento o per il sito: la domanda resta, l’avviso no', async () => {
    h.recording.mockResolvedValue(riga({}, { aiTranscriptEnabled: false }));
    await expect(props()).resolves.toMatchObject({
      confermaVoci: true,
      avvisoConfermaVoci: false,
    });
    h.recording.mockResolvedValue(riga());
    h.site.mockResolvedValue({ aiPipelineEnabled: false });
    await expect(props()).resolves.toMatchObject({
      confermaVoci: true,
      avvisoConfermaVoci: false,
    });
  });

  it('tracce per persona: nessuna conferma, anche col segno', async () => {
    h.tracce.mockResolvedValue(2);
    await expect(props()).resolves.toMatchObject({ confermaVoci: false });
  });
});

describe('cosa resta senza la conferma', () => {
  it('le frasi dei sottotitoli salvate', async () => {
    h.frase.mockResolvedValue({ id: 'f' });
    await expect(props()).resolves.toMatchObject({ restaDaiSottotitoli: true });
  });

  it('le sole righe senza testo non diventano una trascrizione', async () => {
    // Come il database: le righe di chi non ha acconsentito non hanno ne' testo
    // ne' posto, quindi rispondono solo a chi non li chiede.
    h.frase.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
      where.text || where.seatId ? null : { id: 'f' }
    );
    await expect(props()).resolves.toMatchObject({
      confermaVoci: true,
      restaDaiSottotitoli: false,
    });
    expect(h.frase).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { eventId: 'ev-1', text: { not: null }, seatId: { not: null } },
      })
    );
  });

  it('il testo gia’ ricavato, anche se le frasi non ci sono piu’', async () => {
    h.registrazionePubblica.mockResolvedValue('rec-sottotitoli');
    await expect(props()).resolves.toMatchObject({ restaDaiSottotitoli: true });
    expect(h.registrazionePubblica).toHaveBeenCalledWith('ev-1', true);
  });
});

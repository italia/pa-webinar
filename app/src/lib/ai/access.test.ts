import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSite, mockEvent } = vi.hoisted(() => ({
  mockSite: vi.fn(),
  mockEvent: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    siteSetting: { findUnique: mockSite },
    event: { findUnique: mockEvent },
  },
}));

import { assertPostprodAccessible } from './access';

const base = {
  id: 'ev-1',
  recordingPublished: false,
  transcriptPublished: false,
  postEventPublic: true,
  postEventPublicUntil: null as Date | null,
  captionsTranscriptEnabled: false,
};

describe('assertPostprodAccessible', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSite.mockResolvedValue({ aiPipelineEnabled: true });
  });

  it('apre tutto con il video pubblicato', async () => {
    mockEvent.mockResolvedValue({ ...base, recordingPublished: true });
    await expect(assertPostprodAccessible('s')).resolves.toEqual({
      eventId: 'ev-1',
      ambito: 'tutto',
      soloSottotitoli: false,
    });
  });

  it('con la sola trascrizione pubblicata apre solo la trascrizione', async () => {
    mockEvent.mockResolvedValue({ ...base, transcriptPublished: true });
    await expect(assertPostprodAccessible('s')).resolves.toEqual({
      eventId: 'ev-1',
      ambito: 'trascrizione',
      soloSottotitoli: false,
    });
  });

  it('resta chiuso se non sono pubblicati né il video né la trascrizione', async () => {
    mockEvent.mockResolvedValue({ ...base });
    await expect(assertPostprodAccessible('s')).rejects.toThrow();
  });

  it("resta chiuso con la pagina dopo l'evento ritirata", async () => {
    mockEvent.mockResolvedValue({ ...base, transcriptPublished: true, postEventPublic: false });
    await expect(assertPostprodAccessible('s')).rejects.toThrow();
  });

  it('con la pipeline AI spenta apre solo la trascrizione dai sottotitoli', async () => {
    mockSite.mockResolvedValue({ aiPipelineEnabled: false });
    mockEvent.mockResolvedValue({ ...base, transcriptPublished: true });
    await expect(assertPostprodAccessible('s')).rejects.toThrow();
    // Anche con il video pubblicato: niente prodotti dell'AI.
    mockEvent.mockResolvedValue({ ...base, recordingPublished: true, captionsTranscriptEnabled: true });
    await expect(assertPostprodAccessible('s')).resolves.toEqual({
      eventId: 'ev-1',
      ambito: 'trascrizione',
      soloSottotitoli: true,
    });
  });
});

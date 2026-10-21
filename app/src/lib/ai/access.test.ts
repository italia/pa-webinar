import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSite, mockEvent, mockManager, mockRegCount, cookieJar } = vi.hoisted(() => ({
  mockSite: vi.fn(),
  mockEvent: vi.fn(),
  mockManager: vi.fn(),
  mockRegCount: vi.fn(),
  cookieJar: new Map<string, string>(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    siteSetting: { findUnique: mockSite },
    event: { findUnique: mockEvent },
    registration: { count: mockRegCount },
  },
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
  }),
}));
vi.mock('@/lib/auth/staff-session', () => ({ isEventManager: mockManager }));
vi.mock('@/lib/auth/app-secret', () => ({ tryGetAppSecret: () => 'segreto-di-prova-abbastanza-lungo-per-hmac' }));

import { issueViewingToken, viewingCookieName } from '@/lib/recording/viewing';

import { assertPostprodAccessible } from './access';

const base = {
  id: 'ev-1',
  recordingPublished: false,
  transcriptPublished: false,
  postEventPublic: true,
  postEventPublicUntil: null as Date | null,
  captionsTranscriptEnabled: false,
  recordingAudience: 'PUBLIC' as 'PUBLIC' | 'REGISTRANTS',
};

describe('assertPostprodAccessible', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSite.mockResolvedValue({ aiPipelineEnabled: true });
    mockManager.mockResolvedValue(false);
    mockRegCount.mockResolvedValue(0);
    cookieJar.clear();
  });

  it('lo staff che gestisce l\'evento vede tutto anche prima della pubblicazione', async () => {
    mockEvent.mockResolvedValue({ ...base });
    mockManager.mockResolvedValue(true);
    await expect(assertPostprodAccessible('s')).resolves.toMatchObject({ ambito: 'tutto' });
  });

  it('riservata agli iscritti: chiusa a chi non prova l\'iscrizione', async () => {
    mockEvent.mockResolvedValue({ ...base, recordingPublished: true, recordingAudience: 'REGISTRANTS' });
    await expect(assertPostprodAccessible('s')).rejects.toThrow();
  });

  it('riservata agli iscritti: aperta col cookie della visione di un\'iscrizione esistente', async () => {
    mockEvent.mockResolvedValue({ ...base, recordingPublished: true, recordingAudience: 'REGISTRANTS' });
    cookieJar.set(viewingCookieName('ev-1'), issueViewingToken('ev-1', 'reg-1')!);
    mockRegCount.mockResolvedValue(1);
    await expect(assertPostprodAccessible('s')).resolves.toMatchObject({ ambito: 'tutto' });
    expect(mockRegCount).toHaveBeenCalledWith({ where: { id: 'reg-1', eventId: 'ev-1' } });
  });

  it('riservata agli iscritti: un\'iscrizione cancellata non apre piu\'', async () => {
    mockEvent.mockResolvedValue({ ...base, recordingPublished: true, recordingAudience: 'REGISTRANTS' });
    cookieJar.set(viewingCookieName('ev-1'), issueViewingToken('ev-1', 'reg-1')!);
    await expect(assertPostprodAccessible('s')).rejects.toThrow();
  });

  it('riservata agli iscritti: il token di un altro evento non vale', async () => {
    mockEvent.mockResolvedValue({ ...base, recordingPublished: true, recordingAudience: 'REGISTRANTS' });
    cookieJar.set(viewingCookieName('ev-1'), issueViewingToken('ev-2', 'reg-1')!);
    mockRegCount.mockResolvedValue(1);
    await expect(assertPostprodAccessible('s')).rejects.toThrow();
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

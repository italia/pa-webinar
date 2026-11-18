// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

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
// Lo staff che vede il contenuto: chi organizza l'evento (lib/recording/content-access).
const tracciate = vi.hoisted(() => vi.fn());
vi.mock('@/lib/recording/content-access', () => ({
  contenutoStaffDellaRichiesta: async () =>
    (await mockManager()) ? { session: { role: 'organizer', accountId: 'a' }, via: 'organizzatore' } : null,
  tracciaLetturaContenuto: tracciate,
}));
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
  recordingDestination: null as 'PUBLIC' | 'REGISTRANTS' | null,
};

describe('assertPostprodAccessible', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSite.mockResolvedValue({ aiPipelineEnabled: true });
    mockManager.mockResolvedValue(false);
    mockRegCount.mockResolvedValue(0);
    cookieJar.clear();
  });

  it('lo staff che organizza l\'evento vede tutto anche prima della pubblicazione, e la lettura si traccia', async () => {
    mockEvent.mockResolvedValue({ ...base });
    mockManager.mockResolvedValue(true);
    await expect(assertPostprodAccessible('s', 'sintesi')).resolves.toMatchObject({ ambito: 'tutto' });
    expect(tracciate).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'ev-1', superficie: 'sintesi', via: 'organizzatore' })
    );
  });

  it('chi non organizza (l\'admin dell\'istanza) non vede una registrazione non pubblicata', async () => {
    mockEvent.mockResolvedValue({ ...base });
    await expect(assertPostprodAccessible('s')).rejects.toMatchObject({ statusCode: 404 });
    expect(tracciate).not.toHaveBeenCalled();
  });

  it('chiamata rapida: chi era in sala (pass di presenza) vede la trascrizione senza pubblicazione', async () => {
    const { issuePresencePass, presencePassCookieName } = await import('@/lib/recording/presence-pass');
    mockEvent.mockResolvedValue({ ...base, postEventPublic: false });
    cookieJar.set(presencePassCookieName('ev-1'), issuePresencePass('ev-1', new Date(Date.now() + 86_400_000))!);
    await expect(assertPostprodAccessible('s')).resolves.toMatchObject({ ambito: 'tutto' });
    expect(tracciate).not.toHaveBeenCalled();
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

  it('riservata con la pagina privata: l\'iscritto apre la trascrizione, se l\'evento ha una destinazione', async () => {
    const privata = {
      ...base,
      recordingPublished: true,
      recordingAudience: 'REGISTRANTS' as const,
      postEventPublic: false,
    };
    cookieJar.set(viewingCookieName('ev-1'), issueViewingToken('ev-1', 'reg-1')!);
    mockRegCount.mockResolvedValue(1);

    mockEvent.mockResolvedValue({ ...privata, recordingDestination: 'REGISTRANTS' });
    await expect(assertPostprodAccessible('s')).resolves.toMatchObject({ ambito: 'tutto' });

    mockEvent.mockResolvedValue(privata);
    await expect(assertPostprodAccessible('s')).rejects.toThrow();
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

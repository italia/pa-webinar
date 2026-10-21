import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockManager, mockRegCount, mockEventAccess } = vi.hoisted(() => ({
  mockManager: vi.fn(),
  mockRegCount: vi.fn(),
  mockEventAccess: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: { registration: { count: mockRegCount } } }));
vi.mock('@/lib/auth/staff-session', () => ({ isEventManager: mockManager }));
vi.mock('@/lib/auth/app-secret', () => ({
  tryGetAppSecret: () => 'segreto-di-prova-abbastanza-lungo-per-hmac',
}));
vi.mock('@/lib/event-session', () => ({
  eventAccessCookieName: (id: string) => `event_access_${id}`,
  verifyEventAccess: mockEventAccess,
}));

import { accessoRegistrazione, pubblicazioneAperta } from './audience';
import { issueViewingToken, viewingCookieName } from './viewing';

type Cookies = Parameters<typeof accessoRegistrazione>[1];
const barattolo = (valori: Record<string, string> = {}) =>
  ({
    get: (nome: string) =>
      nome in valori ? { name: nome, value: valori[nome]! } : undefined,
  }) as unknown as Cookies;

const NOW = new Date('2026-10-21T15:00:00Z');
const evento = (over: Record<string, unknown> = {}) => ({
  id: 'ev-1',
  recordingPublished: true,
  transcriptPublished: false,
  recordingAudience: 'PUBLIC' as 'PUBLIC' | 'REGISTRANTS',
  postEventPublic: true,
  postEventPublicUntil: null as Date | null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockManager.mockResolvedValue(false);
  mockRegCount.mockResolvedValue(0);
  mockEventAccess.mockResolvedValue(null);
});

describe('pubblicazioneAperta', () => {
  it('pubblicata nella finestra post-evento', () => {
    expect(pubblicazioneAperta(evento(), NOW)).toBe(true);
    expect(
      pubblicazioneAperta(
        evento({ recordingPublished: false, transcriptPublished: true }),
        NOW
      )
    ).toBe(true);
  });
  it("chiusa se non pubblicata, se la pagina post-evento e' ritirata o la finestra e' passata", () => {
    expect(pubblicazioneAperta(evento({ recordingPublished: false }), NOW)).toBe(false);
    expect(pubblicazioneAperta(evento({ postEventPublic: false }), NOW)).toBe(false);
    expect(
      pubblicazioneAperta(
        evento({ postEventPublicUntil: new Date('2026-10-20T00:00:00Z') }),
        NOW
      )
    ).toBe(false);
  });
});

describe('accessoRegistrazione', () => {
  it('per tutti: chiunque, senza leggere la sessione', async () => {
    expect(await accessoRegistrazione(evento(), barattolo(), NOW)).toBe('pubblico');
    expect(mockManager).not.toHaveBeenCalled();
  });

  it("lo staff che gestisce l'evento vede anche prima della pubblicazione", async () => {
    mockManager.mockResolvedValue(true);
    expect(
      await accessoRegistrazione(evento({ recordingPublished: false }), barattolo(), NOW)
    ).toBe('staff');
  });

  it('non pubblicata: nessun altro', async () => {
    expect(
      await accessoRegistrazione(evento({ recordingPublished: false }), barattolo(), NOW)
    ).toBeNull();
  });

  it("solo iscritti: chi ha il cookie della visione di un'iscrizione esistente", async () => {
    mockRegCount.mockResolvedValue(1);
    const cookie = { [viewingCookieName('ev-1')]: issueViewingToken('ev-1', 'reg-1')! };
    expect(
      await accessoRegistrazione(
        evento({ recordingAudience: 'REGISTRANTS' }),
        barattolo(cookie),
        NOW
      )
    ).toBe('iscritto');
    expect(mockRegCount).toHaveBeenCalledWith({
      where: { id: 'reg-1', eventId: 'ev-1' },
    });
  });

  it("solo iscritti: chi ha il cookie d'accesso dell'evento, anche senza essere entrato in sala", async () => {
    mockEventAccess.mockResolvedValue('tok-1');
    mockRegCount.mockResolvedValue(1);
    expect(
      await accessoRegistrazione(
        evento({ recordingAudience: 'REGISTRANTS' }),
        barattolo({ event_access_ev_1: 'x' }),
        NOW
      )
    ).toBe('iscritto');
    expect(mockRegCount).toHaveBeenCalledWith({
      where: { accessToken: 'tok-1', eventId: 'ev-1' },
    });
  });

  it("solo iscritti: senza prova, o con un'iscrizione cancellata, niente", async () => {
    expect(
      await accessoRegistrazione(
        evento({ recordingAudience: 'REGISTRANTS' }),
        barattolo(),
        NOW
      )
    ).toBeNull();
    const cookie = { [viewingCookieName('ev-1')]: issueViewingToken('ev-1', 'reg-1')! };
    expect(
      await accessoRegistrazione(
        evento({ recordingAudience: 'REGISTRANTS' }),
        barattolo(cookie),
        NOW
      )
    ).toBeNull();
  });

  it('solo iscritti: un token manomesso o di un altro evento non vale', async () => {
    mockRegCount.mockResolvedValue(1);
    const altro = { [viewingCookieName('ev-1')]: issueViewingToken('ev-2', 'reg-1')! };
    const manomesso = {
      [viewingCookieName('ev-1')]: `${issueViewingToken('ev-1', 'reg-1')!}x`,
    };
    expect(
      await accessoRegistrazione(
        evento({ recordingAudience: 'REGISTRANTS' }),
        barattolo(altro),
        NOW
      )
    ).toBeNull();
    expect(
      await accessoRegistrazione(
        evento({ recordingAudience: 'REGISTRANTS' }),
        barattolo(manomesso),
        NOW
      )
    ).toBeNull();
  });

  it('finestra post-evento chiusa: anche gli iscritti restano fuori, lo staff no', async () => {
    mockRegCount.mockResolvedValue(1);
    const cookie = { [viewingCookieName('ev-1')]: issueViewingToken('ev-1', 'reg-1')! };
    const chiuso = evento({ recordingAudience: 'REGISTRANTS', postEventPublic: false });
    expect(await accessoRegistrazione(chiuso, barattolo(cookie), NOW)).toBeNull();
    mockManager.mockResolvedValue(true);
    expect(await accessoRegistrazione(chiuso, barattolo(cookie), NOW)).toBe('staff');
  });
});

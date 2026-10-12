// @vitest-environment node
/**
 * GET /api/admin/events/[id]/closing — gli stati di «Chiudi l'evento».
 *
 * Li vede chi modera l'evento, con il proprio token (prima di tutto), oppure
 * lo staff che gestisce l'evento: come il resto della scheda «Dopo l'evento».
 */

import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));
vi.mock('@/lib/auth/staff-session', () => ({
  requireEventManager: vi.fn(async () => ({ role: 'admin', accountId: null })),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    eventModerator: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/events/closing', async (importOriginal) => ({
  ...(await importOriginal<typeof ClosingModule>()),
  caricaDatiChiusura: vi.fn(),
}));

import type * as ClosingModule from '@/lib/events/closing';
import { requireEventManager } from '@/lib/auth/staff-session';
import { prisma } from '@/lib/db';
import { ForbiddenError } from '@/lib/errors';
import { caricaDatiChiusura, type DatiChiusura } from '@/lib/events/closing';

import { GET } from './route';

const mockedManager = vi.mocked(requireEventManager);
const mockedDati = vi.mocked(caricaDatiChiusura);
const mockedEvent = prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedGrant = prisma.eventModerator.findUnique as unknown as ReturnType<
  typeof vi.fn
>;

const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'TOKEN_MODERATORE_PRINCIPALE';

const DATI: DatiChiusura = {
  status: 'ENDED',
  eventType: 'SCHEDULED',
  endsAt: new Date(Date.now() - 3_600_000),
  fineEffettiva: null,
  dataRetentionDays: 30,
  recordingEnabled: true,
  recordingUrl: 'https://x/v.mp4',
  recordingPublished: false,
  youtubeUrl: null,
  transcriptPublished: false,
  captionsTranscriptEnabled: false,
  trascrizione: null,
  trascrizioneInLavorazione: false,
  pipelineAi: false,
  resocontoGenerato: false,
  resocontoPubblicato: false,
  resocontoInLavorazione: false,
  messaggi: 0,
  domande: 0,
  sondaggi: 0,
  nuvole: 0,
  materialiDopo: 1,
  postEventShowMaterials: true,
  feedbackEnabled: false,
  emailValutazioni: false,
  emailValutazioniInviataIl: null,
  valutazioni: 0,
  postEventPublic: true,
  postEventPublicUntil: null,
  libraryListed: false,
};

function chiama(
  id = EVENT_ID,
  token?: string
): [NextRequest, { params: Promise<{ id: string }> }] {
  return [
    new Request(`https://webinar.example.gov.it/api/admin/events/${id}/closing`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }) as unknown as NextRequest,
    { params: Promise.resolve({ id }) },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedManager.mockResolvedValue({ role: 'admin', accountId: null } as Awaited<
    ReturnType<typeof requireEventManager>
  >);
  mockedDati.mockResolvedValue(DATI);
  mockedEvent.mockResolvedValue({ id: EVENT_ID, moderatorToken: TOKEN });
  mockedGrant.mockResolvedValue(null);
});

describe('GET /api/admin/events/[id]/closing', () => {
  it('un identificativo che non e’ un UUID: 400', async () => {
    const res = await GET(...chiama('non-un-uuid'));
    expect(res.status).toBe(400);
    expect(mockedDati).not.toHaveBeenCalled();
  });

  it('lo staff che gestisce l’evento: gli stati, non in cache', async () => {
    const res = await GET(...chiama());
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const corpo = (await res.json()) as {
      voci: { voce: string; stato: string }[];
      daFare: number;
    };
    expect(corpo.voci.find((v) => v.voce === 'registrazione')?.stato).toBe('da-fare');
    expect(corpo.daFare).toBe(1);
  });

  it('il moderatore col suo token: ammesso senza chiedere la sessione', async () => {
    const res = await GET(...chiama(EVENT_ID, TOKEN));
    expect(res.status).toBe(200);
    expect(mockedManager).not.toHaveBeenCalled();
  });

  it('con il solo link del moderatore il resoconto non e’ «da fare»: lo fa lo staff', async () => {
    mockedDati.mockResolvedValue({ ...DATI, pipelineAi: true });
    const res = await GET(...chiama(EVENT_ID, TOKEN));
    const corpo = (await res.json()) as { voci: { voce: string; caso: string }[] };
    expect(corpo.voci.find((v) => v.voce === 'resoconto')?.caso).toBe('soloStaff');
  });

  it('staff che non gestisce l’evento e token sbagliato: decide la sessione, 403', async () => {
    mockedManager.mockRejectedValue(new ForbiddenError('no'));
    const res = await GET(...chiama(EVENT_ID, 'ALTRO'));
    expect(res.status).toBe(403);
    expect(mockedDati).not.toHaveBeenCalled();
  });

  it('evento sparito: 404', async () => {
    mockedDati.mockResolvedValue(null);
    const res = await GET(...chiama());
    expect(res.status).toBe(404);
  });
});

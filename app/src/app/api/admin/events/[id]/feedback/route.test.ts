// @vitest-environment node
/**
 * GET /api/admin/events/[id]/feedback — le valutazioni dell'evento per la sua
 * pagina in amministrazione.
 *
 * Chi le vede: chi modera l'evento, con il proprio token in
 * `Authorization: Bearer` (prima di tutto: puo' avere anche una sessione dello
 * staff che quell'evento non lo gestisce), oppure lo staff che gestisce
 * l'evento. Un token di relatore, revocato o di un altro evento non apre
 * niente da solo: decide la sessione. Con `?format=csv` le stesse risposte
 * arrivano come file CSV da scaricare.
 */

import type { NextRequest } from 'next/server';
import { getTranslations } from 'next-intl/server';
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
// Le parole si'/no del CSV vengono dai messaggi del pannello, nella lingua
// del file: qui quelli veri di italiano e inglese.
vi.mock('next-intl/server', async () => {
  const it = (await import('@/i18n/messages/it.json')).default;
  const en = (await import('@/i18n/messages/en.json')).default;
  const tutte: Record<string, typeof it> = { it, en };
  return {
    getTranslations: vi.fn(async ({ locale }: { locale: string; namespace: string }) => {
      const pannello = tutte[locale]!.admin.feedbackPanel;
      return (key: keyof typeof pannello) => pannello[key];
    }),
  };
});
vi.mock('@/lib/feedback/event-feedback-report', async (importOriginal) => ({
  // Il CSV resta quello vero: la rotta ne decide solo involucro e intestazioni.
  ...(await importOriginal<typeof ReportModule>()),
  buildEventFeedbackReport: vi.fn(),
}));

import type * as ReportModule from '@/lib/feedback/event-feedback-report';
import { requireEventManager } from '@/lib/auth/staff-session';
import { prisma } from '@/lib/db';
import { ForbiddenError, UnauthorizedError } from '@/lib/errors';
import { buildEventFeedbackReport, type EventFeedbackReport } from '@/lib/feedback/event-feedback-report';

import { GET } from './route';

const mockedManager = vi.mocked(requireEventManager);
const mockedReport = vi.mocked(buildEventFeedbackReport);
const mockedEvent = prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedGrant = prisma.eventModerator.findUnique as unknown as ReturnType<typeof vi.fn>;

const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const ALTRO_EVENTO = '99999999-9999-4999-8999-999999999999';
const PRIMARY_TOKEN = 'TOKEN_MODERATORE_PRINCIPALE';

const REPORT: EventFeedbackReport = {
  enabled: true,
  questionnaire: { id: 'q-1', title: { it: 'Il tuo feedback' } },
  items: [
    {
      id: 'voto',
      type: 'LIKERT',
      prompt: { it: 'Voto complessivo', en: 'Overall rating' },
      options: null,
      scaleMin: 1,
      scaleMax: 5,
      scaleMinLabel: null,
      scaleMaxLabel: null,
      answered: 1,
      average: 4,
      distribution: [0, 0, 0, 1, 0],
    },
    {
      id: 'consiglio',
      type: 'YES_NO',
      prompt: { it: 'Lo consiglieresti?', en: 'Would you recommend it?' },
      options: null,
      scaleMin: null,
      scaleMax: null,
      scaleMinLabel: null,
      scaleMaxLabel: null,
      answered: 1,
      average: 1,
      distribution: [0, 1],
    },
    {
      id: 'commento',
      type: 'OPEN_TEXT',
      prompt: { it: 'Commento', en: 'Comment' },
      options: null,
      scaleMin: null,
      scaleMax: null,
      scaleMinLabel: null,
      scaleMaxLabel: null,
      answered: 1,
      average: null,
      distribution: null,
    },
  ],
  responses: [
    {
      id: 'r1',
      submittedAt: '2026-10-01T10:00:00.000Z',
      kind: 'guest',
      answers: { voto: { scale: 4 }, consiglio: { scale: 1 }, commento: { text: 'Molto utile' } },
    },
  ],
  legacy: { count: 0, average: null, entries: [] },
};

function get(
  query = '',
  { id = EVENT_ID, token }: { id?: string; token?: string } = {},
): [NextRequest, { params: Promise<{ id: string }> }] {
  return [
    new Request(`https://webinar.example.gov.it/api/admin/events/${id}/feedback${query}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }) as unknown as NextRequest,
    { params: Promise.resolve({ id }) },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedManager.mockResolvedValue({ role: 'admin', accountId: null });
  mockedReport.mockResolvedValue(REPORT);
  mockedEvent.mockResolvedValue({ id: EVENT_ID, moderatorToken: PRIMARY_TOKEN });
  mockedGrant.mockResolvedValue(null);
});

describe('GET /api/admin/events/[id]/feedback — chi vede le valutazioni', () => {
  it('un identificativo che non e’ un UUID: 400, prima di ogni controllo', async () => {
    const res = await GET(...get('', { id: 'evento-di-prova', token: PRIMARY_TOKEN }));
    expect(res.status).toBe(400);
    expect(mockedEvent).not.toHaveBeenCalled();
    expect(mockedManager).not.toHaveBeenCalled();
    expect(mockedReport).not.toHaveBeenCalled();
  });

  it('lo staff che gestisce l’evento: il rapporto in JSON, non in cache', async () => {
    mockedManager.mockResolvedValue({ role: 'organizer', accountId: 'org-1' });

    const res = await GET(...get());

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(mockedManager).toHaveBeenCalledWith(expect.anything(), EVENT_ID);
    // Senza token l'evento non si legge per il controllo del moderatore.
    expect(mockedEvent).not.toHaveBeenCalled();
    expect(mockedReport).toHaveBeenCalledWith(EVENT_ID);
    expect(await res.json()).toEqual(REPORT);
  });

  it('lo staff che non gestisce l’evento, senza token: 403, nessun rapporto', async () => {
    mockedManager.mockRejectedValue(new ForbiddenError());

    const res = await GET(...get());
    expect(res.status).toBe(403);
    expect(mockedReport).not.toHaveBeenCalled();
  });

  it('nessuna sessione e nessun token: 401', async () => {
    mockedManager.mockRejectedValue(new UnauthorizedError());

    const res = await GET(...get());
    expect(res.status).toBe(401);
    expect(mockedReport).not.toHaveBeenCalled();
  });

  it('il moderatore principale, col suo token: ammesso senza chiedere la sessione', async () => {
    const res = await GET(...get('', { token: PRIMARY_TOKEN }));

    expect(res.status).toBe(200);
    expect(mockedEvent).toHaveBeenCalledWith({
      where: { id: EVENT_ID },
      select: { id: true, moderatorToken: true },
    });
    expect(mockedManager).not.toHaveBeenCalled();
    expect(mockedReport).toHaveBeenCalledWith(EVENT_ID);
  });

  it('chi organizza un altro evento e ne ha il link del moderatore: ammesso dal token', async () => {
    // La sua sessione non gestisce questo evento: se decidesse lei, 403.
    mockedManager.mockRejectedValue(new ForbiddenError());

    const res = await GET(...get('', { token: PRIMARY_TOKEN }));

    expect(res.status).toBe(200);
    expect(mockedManager).not.toHaveBeenCalled();
  });

  it('il token anche come ?token= (atterraggio dal link)', async () => {
    const res = await GET(...get(`?token=${PRIMARY_TOKEN}`));
    expect(res.status).toBe(200);
    expect(mockedManager).not.toHaveBeenCalled();
  });

  it('un co-moderatore di questo evento, non revocato: ammesso', async () => {
    mockedGrant.mockResolvedValue({
      eventId: EVENT_ID,
      revokedAt: null,
      role: 'MODERATOR',
    });

    const res = await GET(...get('', { token: 'TOKEN_COMODERATORE' }));
    expect(res.status).toBe(200);
    expect(mockedManager).not.toHaveBeenCalled();
  });

  const TOKEN_CHE_NON_BASTANO = [
    ['un relatore', { eventId: EVENT_ID, revokedAt: null, role: 'SPEAKER' }],
    ['un co-moderatore revocato', { eventId: EVENT_ID, revokedAt: new Date(), role: 'MODERATOR' }],
    ['il co-moderatore di un altro evento', { eventId: ALTRO_EVENTO, revokedAt: null, role: 'MODERATOR' }],
    ['un token che non esiste', null],
  ] as const;

  it.each(TOKEN_CHE_NON_BASTANO)('%s, senza sessione: 401, nessun rapporto', async (_chi, grant) => {
    mockedGrant.mockResolvedValue(grant);
    mockedManager.mockRejectedValue(new UnauthorizedError());

    const res = await GET(...get('', { token: 'TOKEN_QUALUNQUE' }));
    expect(res.status).toBe(401);
    expect(mockedManager).toHaveBeenCalledWith(expect.anything(), EVENT_ID);
    expect(mockedReport).not.toHaveBeenCalled();
  });

  it.each(TOKEN_CHE_NON_BASTANO)(
    '%s, con una sessione che non gestisce l’evento: 403',
    async (_chi, grant) => {
      mockedGrant.mockResolvedValue(grant);
      mockedManager.mockRejectedValue(new ForbiddenError());

      const res = await GET(...get('', { token: 'TOKEN_QUALUNQUE' }));
      expect(res.status).toBe(403);
      expect(mockedReport).not.toHaveBeenCalled();
    },
  );

  it('un token che non basta, con lo staff che gestisce l’evento: decide la sessione', async () => {
    mockedGrant.mockResolvedValue({ eventId: EVENT_ID, revokedAt: null, role: 'SPEAKER' });

    const res = await GET(...get('', { token: 'TOKEN_RELATORE' }));
    expect(res.status).toBe(200);
    expect(mockedManager).toHaveBeenCalledWith(expect.anything(), EVENT_ID);
  });

  it('un token per un evento che non esiste: decide la sessione, che risponde 403', async () => {
    mockedEvent.mockResolvedValue(null);
    mockedManager.mockRejectedValue(new ForbiddenError());

    const res = await GET(...get('', { token: PRIMARY_TOKEN }));
    expect(res.status).toBe(403);
    expect(mockedReport).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/events/[id]/feedback?format=csv — il file da scaricare', () => {
  it('text/csv con BOM, come allegato, con domande e si’/no nella lingua chiesta', async () => {
    const res = await GET(...get('?format=csv&locale=en'));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toBe(
      `attachment; filename="valutazioni-${EVENT_ID.slice(0, 8)}.csv"`,
    );
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(getTranslations).toHaveBeenCalledWith({ locale: 'en', namespace: 'admin.feedbackPanel' });

    // Il BOM serve ai fogli di calcolo per leggere l'UTF-8: si controllano i
    // byte, perche' text() lo toglierebbe.
    const byte = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(byte.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    const testo = new TextDecoder('utf-8', { ignoreBOM: true }).decode(byte);
    expect(testo).toBe(
      '\uFEFFsubmitted_at;respondent;Overall rating;Would you recommend it?;Comment\r\n' +
        '2026-10-01T10:00:00.000Z;guest;4;Yes;Molto utile\r\n',
    );
  });

  it('senza lingua: l’italiano', async () => {
    const res = await GET(...get('?format=csv'));
    const righe = (await res.text()).split('\r\n');
    expect(righe[0]).toBe('submitted_at;respondent;Voto complessivo;Lo consiglieresti?;Commento');
    expect(righe[1]).toBe('2026-10-01T10:00:00.000Z;guest;4;Sì;Molto utile');
  });

  it.each(['xx', 'it;DROP', ''])('una lingua che non esiste («%s»): l’italiano', async (locale) => {
    const res = await GET(...get(`?format=csv&locale=${encodeURIComponent(locale)}`));
    expect(res.status).toBe(200);
    expect(getTranslations).toHaveBeenCalledWith({ locale: 'it', namespace: 'admin.feedbackPanel' });
    expect((await res.text()).split('\r\n')[0]).toContain('Voto complessivo');
  });

  it('anche chi modera, col suo token, scarica il CSV', async () => {
    const res = await GET(...get('?format=csv&locale=it', { token: PRIMARY_TOKEN }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(mockedManager).not.toHaveBeenCalled();
  });

  it('senza diritti, nessun CSV', async () => {
    mockedManager.mockRejectedValue(new UnauthorizedError());
    const res = await GET(...get('?format=csv', { token: 'TOKEN_SBAGLIATO' }));
    expect(res.status).toBe(401);
    expect(res.headers.get('Content-Type')).not.toContain('text/csv');
    expect(mockedReport).not.toHaveBeenCalled();
  });
});

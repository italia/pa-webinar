// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ accoda: vi.fn(), evento: vi.fn(), aggiorna: vi.fn(), audit: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock('@/lib/auth/staff-session', () => ({ requireEventManager: vi.fn(async () => ({ role: 'admin' })) }));
vi.mock('@/lib/audit/admin-audit', () => ({ logAdminAction: m.audit }));
vi.mock('@/lib/captions/transcript', () => ({ conservazioneFinita: () => false, registrazionePubblica: vi.fn() }));
vi.mock('@/lib/report/enqueue', async (orig) => ({
  ...(await orig<typeof import('@/lib/report/enqueue')>()),
  accodaResoconto: m.accoda,
  ultimoLavoroResoconto: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ prisma: { event: { findUnique: m.evento, update: m.aggiorna } } }));

import { POST, PUT } from './route';

const ID = '11111111-2222-4333-8444-555555555555';
const chiama = (fn: typeof POST, body: unknown, metodo = 'POST') =>
  fn(
    new Request(`http://x/api/admin/events/${ID}/report`, {
      method: metodo,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ id: ID }) } as never,
  );

beforeEach(() => vi.clearAllMocks());

describe('POST /api/admin/events/[id]/report', () => {
  it('accoda e lascia traccia', async () => {
    m.accoda.mockResolvedValue({ stato: 'accodato', jobId: 'job-1' });
    const res = await chiama(POST, { targetLanguages: ['EN'] });
    expect(res.status).toBe(202);
    expect(m.accoda).toHaveBeenCalledWith(ID, { targetLanguages: ['en'] });
    expect(m.audit.mock.calls[0]![0]).toMatchObject({ action: 'EVENT_REPORT_REQUESTED', target: ID });
  });

  it('dice perche\' non si puo\'', async () => {
    for (const stato of ['non-concluso', 'scaduto', 'ai-spenta']) {
      m.accoda.mockResolvedValueOnce({ stato });
      expect((await chiama(POST, {})).status).toBe(409);
    }
    m.accoda.mockResolvedValueOnce({ stato: 'in-corso', jobId: 'job-0' });
    expect((await chiama(POST, {})).status).toBe(200);
    expect(m.audit).not.toHaveBeenCalled();
  });
});

describe('PUT /api/admin/events/[id]/report', () => {
  it('non pubblica un resoconto che non c\'e\'', async () => {
    m.evento.mockResolvedValue({ postEventReport: null });
    expect((await chiama(PUT as never, { published: true }, 'PUT')).status).toBe(409);
    expect(m.aggiorna).not.toHaveBeenCalled();
  });

  it('pubblica e ritira', async () => {
    m.evento.mockResolvedValue({
      postEventReport: { version: 1, sourceLanguage: 'it', narratives: { it: {} } },
    });
    expect((await chiama(PUT as never, { published: true }, 'PUT')).status).toBe(200);
    expect(m.aggiorna).toHaveBeenCalledWith({ where: { id: ID }, data: { postEventReportPublished: true } });
    expect((await chiama(PUT as never, { published: false }, 'PUT')).status).toBe(200);
    expect(m.audit.mock.calls.map((c) => c[0].action)).toEqual(['EVENT_REPORT_PUBLISHED', 'EVENT_REPORT_WITHDRAWN']);
  });
});

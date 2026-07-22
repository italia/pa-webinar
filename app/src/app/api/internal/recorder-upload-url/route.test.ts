import type { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Questa rotta non restituisce dati: restituisce un PERMESSO DI SCRITTURA su
// storage condiviso. Quindi mockiamo solo il DB e il presign, e l'asserzione
// che conta in ogni test negativo è sempre la stessa — `presignArtifactUpload`
// NON deve essere chiamato: nessun URL firmato è stato emesso.
vi.mock('@/lib/db', () => ({
  prisma: { recording: { findUnique: vi.fn() } },
}));
vi.mock('@/lib/storage/postprod', () => ({
  presignArtifactUpload: vi.fn(),
}));

import { prisma } from '@/lib/db';
import { MULTITRACK_PREFIX } from '@/lib/recorder/lifecycle';
import { presignArtifactUpload } from '@/lib/storage/postprod';

import { POST } from './route';

const API_KEY = 'cron-key-di-test';
const EVENT_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const RECORDING_ID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const OTHER_EVENT_ID = 'cccccccc-3333-4333-8333-cccccccccccc';
const OTHER_RECORDING_ID = 'dddddddd-4444-4444-8444-dddddddddddd';

/** Cartella della registrazione: l'unico posto in cui il recorder può scrivere. */
const PREFIX = `${MULTITRACK_PREFIX}${EVENT_ID}/${RECORDING_ID}/`;
const SIGNED_URL = 'https://storage.example/blob?sig=abc';

const findUnique = prisma.recording.findUnique as unknown as ReturnType<typeof vi.fn>;
const presign = presignArtifactUpload as unknown as ReturnType<typeof vi.fn>;

function post(
  body: unknown,
  opts: { apiKey?: string | null } = {},
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const apiKey = opts.apiKey === undefined ? API_KEY : opts.apiKey;
  if (apiKey !== null) headers['x-api-key'] = apiKey;
  const request = new Request(
    'https://app.example/api/internal/recorder-upload-url',
    { method: 'POST', headers, body: JSON.stringify(body) },
  );
  return POST(request as unknown as NextRequest, { params: Promise.resolve({}) });
}

describe('POST /api/internal/recorder-upload-url', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_API_KEY = API_KEY;
    findUnique.mockResolvedValue({
      id: RECORDING_ID,
      eventId: EVENT_ID,
      status: 'READY',
    });
    presign.mockResolvedValue({ uploadUrl: SIGNED_URL, publicUrl: 'https://x/pub' });
  });

  describe('autenticazione', () => {
    it('senza x-api-key non firma nulla (e non guarda nemmeno il DB)', async () => {
      const res = await post({ recordingId: RECORDING_ID, blobKey: `${PREFIX}tracks.json` }, { apiKey: null });
      expect(res.status).toBe(401);
      expect(presign).not.toHaveBeenCalled();
      expect(findUnique).not.toHaveBeenCalled();
    });

    it('con una chiave sbagliata non firma nulla', async () => {
      const res = await post(
        { recordingId: RECORDING_ID, blobKey: `${PREFIX}tracks.json` },
        { apiKey: 'chiave-sbagliata' },
      );
      expect(res.status).toBe(401);
      expect(presign).not.toHaveBeenCalled();
    });

    it('se CRON_API_KEY non è configurata la rotta è chiusa a tutti (fail-closed)', async () => {
      // Altrimenti un deploy senza il secret trasformerebbe la rotta in un
      // presign pubblico: nessuna chiave deve valere quando non c'è chiave.
      delete process.env.CRON_API_KEY;
      const res = await post({ recordingId: RECORDING_ID, blobKey: `${PREFIX}tracks.json` }, { apiKey: '' });
      expect(res.status).toBe(401);
      expect(presign).not.toHaveBeenCalled();
    });
  });

  describe('confinamento del path', () => {
    // Ogni riga è un modo di uscire dalla cartella della PROPRIA registrazione
    // pur superando un `blobKey.startsWith(prefix)`: la key finisce in un URL
    // e chiunque la normalizzi (client che esegue il PUT, gateway
    // S3-compatibile, proxy) la fa atterrare altrove. Nessuna di queste deve
    // produrre un URL firmato.
    const ESCAPES: Array<[string, string]> = [
      ['risalita con ..', `${PREFIX}../../../${OTHER_EVENT_ID}/rec/evil.opus`],
      ['risalita da una sottocartella', `${PREFIX}audio/../../../../mix.mp4`],
      ['risalita nascosta a metà key', `${PREFIX}audio/../tracks.json`],
      ['risalita percent-encoded', `${PREFIX}%2e%2e/%2e%2e/evil.opus`],
      ['barra percent-encoded', `${PREFIX}..%2Fevil.opus`],
      ['backslash', `${PREFIX}..\\..\\evil.opus`],
      ['doppia barra / segmento vuoto', `${PREFIX}/..//evil.opus`],
      ['path assoluto', `/${PREFIX}audio/traccia.opus`],
      ['URL assoluto verso un altro host', `https://evil.example/${PREFIX}audio/traccia.opus`],
      ['byte nullo nel nome file', `${PREFIX}audio/traccia\u0000.opus`],
      ['a capo nel nome file', `${PREFIX}audio/traccia\n.opus`],
      ['la cartella stessa, che non è un oggetto', PREFIX],
      ['cartella di un ALTRO evento', `${MULTITRACK_PREFIX}${OTHER_EVENT_ID}/${RECORDING_ID}/audio/a.opus`],
      ['cartella di un\'ALTRA registrazione', `${MULTITRACK_PREFIX}${EVENT_ID}/${OTHER_RECORDING_ID}/audio/a.opus`],
      // Prefisso "fratello" che condivide l'inizio: senza lo `/` finale
      // `startsWith` lo accetterebbe.
      ['cartella sorella con lo stesso inizio', `${MULTITRACK_PREFIX}${EVENT_ID}/${RECORDING_ID}-evil/a.opus`],
      ['radice multitrack condivisa', `${MULTITRACK_PREFIX}tracks.json`],
      ['fuori dal dominio recordings', 'postprod/evil.json'],
    ];

    it.each(ESCAPES)('%s → nessun URL firmato', async (_caso, blobKey) => {
      const res = await post({ recordingId: RECORDING_ID, blobKey });
      expect(res.status).toBe(422);
      expect(presign).not.toHaveBeenCalled();
      expect(await res.json()).not.toHaveProperty('uploadUrl');
    });

    it.each([
      ['traccia audio', `${PREFIX}audio/pid-abc-0.opus`],
      ['traccia con id sanificato (underscore)', `${PREFIX}audio/_pid_0.opus`],
      ['manifest', `${PREFIX}tracks.json`],
    ])('firma le key legittime del recorder: %s', async (_caso, blobKey) => {
      const res = await post({
        recordingId: RECORDING_ID,
        blobKey,
        // Il MediaRecorder produce WebM/Opus, non Ogg (vedi infra/recorder).
        contentType: 'audio/webm; codecs=opus',
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ uploadUrl: SIGNED_URL });
      expect(presign).toHaveBeenCalledWith({
        blobKey,
        contentType: 'audio/webm; codecs=opus',
      });
    });
  });

  describe('registrazione e stato', () => {
    it('un recordingId inesistente non produce URL', async () => {
      findUnique.mockResolvedValue(null);
      const res = await post({ recordingId: RECORDING_ID, blobKey: `${PREFIX}tracks.json` });
      expect(res.status).toBe(404);
      expect(presign).not.toHaveBeenCalled();
    });

    it('una registrazione ARCHIVED non produce URL', async () => {
      // La retention ha già cancellato tracce e artefatti e non ripasserà su
      // questa Recording: byte scritti ora resterebbero lì per sempre.
      findUnique.mockResolvedValue({
        id: RECORDING_ID,
        eventId: EVENT_ID,
        status: 'ARCHIVED',
      });
      const res = await post({ recordingId: RECORDING_ID, blobKey: `${PREFIX}audio/pid-0.opus` });
      expect(res.status).toBe(409);
      expect(presign).not.toHaveBeenCalled();
    });

    it('un recordingId non-UUID viene respinto prima di toccare il DB', async () => {
      const res = await post({ recordingId: '../../etc', blobKey: `${PREFIX}tracks.json` });
      expect(res.status).toBe(422);
      expect(findUnique).not.toHaveBeenCalled();
      expect(presign).not.toHaveBeenCalled();
    });

    it('una blobKey vuota viene respinta dallo schema', async () => {
      const res = await post({ recordingId: RECORDING_ID, blobKey: '' });
      expect(res.status).toBe(422);
      expect(presign).not.toHaveBeenCalled();
    });

    it('il prefisso è quello dell’evento della registrazione, non uno passato dal chiamante', async () => {
      // La cartella viene ricostruita dal DB (recording.eventId): il body non
      // ha modo di spostarla.
      findUnique.mockResolvedValue({
        id: RECORDING_ID,
        eventId: OTHER_EVENT_ID,
        status: 'READY',
      });
      const res = await post({ recordingId: RECORDING_ID, blobKey: `${PREFIX}audio/pid-0.opus` });
      expect(res.status).toBe(422);
      expect(presign).not.toHaveBeenCalled();
    });
  });
});

// @vitest-environment node
/**
 * I file pubblici della post-produzione: passano dalla stessa regola di accesso
 * delle altre rotte, portano la marcatura dei contenuti generati, e il nome del
 * file non si lascia scrivere da chi chiede.
 */
import type { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { findUnique, assertPostprodAccessible, registrazionePubblica } = vi.hoisted(
  () => ({
    findUnique: vi.fn(),
    assertPostprodAccessible: vi.fn(),
    registrazionePubblica: vi.fn(),
  })
);

vi.mock('@/lib/db', () => ({ prisma: { recording: { findUnique } } }));
vi.mock('@/lib/ai/access', () => ({ assertPostprodAccessible }));
vi.mock('@/lib/captions/transcript', () => ({ registrazionePubblica }));

import { encryptPII } from '@/lib/crypto/pii';
import { NotFoundError } from '@/lib/errors';

import { GET } from './route';

function scarica(file: string, query = '', slug = 'evento') {
  const request = new Request(
    `http://localhost:3000/api/events/${slug}/postprod/download/${file}${query}`
  );
  return GET(request as unknown as NextRequest, {
    params: Promise.resolve({ param: slug, file }),
  });
}

const artefatto = (type: string, language: string | null, body: string, extra = {}) => ({
  type,
  language,
  inlineBody: encryptPII(body),
  revisedAt: null,
  original: null,
  ...extra,
});

const TRASCRIZIONE = JSON.stringify({
  language: 'it',
  segments: [
    { start: 0, end: 2.5, text: ' Buongiorno ', speaker: 'SPEAKER_00' },
    { start: 3661.25, end: 3662, text: 'A tutti', speaker: 'SPEAKER_01' },
  ],
});

function registrazione(artifacts: unknown[], extra: Record<string, unknown> = {}) {
  findUnique.mockResolvedValue({
    id: 'rec-1',
    sourceLanguage: 'it',
    artifacts,
    speakers: [{ diarLabel: 'SPEAKER_00', displayName: 'Anna Bianchi' }],
    ...extra,
  });
}

beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
});

beforeEach(() => {
  vi.clearAllMocks();
  assertPostprodAccessible.mockResolvedValue({
    eventId: 'ev-1',
    ambito: 'tutto',
    soloSottotitoli: false,
  });
  registrazionePubblica.mockResolvedValue('rec-1');
  registrazione([artefatto('TRANSCRIPT_JSON', null, TRASCRIZIONE)]);
});

describe('accesso', () => {
  it('solo i formati previsti: niente percorsi inventati', async () => {
    expect((await scarica('../../secret.txt')).status).toBe(422);
    expect((await scarica('transcript.vtt')).status).toBe(422);
    expect(assertPostprodAccessible).not.toHaveBeenCalled();
  });

  it('se la regola di accesso dice no, non si legge niente', async () => {
    assertPostprodAccessible.mockRejectedValue(new NotFoundError('Postprod'));
    expect((await scarica('transcript.txt')).status).toBe(404);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('senza una registrazione pubblica e’ 404', async () => {
    registrazionePubblica.mockResolvedValue(null);
    expect((await scarica('transcript.txt')).status).toBe(404);
  });

  it('la sintesi accompagna il video: con la sola trascrizione non c’e’', async () => {
    assertPostprodAccessible.mockResolvedValue({
      eventId: 'ev-1',
      ambito: 'trascrizione',
      soloSottotitoli: true,
    });
    expect((await scarica('summary.md')).status).toBe(404);
  });

  it('lo stesso per le traduzioni della trascrizione', async () => {
    assertPostprodAccessible.mockResolvedValue({
      eventId: 'ev-1',
      ambito: 'trascrizione',
      soloSottotitoli: true,
    });
    expect((await scarica('transcript.txt', '?lang=en')).status).toBe(404);
  });
});

describe('trascrizione', () => {
  it('il testo riporta tempi e nomi, e dice che e’ generato', async () => {
    const r = await scarica('transcript.txt');
    const testo = await r.text();
    expect(testo).toContain('[00:00:00] Anna Bianchi: Buongiorno');
    expect(testo).toContain('[01:01:01] SPEAKER_01: A tutti');
    expect(testo.split('\n')[0]).toMatch(/^\[/);
    expect(r.headers.get('x-ai-generated')).toBe('true');
    expect(r.headers.get('content-disposition')).toBe(
      'attachment; filename="evento-transcript.it.txt"'
    );
  });

  it('una correzione a mano si dichiara', async () => {
    registrazione([
      artefatto('TRANSCRIPT_JSON', null, TRASCRIZIONE, { revisedAt: new Date() }),
    ]);
    await expect((await scarica('transcript.txt')).text()).resolves.toContain(
      'Revised by a person'
    );
  });

  it('i sottotitoli seguono il formato SubRip', async () => {
    const r = await scarica('transcript.srt');
    const testo = await r.text();
    expect(testo).toContain(
      '1\n00:00:00,000 --> 00:00:02,500\n<i>Anna Bianchi:</i> Buongiorno'
    );
    expect(testo).toContain('2\n01:01:01,250 --> 01:01:02,000');
    expect(r.headers.get('content-type')).toContain('application/x-subrip');
  });

  it('un tempo vicino al secondo non produce un timestamp impossibile', async () => {
    registrazione([
      artefatto(
        'TRANSCRIPT_JSON',
        null,
        JSON.stringify({ segments: [{ start: 1.9996, end: 59.9999, text: 'x' }] })
      ),
    ]);
    await expect((await scarica('transcript.srt')).text()).resolves.toContain(
      '00:00:02,000 --> 00:01:00,000'
    );
  });

  it('senza segmenti o con dati guasti e’ 404, non un errore', async () => {
    registrazione([artefatto('TRANSCRIPT_JSON', null, '{ non json')]);
    expect((await scarica('transcript.txt')).status).toBe(404);
    registrazione([artefatto('TRANSCRIPT_JSON', null, JSON.stringify({ segments: [] }))]);
    expect((await scarica('transcript.txt')).status).toBe(404);
  });

  it('una lingua tradotta viene dai sottotitoli di quella lingua', async () => {
    registrazione([
      artefatto(
        'TRANSLATION_VTT',
        'en',
        'WEBVTT\n\nNOTE commento\n\n1\n00:01.000 --> 00:02.000\n<v A>Good</v> morning\n\n01:00:00.000 --> 01:00:01.500\nEveryone\n'
      ),
    ]);
    const r = await scarica('transcript.txt', '?lang=EN');
    const testo = await r.text();
    expect(testo).toContain('[00:00:01] Good morning');
    expect(testo).toContain('[01:00:00] Everyone');
    expect(r.headers.get('content-disposition')).toContain('transcript.en.txt');
  });

  it('una lingua che non c’e’ e’ 404', async () => {
    expect((await scarica('transcript.txt', '?lang=de')).status).toBe(404);
  });

  it('senza lingua registrata si serve il testo, nella sua lingua', async () => {
    registrazione([artefatto('TRANSCRIPT_JSON', null, TRASCRIZIONE)], {
      sourceLanguage: null,
    });
    const r = await scarica('transcript.txt', '?lang=en');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toContain('transcript.it.txt');
  });

  it('la lingua chiesta non entra nell’intestazione del file', async () => {
    const senza = JSON.stringify({ segments: [{ start: 0, end: 1, text: 'x' }] });
    registrazione([artefatto('TRANSCRIPT_JSON', null, senza)], { sourceLanguage: null });
    const r = await scarica(
      'transcript.txt',
      `?lang=${encodeURIComponent('x"; a=b\r\nX-Y: z')}`
    );
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toMatch(
      /^attachment; filename="evento-transcript\.[a-z0-9-]+\.txt"$/
    );
    expect(r.headers.get('x-y')).toBeNull();
  });
});

describe('sintesi', () => {
  it('nella lingua chiesta, se c’e’', async () => {
    registrazione([
      artefatto('SUMMARY_MD', 'it', 'Sintesi italiana'),
      artefatto('TRANSLATION_MD', 'en', 'English summary'),
    ]);
    const r = await scarica('summary.md', '?lang=en');
    await expect(r.text()).resolves.toContain('English summary');
    expect(r.headers.get('content-disposition')).toContain('summary.en.md');
    expect(r.headers.get('x-ai-generated')).toBe('true');
  });

  it('altrimenti nella lingua originale', async () => {
    registrazione([artefatto('SUMMARY_MD', 'it', 'Sintesi italiana')]);
    await expect((await scarica('summary.md', '?lang=de')).text()).resolves.toContain(
      'Sintesi italiana'
    );
  });

  it('senza sintesi, o con una che non si legge, e’ 404', async () => {
    registrazione([]);
    expect((await scarica('summary.md')).status).toBe(404);
  });
});

describe('nome del file', () => {
  it('lo slug si ripulisce prima di finire nell’intestazione', async () => {
    const r = await scarica('transcript.txt', '', 'evento"; a=b');
    expect(r.headers.get('content-disposition')).toBe(
      'attachment; filename="evento-a-b-transcript.it.txt"'
    );
  });
});

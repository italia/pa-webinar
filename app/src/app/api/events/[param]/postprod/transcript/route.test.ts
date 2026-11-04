// @vitest-environment node
/**
 * La trascrizione pubblica: passa dalla regola di accesso, mostra solo cio' che
 * l'ambito pubblicato permette, e dove il consenso voce per voce e' stato chiesto
 * non attribuisce un nome a chi non l'ha dato.
 */
import type { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  recording: vi.fn(),
  event: vi.fn(),
  site: vi.fn(),
  assertPostprodAccessible: vi.fn(),
  registrazionePubblica: vi.fn(),
  regimeConsensoVoce: vi.fn(),
  endpointConConsenso: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    recording: { findUnique: h.recording },
    event: { findUnique: h.event },
    siteSetting: { findUnique: h.site },
  },
}));
vi.mock('@/lib/ai/access', () => ({
  assertPostprodAccessible: h.assertPostprodAccessible,
}));
vi.mock('@/lib/captions/transcript', () => ({
  CAPTIONS_TRANSCRIPT_MODEL: 'live-captions',
  registrazionePubblica: h.registrazionePubblica,
}));
vi.mock('@/lib/ai/voice-consent', () => ({ regimeConsensoVoce: h.regimeConsensoVoce }));
vi.mock('@/lib/captions/room', () => ({ endpointConConsenso: h.endpointConConsenso }));
vi.mock('next-intl/server', () => ({
  getTranslations:
    async ({ locale }: { locale: string }) =>
    (_k: string, v: { n: number }) =>
      `${locale === 'en' ? 'Participant' : 'Partecipante'} ${v.n}`,
}));

import { encryptPII } from '@/lib/crypto/pii';
import { NotFoundError } from '@/lib/errors';

import { GET } from './route';

let contatore = 0;

function chiedi(query = '') {
  const request = new Request(
    `http://localhost:3000/api/events/evento/postprod/transcript${query}`
  );
  return GET(request as unknown as NextRequest, {
    params: Promise.resolve({ param: 'evento' }),
  });
}

const artefatto = (
  type: string,
  language: string | null,
  body: string | null,
  extra = {}
) => ({
  id: `${type}-${language}`,
  type,
  language,
  inlineBody: body === null ? null : encryptPII(body),
  blobKey: null,
  revisedAt: null,
  modelId: null,
  original: null,
  ...extra,
});

const TRASCRIZIONE = {
  language: 'it',
  segments: [
    { start: 0, end: 10, text: 'Uno', speaker: 'SPEAKER_00', avg_logprob: -0.9 },
    {
      start: 10,
      end: 20,
      text: 'Due',
      speaker: 'SPEAKER_01',
      avg_logprob: -0.1,
      words: [{ start: 10, end: 11, word: 'Due' }, { bad: true }],
    },
  ],
};

function registrazione(extra: Record<string, unknown> = {}) {
  contatore += 1;
  h.recording.mockResolvedValue({
    id: `rec-${contatore}`,
    sourceLanguage: 'it',
    pipelineSnapshot: { asr: 'whisperx' },
    artifacts: [artefatto('TRANSCRIPT_JSON', null, JSON.stringify(TRASCRIZIONE))],
    speakers: [
      { diarLabel: 'SPEAKER_00', displayName: null, totalSpeechSec: 5 },
      { diarLabel: 'SPEAKER_01', displayName: null, totalSpeechSec: 50 },
    ],
    callSession: { dominantSpeakerLog: [] },
    ...extra,
  });
}

type Corpo = {
  segments: Array<{
    speakerName: string | null;
    lowConfidence: boolean;
    words?: unknown[];
  }>;
  summaries: Record<string, string>;
  summariesStructured: Record<string, unknown>;
  subtitleTracks: string[];
  dubbedAudio: Array<{ language: string; src: string }>;
  source: string;
  revised: { transcript: boolean; summaries: string[] };
  sourceLanguage: string;
  untranscribed: unknown[];
};
const corpo = async (query = '') => (await (await chiedi(query)).json()) as Corpo;

beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
});

beforeEach(() => {
  vi.clearAllMocks();
  h.assertPostprodAccessible.mockResolvedValue({
    eventId: 'ev-1',
    ambito: 'tutto',
    soloSottotitoli: false,
  });
  h.registrazionePubblica.mockResolvedValue('rec-1');
  h.event.mockResolvedValue({ multitrackRecordingEnabled: true });
  h.site.mockResolvedValue({ liveCaptionsEnabled: true });
  h.regimeConsensoVoce.mockResolvedValue({ chiesto: false });
  registrazione();
});

describe('accesso', () => {
  it('se la regola di accesso dice no, non si legge niente', async () => {
    h.assertPostprodAccessible.mockRejectedValue(new NotFoundError('Postprod'));
    expect((await chiedi()).status).toBe(404);
    expect(h.recording).not.toHaveBeenCalled();
  });

  it('senza registrazione pubblica, o se e’ sparita, e’ 404', async () => {
    h.registrazionePubblica.mockResolvedValue(null);
    expect((await chiedi()).status).toBe(404);
    h.registrazionePubblica.mockResolvedValue('rec-1');
    h.recording.mockResolvedValue(null);
    expect((await chiedi()).status).toBe(404);
  });

  it('non resta in cache, e dice che il testo e’ generato', async () => {
    const r = await chiedi();
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    expect(r.headers.get('x-ai-generated')).toBe('true');
    await expect(r.json()).resolves.toMatchObject({ aiGenerated: true });
  });

  it('con la sola trascrizione pubblicata non escono sintesi, tracce e doppiaggio', async () => {
    h.assertPostprodAccessible.mockResolvedValue({
      eventId: 'ev-1',
      ambito: 'trascrizione',
      soloSottotitoli: true,
    });
    registrazione({
      artifacts: [
        artefatto('TRANSCRIPT_JSON', null, JSON.stringify(TRASCRIZIONE)),
        artefatto('SUMMARY_MD', 'it', 'Sintesi'),
        artefatto('TRANSLATION_VTT', 'en', 'WEBVTT'),
        artefatto('DUBBED_AUDIO', 'en', null),
      ],
    });
    const c = await corpo();
    expect(c.summaries).toEqual({});
    expect(c.subtitleTracks).toEqual([]);
    expect(c.dubbedAudio).toEqual([]);
    expect(c.segments).toHaveLength(2);
  });
});

describe('nomi di chi parla', () => {
  it('le voci anonime si numerano per tempo di parola', async () => {
    const c = await corpo();
    expect(c.segments.map((s) => s.speakerName)).toEqual([
      'Partecipante 2',
      'Partecipante 1',
    ]);
  });

  it('l’etichetta segue la lingua della pagina, e una sconosciuta ricade sull’italiano', async () => {
    expect((await corpo('?locale=en')).segments[1]!.speakerName).toBe('Participant 1');
    registrazione();
    expect((await corpo('?locale=xx')).segments[1]!.speakerName).toBe('Partecipante 1');
  });

  it('il nome dato dallo staff vince', async () => {
    registrazione({
      speakers: [
        { diarLabel: 'SPEAKER_00', displayName: 'Anna Bianchi', totalSpeechSec: 5 },
        { diarLabel: 'SPEAKER_01', displayName: 'Luca Verdi', totalSpeechSec: 50 },
      ],
    });
    const c = await corpo();
    expect(c.segments.map((s) => s.speakerName)).toEqual(['Anna Bianchi', 'Luca Verdi']);
  });

  const LOG = [
    { atMs: 0, participantId: 'ep-1', displayName: 'Anna Bianchi' },
    { atMs: 10_000, participantId: 'ep-2', displayName: 'Luca Verdi' },
  ];

  it('senza consenso chiesto, il registro di chi parlava da’ i nomi', async () => {
    registrazione({ callSession: { dominantSpeakerLog: LOG } });
    const c = await corpo();
    expect(c.segments.map((s) => s.speakerName)).toEqual(['Anna Bianchi', 'Luca Verdi']);
  });

  it('col consenso chiesto, il nome solo di chi l’ha dato', async () => {
    h.regimeConsensoVoce.mockResolvedValue({ chiesto: true, versione: 'v1' });
    h.endpointConConsenso.mockResolvedValue(new Set(['ep-2']));
    registrazione({ callSession: { dominantSpeakerLog: LOG } });
    const c = await corpo();
    expect(c.segments[0]!.speakerName).not.toBe('Anna Bianchi');
    expect(c.segments[1]!.speakerName).toBe('Luca Verdi');
    expect(h.endpointConConsenso).toHaveBeenCalledWith('ev-1', ['ep-1', 'ep-2'], 'v1');
  });

  it('senza voci da nominare il registro non si legge', async () => {
    registrazione({
      speakers: [
        { diarLabel: 'SPEAKER_00', displayName: 'Anna Bianchi', totalSpeechSec: 5 },
      ],
      callSession: { dominantSpeakerLog: LOG },
    });
    await corpo();
    expect(h.regimeConsensoVoce).not.toHaveBeenCalled();
  });
});

describe('contenuto', () => {
  it('segnala i tratti poco sicuri e scarta le parole guaste', async () => {
    const c = await corpo();
    expect(c.segments.map((s) => s.lowConfidence)).toEqual([true, false]);
    expect(c.segments[1]!.words).toEqual([{ start: 10, end: 11, word: 'Due' }]);
  });

  it('dice da dove viene il testo', async () => {
    expect((await corpo()).source).toBe('ai');
    registrazione({
      artifacts: [
        artefatto('TRANSCRIPT_JSON', null, '{"segments":[]}', {
          modelId: 'live-captions',
        }),
      ],
    });
    expect((await corpo()).source).toBe('live-captions');
  });

  it('riporta tracce, sintesi e doppiaggio disponibili', async () => {
    registrazione({
      artifacts: [
        artefatto('TRANSCRIPT_JSON', null, JSON.stringify(TRASCRIZIONE)),
        artefatto('TRANSCRIPT_VTT', 'it', 'WEBVTT'),
        artefatto('TRANSLATION_VTT', 'en', 'WEBVTT'),
        artefatto('TRANSLATION_VTT', 'en', 'WEBVTT'),
        artefatto('SUMMARY_MD', 'it', 'Sintesi', { revisedAt: new Date() }),
        artefatto('SUMMARY_JSON', 'it', '{"overall_summary":"x"}'),
        artefatto('SUMMARY_JSON', 'en', '{ guasto'),
        artefatto('DUBBED_AUDIO', 'en', null),
      ],
    });
    const c = await corpo();
    expect(c.subtitleTracks).toEqual(['en', 'it']);
    expect(c.summaries).toEqual({ it: 'Sintesi' });
    expect(c.summariesStructured).toEqual({ it: { overall_summary: 'x' } });
    expect(c.dubbedAudio).toEqual([
      { language: 'en', src: '/api/events/evento/postprod/dubbed-audio/en' },
    ]);
    expect(c.revised).toEqual({ transcript: false, summaries: ['it'] });
  });

  it('senza artefatti risponde vuoto, con la lingua predefinita', async () => {
    registrazione({ artifacts: [], speakers: [], sourceLanguage: null });
    const c = await corpo();
    expect(c.segments).toEqual([]);
    expect(c.sourceLanguage).toBe('it');
    expect(c.untranscribed).toEqual([]);
  });

  it('i tratti non trascritti escono solo se ben formati', async () => {
    registrazione({
      artifacts: [
        artefatto(
          'TRANSCRIPT_JSON',
          null,
          JSON.stringify({
            segments: [],
            untranscribed: [{ start: 1, end: 2 }, { start: 'x' }],
          })
        ),
      ],
      speakers: [],
    });
    expect((await corpo()).untranscribed).toEqual([{ start: 1, end: 2 }]);
  });
});

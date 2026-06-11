import { describe, expect, it } from 'vitest';

import {
  artifactMimeType,
  artifactPath,
  expectedArtifactsForJob,
  eventPrefix,
  formatRunId,
  POSTPROD_PREFIX,
  recordingPrefix,
  runPrefix,
} from './paths';

describe('formatRunId', () => {
  it('zero-pads small numbers to width 3', () => {
    expect(formatRunId(1)).toBe('001');
    expect(formatRunId(12)).toBe('012');
    expect(formatRunId(999)).toBe('999');
  });
  it('lets large numbers expand past width 3', () => {
    expect(formatRunId(1000)).toBe('1000');
  });
  it('rejects zero / negative / non-integer', () => {
    expect(() => formatRunId(0)).toThrow();
    expect(() => formatRunId(-1)).toThrow();
    expect(() => formatRunId(1.5)).toThrow();
  });
});

describe('prefixes', () => {
  const input = { eventId: 'EV', recordingId: 'REC', runCount: 2 };

  it('runPrefix uses padded runId', () => {
    expect(runPrefix(input)).toBe(`${POSTPROD_PREFIX}/EV/REC/002`);
  });

  it('recordingPrefix strips runId', () => {
    expect(recordingPrefix(input)).toBe(`${POSTPROD_PREFIX}/EV/REC`);
  });

  it('eventPrefix strips recording + runId', () => {
    expect(eventPrefix('EV')).toBe(`${POSTPROD_PREFIX}/EV`);
  });
});

describe('artifactPath', () => {
  const input = { eventId: 'EV', recordingId: 'REC', runCount: 3 };
  const base = `${POSTPROD_PREFIX}/EV/REC/003`;

  it('TRANSCRIPT_JSON is language-agnostic', () => {
    expect(artifactPath(input, 'TRANSCRIPT_JSON', null)).toBe(
      `${base}/transcript.raw.json`,
    );
  });

  it('TRANSCRIPT_VTT requires a language', () => {
    expect(artifactPath(input, 'TRANSCRIPT_VTT', 'it')).toBe(
      `${base}/transcript.it.vtt`,
    );
    expect(() => artifactPath(input, 'TRANSCRIPT_VTT', null)).toThrow();
  });

  it('TRANSLATION_VTT and TRANSLATION_MD use language for the suffix', () => {
    expect(artifactPath(input, 'TRANSLATION_VTT', 'en')).toBe(
      `${base}/transcript.en.vtt`,
    );
    expect(artifactPath(input, 'TRANSLATION_MD', 'fr')).toBe(
      `${base}/summary.fr.md`,
    );
  });

  it('SUMMARY_MD uses .md', () => {
    expect(artifactPath(input, 'SUMMARY_MD', 'it')).toBe(`${base}/summary.it.md`);
  });

  it('WAVEFORM_JSON is language-agnostic', () => {
    expect(artifactPath(input, 'WAVEFORM_JSON', null)).toBe(`${base}/waveform.json`);
  });
});

describe('artifactMimeType', () => {
  it('maps types to MIME', () => {
    expect(artifactMimeType('TRANSCRIPT_JSON')).toBe('application/json');
    expect(artifactMimeType('WAVEFORM_JSON')).toBe('application/json');
    expect(artifactMimeType('TRANSCRIPT_VTT')).toBe('text/vtt');
    expect(artifactMimeType('SUMMARY_MD')).toMatch(/markdown/);
    expect(artifactMimeType('TRANSCRIPT_TXT')).toMatch(/plain/);
  });
});

describe('expectedArtifactsForJob — multitrack', () => {
  it('TRANSCRIBE_MULTITRACK produces the same artifacts as TRANSCRIBE', () => {
    const mt = expectedArtifactsForJob('TRANSCRIBE_MULTITRACK', { sourceLanguage: 'it' });
    const tr = expectedArtifactsForJob('TRANSCRIBE', { sourceLanguage: 'it' });
    expect(mt).toEqual(tr);
    expect(mt.map((a) => a.type)).toEqual([
      'TRANSCRIPT_JSON',
      'TRANSCRIPT_VTT',
      'TRANSCRIPT_TXT',
    ]);
  });
});

describe('expectedArtifactsForJob', () => {
  it('TRANSCRIBE produces JSON+VTT+TXT in source language (default it)', () => {
    const out = expectedArtifactsForJob('TRANSCRIBE', {});
    expect(out).toHaveLength(3);
    expect(out.map((a) => a.type).sort()).toEqual([
      'TRANSCRIPT_JSON',
      'TRANSCRIPT_TXT',
      'TRANSCRIPT_VTT',
    ]);
    expect(out.find((a) => a.type === 'TRANSCRIPT_VTT')?.language).toBe('it');
  });

  it('TRANSCRIBE honours sourceLanguage', () => {
    const out = expectedArtifactsForJob('TRANSCRIBE', { sourceLanguage: 'en' });
    expect(out.find((a) => a.type === 'TRANSCRIPT_VTT')?.language).toBe('en');
  });

  it('SUMMARIZE produces MD + structured JSON in source language', () => {
    const out = expectedArtifactsForJob('SUMMARIZE', { sourceLanguage: 'it' });
    expect(out).toEqual([
      { role: 'summary', type: 'SUMMARY_MD', language: 'it' },
      { role: 'summaryJson', type: 'SUMMARY_JSON', language: 'it' },
    ]);
  });

  it('TRANSLATE produces VTT + MD + structured JSON in target language', () => {
    const out = expectedArtifactsForJob('TRANSLATE', {
      sourceLanguage: 'it',
      targetLanguage: 'en',
    });
    expect(out.map((a) => a.type)).toEqual([
      'TRANSLATION_VTT',
      'TRANSLATION_MD',
      'SUMMARY_JSON',
    ]);
    expect(out.every((a) => a.language === 'en')).toBe(true);
  });

  it('SUBTITLE uses the explicit language field', () => {
    const out = expectedArtifactsForJob('SUBTITLE', { language: 'fr' });
    expect(out).toEqual([{ role: 'subtitle', type: 'SUBTITLE_VTT', language: 'fr' }]);
  });

  it('DUB produces a single DUBBED_AUDIO in target language', () => {
    const out = expectedArtifactsForJob('DUB', {
      sourceLanguage: 'it',
      targetLanguage: 'en',
    });
    expect(out).toEqual([
      { role: 'dubbedAudio', type: 'DUBBED_AUDIO', language: 'en' },
    ]);
  });
});

describe('artifactPath — dubbed media', () => {
  const input = { eventId: 'EV', recordingId: 'REC', runCount: 1 };

  it('DUBBED_AUDIO uses .m4a in target language', () => {
    expect(artifactPath(input, 'DUBBED_AUDIO', 'en')).toMatch(/dubbed\.en\.m4a$/);
  });

  it('DUBBED_VIDEO uses .mp4 in target language', () => {
    expect(artifactPath(input, 'DUBBED_VIDEO', 'fr')).toMatch(/dubbed\.fr\.mp4$/);
  });

  it('refuses dubbed types without language', () => {
    expect(() => artifactPath(input, 'DUBBED_AUDIO', null)).toThrow();
  });
});

describe('artifactMimeType — dubbed media', () => {
  it('DUBBED_AUDIO is audio/mp4', () => {
    expect(artifactMimeType('DUBBED_AUDIO')).toBe('audio/mp4');
  });
  it('DUBBED_VIDEO is video/mp4', () => {
    expect(artifactMimeType('DUBBED_VIDEO')).toBe('video/mp4');
  });
});

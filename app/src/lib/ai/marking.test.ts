import { describe, expect, it } from 'vitest';

import { markMarkdown, markPlainText, markVtt } from './marking';

const VTT = 'WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\nBuongiorno a tutti\n';

describe('markVtt', () => {
  it('adds a NOTE block after the header, before the cues', () => {
    const out = markVtt(VTT);
    const lines = out.split('\n');
    expect(lines[0]).toBe('WEBVTT');
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe('NOTE');
    expect(lines[3]).toBe('ai-generated: true');
    const noteEnd = lines.indexOf('', 3);
    expect(lines[noteEnd + 1]).toBe('1');
    expect(out).toContain('Buongiorno a tutti');
  });

  it('keeps header metadata and marks a revision', () => {
    const out = markVtt('WEBVTT - titolo\nKind: captions\n\n1\n00:00:00.000 --> 00:00:01.000\nCiao\n', {
      revised: true,
    });
    expect(out.startsWith('WEBVTT - titolo\nKind: captions\n\nNOTE\n')).toBe(true);
    expect(out).toContain('ai-revision:');
  });

  it('does not mark twice', () => {
    expect(markVtt(markVtt(VTT))).toBe(markVtt(VTT));
  });
});

describe('markPlainText / markMarkdown', () => {
  it('put the notice first', () => {
    expect(markPlainText('testo').startsWith('[AI-generated content')).toBe(true);
    const md = markMarkdown('# Sintesi');
    expect(md.startsWith('<!-- ai-generated: true -->')).toBe(true);
    expect(md.endsWith('# Sintesi')).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';

import { contentMatchesDeclaredMime } from './mime-sniff';

const buf = (...bytes: number[]): Buffer => Buffer.from(bytes);
const text = (s: string): Buffer => Buffer.from(s, 'utf8');

describe('contentMatchesDeclaredMime', () => {
  it('accepts real PNG/JPEG/GIF/WEBP magic bytes', () => {
    expect(
      contentMatchesDeclaredMime(
        buf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
        'image/png',
      ),
    ).toBe(true);
    expect(contentMatchesDeclaredMime(buf(0xff, 0xd8, 0xff, 0xe0), 'image/jpeg')).toBe(true);
    expect(contentMatchesDeclaredMime(text('GIF89a...'), 'image/gif')).toBe(true);
    expect(
      contentMatchesDeclaredMime(
        Buffer.concat([text('RIFF'), buf(0, 0, 0, 0), text('WEBP')]),
        'image/webp',
      ),
    ).toBe(true);
  });

  it('accepts PDF and audio signatures', () => {
    expect(contentMatchesDeclaredMime(text('%PDF-1.7'), 'application/pdf')).toBe(true);
    expect(contentMatchesDeclaredMime(text('ID3'), 'audio/mpeg')).toBe(true);
    expect(contentMatchesDeclaredMime(buf(0xff, 0xfb, 0x90), 'audio/mpeg')).toBe(true);
    expect(contentMatchesDeclaredMime(text('OggS'), 'audio/ogg')).toBe(true);
    expect(
      contentMatchesDeclaredMime(Buffer.concat([buf(0, 0, 0, 0x18), text('ftyp')]), 'audio/mp4'),
    ).toBe(true);
  });

  it('accepts OOXML docs as ZIP containers', () => {
    const docx =
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    expect(contentMatchesDeclaredMime(buf(0x50, 0x4b, 0x03, 0x04), docx)).toBe(true);
    // an xlsx claiming its type but really a PNG → reject
    expect(
      contentMatchesDeclaredMime(
        buf(0x89, 0x50, 0x4e, 0x47),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    ).toBe(false);
  });

  it('accepts genuine SVG but rejects a script/HTML blob mislabeled as SVG', () => {
    expect(
      contentMatchesDeclaredMime(text('<?xml version="1.0"?><svg xmlns="..."></svg>'), 'image/svg+xml'),
    ).toBe(true);
    expect(contentMatchesDeclaredMime(text('<svg onload="alert(1)">'), 'image/svg+xml')).toBe(true);
    expect(
      contentMatchesDeclaredMime(text('<html><script>alert(1)</script></html>'), 'image/svg+xml'),
    ).toBe(false);
  });

  it('accepts SVGs that lead with a comment, DOCTYPE or BOM (not just <?xml/<svg)', () => {
    expect(
      contentMatchesDeclaredMime(text('<!-- Generator: Acme 1.0 --><svg xmlns="..."></svg>'), 'image/svg+xml'),
    ).toBe(true);
    expect(
      contentMatchesDeclaredMime(
        text('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "..."><svg></svg>'),
        'image/svg+xml',
      ),
    ).toBe(true);
    expect(
      contentMatchesDeclaredMime(text('﻿  \n<svg xmlns="..."></svg>'), 'image/svg+xml'),
    ).toBe(true);
  });

  it('accepts a PDF with a leading BOM (signature not at byte 0)', () => {
    expect(
      contentMatchesDeclaredMime(Buffer.concat([buf(0xef, 0xbb, 0xbf), text('%PDF-1.4')]), 'application/pdf'),
    ).toBe(true);
  });

  it('accepts BOM-prefixed UTF-16 text (NUL bytes) as text/plain', () => {
    // UTF-16 LE BOM followed by "hi" → FF FE 68 00 69 00
    expect(
      contentMatchesDeclaredMime(buf(0xff, 0xfe, 0x68, 0x00, 0x69, 0x00), 'text/plain'),
    ).toBe(true);
    // UTF-8 BOM text
    expect(
      contentMatchesDeclaredMime(Buffer.concat([buf(0xef, 0xbb, 0xbf), text('ciao')]), 'text/plain'),
    ).toBe(true);
  });

  it('rejects a spoofed type (HTML bytes declared as image/png)', () => {
    expect(
      contentMatchesDeclaredMime(text('<html><body>hi</body></html>'), 'image/png'),
    ).toBe(false);
  });

  it('treats text/plain leniently but rejects binaries with NUL bytes', () => {
    expect(contentMatchesDeclaredMime(text('just some notes'), 'text/plain')).toBe(true);
    expect(contentMatchesDeclaredMime(buf(0x00, 0x01, 0x02, 0x00), 'text/plain')).toBe(false);
  });

  it('rejects an out-of-allow-list declared type', () => {
    expect(contentMatchesDeclaredMime(text('whatever'), 'text/html')).toBe(false);
    expect(contentMatchesDeclaredMime(text('whatever'), 'application/x-msdownload')).toBe(false);
  });
});

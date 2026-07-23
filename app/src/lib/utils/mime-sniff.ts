/**
 * Lightweight magic-byte sniffing for the asset upload allow-list.
 *
 * The upload route only trusts a small, fixed set of MIME types. A browser can
 * trivially spoof the declared `file.type`, so this checks the buffer's leading
 * bytes against the signature expected for the declared type and rejects a
 * mismatch. It is defense-in-depth on top of the serving route's
 * nosniff + attachment-for-non-inline-safe hardening — not a full content
 * scanner. We only need to cover the allow-listed types; anything else returns
 * false (the route would have rejected an unknown declared type anyway).
 */

function ascii(buf: Buffer, s: string, offset = 0): boolean {
  for (let i = 0; i < s.length; i++) {
    if (buf[offset + i] !== s.charCodeAt(i)) return false;
  }
  return true;
}

function bytes(buf: Buffer, sig: number[], offset = 0): boolean {
  for (let i = 0; i < sig.length; i++) {
    if (buf[offset + i] !== sig[i]) return false;
  }
  return true;
}

/** True if the ASCII `needle` occurs within the first `within` bytes. */
function headContains(buf: Buffer, needle: string, within: number): boolean {
  return buf.subarray(0, within).toString('latin1').includes(needle);
}

/** A NUL byte early in the stream is a strong signal of binary content. */
function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 512);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/**
 * Recognise an SVG by its markup shape. After stripping a BOM and leading
 * whitespace the head must start with `<` (so it's markup, not e.g. an HTML
 * doc with leading text) and contain an `<svg` root within the first ~2 KiB.
 * This accepts SVGs that lead with `<?xml …?>`, `<!-- … -->` or
 * `<!DOCTYPE svg …>` while still rejecting non-SVG markup like `<html>`.
 */
function looksLikeSvg(buf: Buffer): boolean {
  if (looksBinary(buf)) return false;
  const head = buf.subarray(0, 2048).toString('utf8').replace(/^﻿/, '').trimStart();
  if (!head.startsWith('<')) return false;
  return /<svg[\s>]/i.test(head);
}

/** Strip MIME parameters and normalise case: "Image/PNG; x=1" → "image/png". */
export function normalizeMimeType(contentType: string): string {
  return (contentType.split(';', 1)[0] ?? '').trim().toLowerCase();
}

const OOXML_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

/**
 * True when the buffer's magic bytes are consistent with the declared MIME.
 * Returns false for a mismatch or an out-of-scope declared type.
 */
export function contentMatchesDeclaredMime(
  buf: Buffer,
  declaredMime: string,
): boolean {
  const mime = normalizeMimeType(declaredMime);

  if (OOXML_MIMES.has(mime)) {
    // Office Open XML files (docx/pptx/xlsx) are ZIP containers.
    return (
      bytes(buf, [0x50, 0x4b, 0x03, 0x04]) || // normal
      bytes(buf, [0x50, 0x4b, 0x05, 0x06]) || // empty archive
      bytes(buf, [0x50, 0x4b, 0x07, 0x08]) // spanned
    );
  }

  switch (mime) {
    case 'image/png':
      return bytes(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg':
      return bytes(buf, [0xff, 0xd8, 0xff]);
    case 'image/gif':
      return ascii(buf, 'GIF87a') || ascii(buf, 'GIF89a');
    case 'image/webp':
      return ascii(buf, 'RIFF') && ascii(buf, 'WEBP', 8);
    case 'image/svg+xml':
      return looksLikeSvg(buf);
    case 'application/pdf':
      // Spec allows the %PDF- header within the first bytes (some generators
      // emit a BOM/whitespace first), so scan the head rather than offset 0.
      return headContains(buf, '%PDF-', 1024);
    case 'audio/mpeg':
      // ID3-tagged, or a raw MPEG audio frame sync (0xFFEx).
      return (
        ascii(buf, 'ID3') || (buf[0] === 0xff && ((buf[1] ?? 0) & 0xe0) === 0xe0)
      );
    case 'audio/wav':
      return ascii(buf, 'RIFF') && ascii(buf, 'WAVE', 8);
    case 'audio/ogg':
      return ascii(buf, 'OggS');
    case 'audio/mp4':
      // ISO-BMFF: 'ftyp' box at offset 4.
      return ascii(buf, 'ftyp', 4);
    case 'audio/webm':
      return bytes(buf, [0x1a, 0x45, 0xdf, 0xa3]);
    case 'text/plain':
      // BOM-prefixed UTF-16/UTF-8 text legitimately carries NUL bytes (UTF-16
      // ASCII has 0x00 high bytes), so accept a known text BOM; otherwise
      // reject obvious binaries. Can't positively fingerprint plain text.
      if (
        bytes(buf, [0xff, 0xfe]) || // UTF-16 LE BOM
        bytes(buf, [0xfe, 0xff]) || // UTF-16 BE BOM
        bytes(buf, [0xef, 0xbb, 0xbf]) // UTF-8 BOM
      ) {
        return true;
      }
      return !looksBinary(buf);
    default:
      return false;
  }
}

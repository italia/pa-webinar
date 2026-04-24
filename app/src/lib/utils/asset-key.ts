/**
 * Build an object-storage key for an uploaded asset.
 *
 * Pattern: `assets/{type}/{yyyy}/{mm}/{uuid}-{sanitizedFilename}`
 *
 * Sanitization rules:
 *   - strip every character that isn't a letter, digit, dot, hyphen or
 *     underscore (spaces included) — avoids path traversal and keeps the
 *     key a valid S3/Azure object name
 *   - collapse runs of consecutive hyphens introduced by sanitization
 *   - strip leading/trailing hyphens and dots (dot-files are annoying)
 *   - limit the filename portion to 60 chars, preserving the extension
 *     when possible (suffix is always the last `.ext` up to 10 chars)
 *   - if sanitization strips everything, fall back to "file"
 *
 * Extracted out of the route handler so it's pure and testable — the
 * route just plugs in `randomUUID()` and `new Date()`.
 */

export type AssetType = 'image' | 'audio' | 'document';

const MAX_FILENAME_LEN = 60;

export function sanitizeFilename(name: string): string {
  // Drop any path component a client may have included.
  const base = name.split(/[\\/]/).pop() ?? '';

  // Split off extension (last dot, preserve up to 10 chars of ext).
  const dotIdx = base.lastIndexOf('.');
  let stem: string;
  let ext: string;
  if (dotIdx > 0 && dotIdx < base.length - 1) {
    stem = base.slice(0, dotIdx);
    ext = base.slice(dotIdx + 1).slice(0, 10);
  } else {
    stem = base;
    ext = '';
  }

  const clean = (s: string) =>
    s
      // Replace anything not safe with a hyphen.
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      // Collapse multiple hyphens.
      .replace(/-+/g, '-')
      // Trim leading/trailing hyphens, dots, underscores.
      .replace(/^[-._]+|[-._]+$/g, '');

  const cleanStem = clean(stem);
  const cleanExt = clean(ext);

  let result = cleanExt ? `${cleanStem}.${cleanExt}` : cleanStem;

  if (result.length > MAX_FILENAME_LEN) {
    if (cleanExt) {
      const suffix = `.${cleanExt}`;
      const budget = Math.max(1, MAX_FILENAME_LEN - suffix.length);
      result = `${cleanStem.slice(0, budget)}${suffix}`;
    } else {
      result = result.slice(0, MAX_FILENAME_LEN);
    }
    // Re-trim in case the slice left a trailing hyphen.
    result = result.replace(/-+(\.[A-Za-z0-9]+)?$/, '$1');
  }

  if (!result || result === '.' || /^\.+$/.test(result)) {
    result = 'file';
  }

  return result;
}

export function buildAssetKey(
  type: AssetType,
  filename: string,
  opts: { uuid?: string; now?: Date } = {},
): string {
  const now = opts.now ?? new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const uuid = opts.uuid ?? cryptoRandomUuid();
  const safe = sanitizeFilename(filename);
  return `assets/${type}/${yyyy}/${mm}/${uuid}-${safe}`;
}

function cryptoRandomUuid(): string {
  // Prefer the Web Crypto API (available in Node 19+ and the browser).
  const g = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (g?.randomUUID) return g.randomUUID();
  // Fallback for older runtimes — not used in production but keeps the
  // helper importable from non-node contexts.
  return '00000000-0000-0000-0000-000000000000';
}

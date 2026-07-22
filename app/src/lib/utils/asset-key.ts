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

/**
 * Namespace segment che separa gli allegati della CHAT da tutti gli altri
 * asset caricati (logo, favicon, copertine, watermark, audio della sala
 * d'attesa), che sono e devono restare pubblici.
 *
 * Il prefisso non è cosmetico: è ciò che permette a `/api/assets/[...path]` di
 * applicare un gate SOLO agli allegati di chat senza toccare il serving
 * pubblico. Senza di esso le due famiglie finivano entrambe sotto
 * `assets/image|document/...` e l'unica protezione di un documento condiviso in
 * chat era che l'UUID non fosse indovinabile — cioè nessuna, appena l'URL usciva
 * dalla stanza.
 */
const CHAT_NAMESPACE = 'chat';

const EVENT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/**
 * Chiave di un allegato di chat: `assets/chat/{eventId}/{yyyy}/{mm}/{uuid}-{file}`.
 *
 * L'eventId sta NEL PERCORSO perché è ciò che la rotta di serving usa per
 * decidere "chi può leggere questa chat può vedere questo file". È autoritativo:
 * lo scrive solo la rotta di upload, dopo aver autenticato il mittente su
 * QUELL'evento, quindi nessuno può depositare un blob nel namespace di un altro
 * evento per farselo aprire con il gate sbagliato.
 *
 * Niente segmento `{type}`: il mime autoritativo sta sulla riga ChatMessage, e
 * un segmento in meno significa che l'eventId è sempre nella stessa posizione.
 *
 * @throws se l'eventId non è un UUID — un chiamante che passasse lo slug
 *         produrrebbe una chiave che il parser rifiuta, cioè allegati che
 *         smettono di aprirsi molto dopo essere stati caricati.
 */
export function buildChatAssetKey(
  eventId: string,
  filename: string,
  opts: { uuid?: string; now?: Date } = {},
): string {
  if (!EVENT_ID_RE.test(eventId)) {
    throw new Error(`buildChatAssetKey: eventId must be a UUID, got "${eventId}"`);
  }
  const now = opts.now ?? new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const uuid = opts.uuid ?? cryptoRandomUuid();
  const safe = sanitizeFilename(filename);
  return `assets/${CHAT_NAMESPACE}/${eventId}/${yyyy}/${mm}/${uuid}-${safe}`;
}

/**
 * True quando il percorso servito (la chiave SENZA il prefisso `assets/`, cioè
 * quello che arriva a `/api/assets/[...path]`) cade nel namespace protetto.
 *
 * Deve rispondere true anche a un percorso malformato dentro `chat/`: la rotta
 * nega per default: meglio un 404 su una chiave che non esiste che un varco
 * aperto da una variante di percorso a cui non avevamo pensato.
 */
export function isChatAssetPath(subPath: string): boolean {
  return subPath === CHAT_NAMESPACE || subPath.startsWith(`${CHAT_NAMESPACE}/`);
}

/**
 * Estrae l'eventId proprietario di un percorso nel namespace chat, o null se il
 * percorso non è del namespace / è malformato (segmento non-UUID, nessun file
 * dopo l'evento). Il chiamante tratta null come "non servire".
 */
export function chatAssetEventId(subPath: string): string | null {
  if (!isChatAssetPath(subPath)) return null;
  const [, eventId, ...rest] = subPath.split('/');
  if (!eventId || !EVENT_ID_RE.test(eventId)) return null;
  // Serve almeno un segmento oltre all'evento: `chat/<uuid>/` non è un blob.
  if (rest.length === 0 || rest[rest.length - 1] === '') return null;
  return eventId;
}

function cryptoRandomUuid(): string {
  // Prefer the Web Crypto API (available in Node 19+ and the browser).
  const g = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (g?.randomUUID) return g.randomUUID();
  // Fallback for older runtimes — not used in production but keeps the
  // helper importable from non-node contexts.
  return '00000000-0000-0000-0000-000000000000';
}

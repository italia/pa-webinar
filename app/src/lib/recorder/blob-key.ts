/**
 * Confinamento delle object key che il recorder può far firmare
 * (`POST /api/internal/recorder-upload-url`, ADR-013 Fase 3).
 *
 * Quella rotta consegna un PUT firmato su storage CONDIVISO: la key è l'unica
 * cosa che decide dove finiranno quei byte, e questa funzione è l'unico
 * controllo fra il recorder e il bucket.
 *
 * Un `blobKey.startsWith(prefix)` non basta: è un confronto fra STRINGHE, non
 * fra path. `recordings/multitrack/<ev>/<rec>/../../../mix.mp4` inizia col
 * prefisso giusto e punta fuori dalla cartella non appena qualcuno normalizza
 * il path — e lungo la catena qualcuno normalizza quasi sempre (il parsing
 * WHATWG dell'URL nel client che esegue il PUT, i gateway S3-compatibili, i
 * reverse proxy davanti allo storage). Lo stesso vale per le forme codificate
 * (`%2e%2e`, `%2f`), per i backslash e per i segmenti vuoti delle doppie barre.
 * Non possiamo sapere quale provider normalizza cosa, quindi non lasciamo
 * passare nulla di ambiguo: solo un path relativo di segmenti "piatti".
 *
 * Alfabeto ammesso = quello che il recorder produce davvero
 * (`sanitizeSegment` in `infra/recorder/src/paths.ts`: alfanumerici, `_`, `-`)
 * più il punto per le estensioni (`.opus`, `tracks.json`). Un segmento non può
 * iniziare per punto, così `.` e `..` sono esclusi per costruzione.
 */

const SEGMENT_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/**
 * Profondità massima sotto il prefisso. Il layout dell'ADR ne usa uno solo
 * (`audio/<traccia>.opus`, `tracks.json`); il margine serve a non rompere
 * un'evoluzione del layout, non a permettere alberi arbitrari.
 */
const MAX_DEPTH = 4;

/**
 * True se `blobKey` sta *davvero* dentro la cartella `prefix` (che deve finire
 * con `/`), cioè se è il prefisso seguito da un path relativo di segmenti
 * piatti e non ambigui. Volutamente pura: nessun I/O, testabile dalla rotta.
 */
export function isConfinedBlobKey(blobKey: string, prefix: string): boolean {
  // Un prefisso senza `/` finale renderebbe "confinata" anche una cartella
  // sorella con lo stesso inizio (`…/rec-1-evil/`): è un errore del chiamante.
  if (!prefix.endsWith('/')) return false;
  if (!blobKey.startsWith(prefix)) return false;

  const relative = blobKey.slice(prefix.length);
  // La cartella stessa non è un oggetto scrivibile.
  if (relative.length === 0) return false;

  const segments = relative.split('/');
  if (segments.length > MAX_DEPTH) return false;
  return segments.every((segment) => SEGMENT_RE.test(segment));
}

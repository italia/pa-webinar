/**
 * La richiesta dell'elenco dei materiali della sala (MaterialPanel), fuori dal
 * componente perché si possa verificare senza caricare design-react-kit.
 *
 * Chi ha un token di sala lo manda sempre. Il server allarga l'elenco solo per
 * il token moderatore (lib/events/material-access); per un evento protetto da
 * password, però, il token dell'iscritto o del relatore è anche la prova che
 * chi chiede sta nella stanza: senza, vedrebbe l'elenco solo chi ha inserito
 * la password in questo browser. L'ospite non ha token: vale il cookie della
 * password.
 */
export function materialsListKey(eventSlug: string, token: string): [string, string] {
  return [`/api/events/${eventSlug}/materials`, token];
}

/** Fetcher SWR per `materialsListKey`. `Bearer ` vuoto non è un'identità:
 *  senza token, nessun header. */
export function fetchMaterials<T>([url, token]: readonly [string, string]): Promise<T> {
  return fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined).then(
    (r) => r.json() as Promise<T>,
  );
}

// ── Caricamento di un file dalla sala ────────────────────────────────────────

/** Perché un caricamento non è andato: ognuno ha il suo messaggio (`materials.errors.*`). */
export type MaterialUploadError =
  | 'fileTooLarge'
  | 'fileTooLargeForServer'
  | 'fileType'
  | 'uploadUnavailable'
  | 'quotaExceeded'
  | 'uploadBusy'
  | 'generic';

/**
 * Il controllo che il browser può fare prima di spedire: tipo e peso, con la
 * stessa regola del server (MATERIAL_FILE_* in lib/validation/materials).
 * Evita di caricare 25 MB per sentirsi dire di no; il server ricontrolla
 * comunque, anche sui byte veri.
 */
export function checkMaterialFile(
  file: { type: string; size: number },
  allowedTypes: readonly string[],
  maxBytes: number,
): MaterialUploadError | null {
  if (!allowedTypes.includes(file.type)) return 'fileType';
  if (file.size > maxBytes) return 'fileTooLarge';
  return null;
}

/**
 * L'errore da mostrare per una risposta non riuscita di POST .../materials/upload.
 *
 * Un 413 può venire da due posti: dall'app, che applica il limite dei
 * materiali e risponde con il codice `PAYLOAD_TOO_LARGE`, o da un proxy
 * davanti all'app con un limite più basso, che risponde senza quel codice.
 * Nel secondo caso il limite dei materiali non è quello che ha fermato il
 * file, e citarlo sarebbe sbagliato.
 *
 * Un 409 con `MATERIALS_QUOTA_EXCEEDED` è il tetto di file per evento; un 429
 * è il limite per minuto o il server che sta già ricevendo altri file: in
 * entrambi i casi basta riprovare fra poco.
 */
export function uploadErrorFromStatus(status: number, code?: string): MaterialUploadError {
  if (status === 413) return code === 'PAYLOAD_TOO_LARGE' ? 'fileTooLarge' : 'fileTooLargeForServer';
  if (status === 415) return 'fileType';
  if (status === 503) return 'uploadUnavailable';
  if (status === 409 && code === 'MATERIALS_QUOTA_EXCEEDED') return 'quotaExceeded';
  if (status === 429) return 'uploadBusy';
  return 'generic';
}

/**
 * Carica `file` come materiale dell'evento (POST
 * /api/events/[slug]/materials/upload). Il token moderatore viaggia come
 * Bearer, come per l'aggiunta di un link; il Content-Type multipart lo mette
 * il browser, con il suo separatore.
 */
export async function uploadMaterialFile(
  eventSlug: string,
  token: string,
  input: { file: File; title: string; description: string },
): Promise<MaterialUploadError | null> {
  const form = new FormData();
  form.append('file', input.file);
  if (input.title) form.append('title', input.title);
  if (input.description) form.append('description', input.description);
  const res = await fetch(`/api/events/${eventSlug}/materials/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (res.ok) return null;
  let code: string | undefined;
  try {
    code = ((await res.json()) as { code?: string }).code;
  } catch {
    // Risposta non JSON (un proxy): conta solo lo stato.
  }
  return uploadErrorFromStatus(res.status, code);
}

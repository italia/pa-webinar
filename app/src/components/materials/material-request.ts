/** Un materiale come lo restituisce GET /api/events/[slug]/materials. */
export interface RoomMaterial {
  id: string;
  type: string;
  title: string;
  url: string;
  description: string | null;
  /** Peso in byte dei file caricati (type FILE); null per i link. */
  fileSize?: number | null;
  /** Tipo verificato al caricamento (FILE): decide icona ed etichetta. */
  mimeType?: string | null;
  /** ALWAYS | BEFORE | DURING | AFTER. Il server filtra già per il pubblico;
   *  al moderatore, che vede tutto, serve a sapere cosa la sala NON vede. */
  visibility?: string;
  /** Il nome di chi l'ha aggiunto, o null quando la riga non ne porta uno
   *  (lib/events/material-author): allora si mostra una dicitura tradotta. */
  addedBy: string | null;
  createdAt: string;
  /** Quante volte è stato aperto o scaricato: arriva solo a chi conduce. */
  openCount?: number;
}

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

// ── Modifica dalla sala ──────────────────────────────────────────────────────

/** Il corpo di PATCH .../materials/[id]: solo i campi da cambiare. */
export interface MaterialPatch {
  title?: string;
  description?: string | null;
  visibility?: string;
}

/**
 * Dal modulo di modifica al corpo della richiesta: solo ciò che è cambiato
 * rispetto alla riga, null se non è cambiato niente (e allora non si chiama il
 * server). Una fase che il modulo non sa mostrare (un valore sconosciuto nel
 * database) non parte se non la si è scelta: salvare un titolo non deve
 * cambiare a chi è visibile il materiale.
 */
export function materialPatch(
  original: Pick<RoomMaterial, 'title' | 'description' | 'visibility'>,
  draft: { title: string; description: string; visibility: string },
): MaterialPatch | null {
  const patch: MaterialPatch = {};
  const title = draft.title.trim();
  if (title !== original.title) patch.title = title;
  const description = draft.description.trim();
  if (description !== (original.description ?? '')) patch.description = description || null;
  if (draft.visibility !== (original.visibility ?? '')) patch.visibility = draft.visibility;
  return Object.keys(patch).length > 0 ? patch : null;
}

// ── Conteggio delle aperture ─────────────────────────────────────────────────

/**
 * Dice al server che un materiale è stato aperto o scaricato (POST
 * .../materials/[id]/opened), senza aspettare: il link apre la destinazione da
 * solo, e questa richiesta non deve né ritardarlo né fermarlo. `keepalive`
 * la lascia partire anche se la pagina cambia subito dopo il clic.
 *
 * Il token di sala, quando c'è, fa da identità per non contare due volte lo
 * stesso clic; senza (la scheda pubblica) decide il server. Il corpo è un JSON
 * vuoto dichiarato come tale: il server conta solo richieste così, che un'altra
 * pagina non può mandare senza il permesso CORS.
 */
export function markMaterialOpened(eventSlug: string, materialId: string, token?: string): void {
  const url = `/api/events/${encodeURIComponent(eventSlug)}/materials/${encodeURIComponent(materialId)}/opened`;
  try {
    fetch(url, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: '{}',
    }).catch(() => {
      // Il conteggio è indicativo e la risposta è sempre vuota: una richiesta
      // persa non ha niente da dire a chi ha cliccato, che ha già il suo
      // materiale aperto.
    });
  } catch {
    // Un browser senza fetch o che rifiuta la richiesta: idem.
  }
}

/**
 * I gestori da mettere sul link di un materiale: il clic normale e il clic
 * centrale (che apre in un'altra scheda senza passare da `click`). Il clic
 * destro non conta: apre il menu, non il materiale.
 */
export function materialOpenHandlers(onOpen: () => void): {
  onClick: () => void;
  onAuxClick: (e: { button: number }) => void;
} {
  return {
    onClick: onOpen,
    onAuxClick: (e) => {
      if (e.button === 1) onOpen();
    },
  };
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

export interface UploadOptions {
  /** Quanto del file e' partito, da 0 a 1: per la barra di avanzamento. */
  onProgress?: (fraction: number) => void;
  /** Annulla il caricamento in corso: l'esito e' 'aborted', non un errore. */
  signal?: AbortSignal;
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
  input: { file: File; title: string; description: string; visibility?: string },
  opts: UploadOptions = {},
): Promise<MaterialUploadError | 'aborted' | null> {
  const form = new FormData();
  form.append('file', input.file);
  if (input.title) form.append('title', input.title);
  if (input.description) form.append('description', input.description);
  if (input.visibility) form.append('visibility', input.visibility);
  const url = `/api/events/${eventSlug}/materials/upload`;
  if (opts.signal?.aborted) return 'aborted';

  // L'avanzamento dell'invio lo da' solo XMLHttpRequest: fetch non espone
  // quanto del corpo e' partito.
  if (opts.onProgress && typeof XMLHttpRequest !== 'undefined') {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      const annulla = () => xhr.abort();
      // A richiesta finita l'annullamento non serve piu': si stacca.
      const fine = (esito: MaterialUploadError | 'aborted' | null) => {
        opts.signal?.removeEventListener('abort', annulla);
        resolve(esito);
      };
      xhr.open('POST', url);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) opts.onProgress?.(e.loaded / e.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          opts.onProgress?.(1);
          fine(null);
          return;
        }
        let code: string | undefined;
        try {
          code = (JSON.parse(xhr.responseText) as { code?: string }).code;
        } catch {
          // Risposta non JSON (un proxy): conta solo lo stato.
        }
        fine(uploadErrorFromStatus(xhr.status, code));
      };
      xhr.onerror = () => fine('generic');
      xhr.onabort = () => fine('aborted');
      opts.signal?.addEventListener('abort', annulla, { once: true });
      xhr.send(form);
    });
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (e) {
    if (opts.signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) return 'aborted';
    throw e;
  }
  if (res.ok) return null;
  let code: string | undefined;
  try {
    code = ((await res.json()) as { code?: string }).code;
  } catch {
    // Risposta non JSON (un proxy): conta solo lo stato.
  }
  return uploadErrorFromStatus(res.status, code);
}

'use client';

/**
 * Il campo «file o link» dell'area admin: un'immagine, un audio o un
 * documento, caricato dal dispositivo oppure indicato con il link di un file
 * gia' pubblicato. Le due strade sono visibili insieme, senza schede: il
 * campo vuoto ha un solo pulsante, «Scegli dal dispositivo», e il riquadro in
 * cui comparira' l'immagine e' anche la zona in cui la si trascina.
 *
 * Due forme. Con `ritaglio` (la copertina) un riquadro nel formato richiesto,
 * largo fino a 30rem; senza, una riga compatta con la miniatura, come la foto
 * di una persona nel wizard. Sotto, il link.
 *
 * Il campo e' controllato: il valore e' del modulo che lo usa (`value`), che
 * riceve le modifiche da `onChange`. Il caricamento passa da
 * POST /api/admin/assets/upload-url?type=…; tipo e peso si controllano prima
 * nel browser con le stesse regole della rotta (lib/uploads/limits), il
 * caricamento mostra l'avanzamento e si annulla. Alla fine vale il modulo di
 * quel momento, non quello di quando si e' scelto il file: `onChange` si
 * chiama sempre nella sua versione piu' recente, e mai dopo che il campo e'
 * uscito dal modulo (il caricamento in corso si interrompe).
 *
 * Dove non si puo' caricare (nessuno storage, o il solo link di conduzione
 * senza sessione dello staff: `uploads-availability`) resta il link, con il
 * motivo. Il testo degli errori del server non si mostra mai: conta lo stato.
 */

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { Icon } from '@/components/ui/icon';
import ImageCropDialog, {
  riduciImmagine,
  SOGLIA_PICCOLA,
  type Ritaglio,
} from '@/components/ui/image-crop-dialog';
import {
  useUploadsAvailable,
  useUploadsReason,
} from '@/components/ui/uploads-availability';
import { IMMAGINI_ESTERNE_AMMESSE } from '@/lib/security/img-src';
import {
  ASSET_MAX_BYTES,
  ASSET_MIME_TYPES,
  formattaPeso,
  tipoAmmesso,
} from '@/lib/uploads/limits';
import { erroreDaRisposta, inviaFile } from '@/lib/uploads/upload-xhr';
import { withScheme } from '@/lib/utils/with-scheme';
import type { AssetUploadResponse } from '@/lib/validation/schemas';

export type FileOrUrlAssetType = 'image' | 'audio' | 'document';

export interface FileOrUrlInputProps {
  id: string;
  label: string;
  value: string | null;
  onChange: (next: string | null) => void;
  /**
   * Solo per un file caricato davvero (non per un link incollato), con i dati
   * del caricamento (tipo, peso, nome, chiave nello storage). Arriva dopo
   * `onChange`. Chi tiene la provenienza del file (i materiali, FILE con il
   * percorso del blob) lo usa; un `onChange` successivo da un link o da una
   * rimozione vuol dire «non e' piu' un file caricato».
   */
  onUpload?: (meta: AssetUploadResponse) => void;
  assetType: FileOrUrlAssetType;
  /** Sostituisce l'attributo `accept` del selettore di file. */
  accept?: string;
  helpText?: string;
  disabled?: boolean;
  /** Aggiunge l'asterisco all'etichetta. */
  required?: boolean;
  /**
   * Se il caricamento di file e' disponibile. Di norma non serve passarlo:
   * lo fornisce l'area admin dal server (`UploadsAvailabilityProvider`).
   */
  uploadsEnabled?: boolean;
  /**
   * Avvisa se l'immagine non comparirebbe nelle pagine del portale. Falso per
   * le immagini che non finiscono nelle pagine (l'anteprima per i social la
   * scaricano i loro server).
   */
  avvisoImmagineEsterna?: boolean;
  /**
   * La regola «questa immagine si vede nelle pagine». Per difetto: servita
   * dal portale stesso o da un sito ammesso dalla CSP. Chi pubblica con una
   * regola sua (i loghi delle persone: solo `/api/assets/`) passa quella,
   * cosi' l'avviso e la pagina pubblica non si contraddicono.
   */
  immagineAmmessa?: (url: string) => boolean | string | null;
  /**
   * Formato richiesto per le immagini caricate (es. la copertina 16:9): un
   * file di altro formato si ritaglia nel browser prima di caricarlo, e il
   * campo diventa un riquadro di quella forma.
   */
  ritaglio?: Ritaglio;
  /**
   * Mentre un file va al server (true) e quando ha finito (false), come nel
   * campo della foto di una persona. Un campo tolto dal modulo interrompe il
   * caricamento (una riga cancellata non deve ricevere il file): chi lo usa
   * puo' aspettare la fine prima di cambiare passo o scheda.
   */
  onBusy?: (inCaricamento: boolean) => void;
}

/** Le immagini che si ritagliano: le altre (SVG, GIF animate) passano come sono. */
const RITAGLIABILI = ['image/jpeg', 'image/png', 'image/webp'];
/** Scarto di formato sotto cui un'immagine e' gia' giusta e non si ritaglia. */
const TOLLERANZA_FORMATO = 0.01;
/** Oltre questa misura (sulla larghezza richiesta) un'immagine gia' nel formato
 *  giusto si riduce prima del caricamento. */
const RIDUZIONE_OLTRE = 1.25;
/** Senza battute per questo tempo, il link scritto si prova nell'anteprima. */
const ATTESA_ANTEPRIMA_MS = 600;

/** Larghezza e altezza di un'immagine scelta, lette nel browser. */
function misuraImmagine(file: File): Promise<{ w: number; h: number } | null> {
  return new Promise((risolvi) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      risolvi({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      risolvi(null);
    };
    img.src = url;
  });
}

/**
 * Un link che si puo' salvare: niente spazi, http, https o `data:` (le
 * immagini piccole incorporate, come una favicon), e per il web un nome di
 * host vero (con un punto, `localhost` o un indirizzo IPv6). Piu' severo del
 * browser, che accetta «https://pagina non valida» e lo lascia fallire al
 * salvataggio, lontano dal campo.
 */
export function linkValido(v: string): boolean {
  if (!v || /\s/.test(v)) return false;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return false;
  }
  if (u.protocol === 'data:') return true;
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname;
  return (
    host === 'localhost' ||
    host.startsWith('[') ||
    (host.includes('.') && !host.endsWith('.'))
  );
}

/** «16:9», «1:1»: il rapporto del riquadro come lo si dice. */
export function formatoLeggibile(rapporto: number): string {
  for (let b = 1; b <= 20; b++) {
    const a = Math.round(rapporto * b);
    if (a > 0 && Math.abs(a / b - rapporto) < 0.005) return `${a}:${b}`;
  }
  return rapporto.toFixed(2);
}

/** Un file servito dal portale (`/api/assets/…`): conta come caricato. */
function daCaricamento(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url, 'http://app.invalid').pathname.startsWith('/api/assets/');
  } catch {
    return false;
  }
}

/**
 * Le pagine del portale mostrano solo immagini servite da lui stesso o dai
 * pochi siti ammessi dalla CSP: un'immagine indicata con l'indirizzo di un
 * altro sito si salva ma non compare. «Lui stesso» e' l'origine da cui si
 * sta amministrando: i file caricati portano l'indirizzo pubblico del
 * portale, lo stesso da cui di solito si amministra. Il solo percorso
 * /api/assets/ non basta: lo ha anche un'altra installazione.
 */
function immagineDaAltroSito(
  url: string | null | undefined,
  origine: string | null
): boolean {
  if (!url || !origine) return false;
  try {
    const u = new URL(url, origine);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (u.origin === origine) return false;
    return !IMMAGINI_ESTERNE_AMMESSE.includes(u.origin);
  } catch {
    return false;
  }
}

/** Il nome del file nell'indirizzo, senza l'identificativo che gli mette
 *  davanti lo storage; nulla per un'immagine incorporata. */
function nomeDaUrl(url: string): string | null {
  if (url.startsWith('data:')) return null;
  try {
    const u = new URL(url, 'http://app.invalid');
    const ultimo = u.pathname.split('/').filter(Boolean).pop();
    if (!ultimo) return u.host || null;
    return decodeURIComponent(ultimo).replace(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i,
      ''
    );
  } catch {
    return url;
  }
}

function estensione(nome: string | null): string {
  const m = nome?.match(/\.([a-z0-9]{1,5})$/i);
  return m?.[1]?.toLowerCase() ?? '';
}

const ICONE_DOCUMENTO: Record<string, string> = {
  pdf: 'it-file-pdf',
  docx: 'it-file-docx',
  pptx: 'it-file-slides',
  xlsx: 'it-file-xlsx',
  txt: 'it-file-txt',
};

function iconaFile(tipo: FileOrUrlAssetType, nome: string | null): string {
  if (tipo === 'audio') return 'it-file-audio';
  if (tipo === 'image') return 'it-file-image';
  return ICONE_DOCUMENTO[estensione(nome)] ?? 'it-file';
}

function haFile(e: { dataTransfer: DataTransfer | null }): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

interface Invio {
  nome: string;
  percentuale: number;
  /** L'immagine scelta, mostrata subito dal browser (`blob:`): mai al modulo. */
  locale: string | null;
}

interface Caricato {
  url: string;
  nome: string;
  peso: number;
  mime: string;
  piccola: boolean;
}

interface Errore {
  testo: string;
  /** Il file da rimandare con «Riprova» (rete o server giu'), se c'e'. */
  riprova: { file: File; piccola: boolean } | null;
}

export default function FileOrUrlInput({
  id,
  label,
  value,
  onChange,
  onUpload,
  assetType,
  accept,
  helpText,
  disabled = false,
  required,
  uploadsEnabled,
  avvisoImmagineEsterna = true,
  immagineAmmessa,
  ritaglio,
  onBusy,
}: FileOrUrlInputProps) {
  const t = useTranslations('admin.fileOrUrl');
  const locale = useLocale();
  const reactId = useId();
  // Il prefisso `${id}-url-` e' del solo campo del link: le impostazioni del
  // sito ci portano il fuoco dopo un errore di salvataggio.
  const linkId = `${id}-url-${reactId}`;
  const fileId = `${id}-file-${reactId}`;
  const etichettaId = `${id}-etichetta-${reactId}`;
  const aiutoId = `${id}-aiuto-${reactId}`;
  const formatiId = `${id}-formati-${reactId}`;
  const erroreId = `${id}-errore-${reactId}`;
  const erroreLinkId = `${id}-errorelink-${reactId}`;
  const avvisoId = `${id}-avviso-${reactId}`;
  const scegliId = `${id}-scegli-${reactId}`;
  const sostituisciId = `${id}-sostituisci-${reactId}`;
  const rimuoviId = `${id}-rimuovi-${reactId}`;
  const annullaId = `${id}-annulla-${reactId}`;

  const gruppoRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const scegliRef = useRef<HTMLButtonElement>(null);
  const sostituisciRef = useRef<HTMLButtonElement>(null);
  const riprovaRef = useRef<HTMLButtonElement>(null);

  const disponibileDalServer = useUploadsAvailable();
  const motivoDalServer = useUploadsReason();
  const puoCaricare = uploadsEnabled ?? disponibileDalServer;
  const motivo = puoCaricare ? null : (motivoDalServer ?? 'storage');

  // Alla fine di un caricamento vale il modulo di quel momento: le funzioni
  // del chiamante si leggono sempre nella versione dell'ultimo disegno.
  const avvisa = useRef(onChange);
  const avvisaCaricamento = useRef(onUpload);
  useEffect(() => {
    avvisa.current = onChange;
    avvisaCaricamento.current = onUpload;
  }, [onChange, onUpload]);

  // Uscito il campo dal modulo, il caricamento si interrompe e non scrive
  // piu' niente: ne' nel modulo, ne' nello stato.
  const montato = useRef(true);
  const controllo = useRef<AbortController | null>(null);
  const blobAperto = useRef<string | null>(null);
  const attesaLink = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    montato.current = true;
    return () => {
      montato.current = false;
      controllo.current?.abort();
      if (blobAperto.current) URL.revokeObjectURL(blobAperto.current);
      if (attesaLink.current) clearTimeout(attesaLink.current);
    };
  }, []);

  const [draft, setDraft] = useState(() => (value && !daCaricamento(value) ? value : ''));
  // Il link e' stato toccato da chi compila: solo allora l'uscita dal campo
  // conta. Un'uscita da un campo vuoto mai toccato non cancella il file.
  const [toccato, setToccato] = useState(false);
  // Il valore viene da un link (scritto qui, o arrivato da fuori e non
  // servito dal portale): la casella del link resta in vista.
  const [daLink, setDaLink] = useState(() => !!value && !daCaricamento(value));
  // L'indirizzo mostrato nel riquadro: segue il valore, ma per un link scritto
  // a mano solo quando chi scrive si ferma (niente anteprime a ogni battuta).
  const [anteprima, setAnteprima] = useState<string | null>(value);
  const [erroreLink, setErroreLink] = useState<string | null>(null);
  const [errore, setErrore] = useState<Errore | null>(null);
  const [invio, setInvio] = useState<Invio | null>(null);
  const [preparando, setPreparando] = useState(false);
  const [daRitagliare, setDaRitagliare] = useState<File | null>(null);
  const [caricato, setCaricato] = useState<Caricato | null>(null);
  const [misura, setMisura] = useState<{ src: string; w: number; h: number } | null>(
    null
  );
  const [rotta, setRotta] = useState<string | null>(null);
  const [sopra, setSopra] = useState(false);
  const [annuncio, setAnnuncio] = useState('');
  const [fuoco, setFuoco] = useState<'sostituisci' | 'scegli' | 'riprova' | null>(null);
  const incollato = useRef(false);
  // Il link che si sta scrivendo, per l'anteprima rimandata: se nel frattempo
  // il campo e' stato svuotato o ha preso un altro valore, non vale piu'.
  const bozza = useRef(draft);
  useEffect(() => {
    bozza.current = draft;
  }, [draft]);

  // L'origine si legge dopo il montaggio: sul server non c'e', e l'avviso
  // disegnato solo nel browser non deve far divergere il primo disegno.
  const [origine, setOrigine] = useState<string | null>(null);
  useEffect(() => {
    setOrigine(window.location.origin);
  }, []);

  // Il valore puo' cambiare da fuori (dati del modulo arrivati dopo il primo
  // disegno, un modello, una bozza). Se e' l'eco di quello che si sta
  // scrivendo nel link, la casella resta com'e': non si riscrive chi digita.
  const [valoreVisto, setValoreVisto] = useState(value);
  if (value !== valoreVisto) {
    setValoreVisto(value);
    if ((value ?? '') !== String(withScheme(draft))) {
      const link = !!value && !daCaricamento(value);
      setDraft(link ? (value ?? '') : '');
      setDaLink(link);
      setToccato(false);
      setAnteprima(value);
      setErroreLink(null);
    }
  }

  // Il percorso /api/assets/ di un'altra installazione non e' un file caricato
  // qui: e' un link, e la casella lo mostra per poterlo correggere. L'origine
  // si conosce solo nel browser, quindi lo si decide dopo il montaggio.
  useEffect(() => {
    if (!origine || !value || daLink || !daCaricamento(value)) return;
    try {
      const u = new URL(value, origine);
      if (u.origin !== origine) {
        setDraft(value);
        setDaLink(true);
      }
    } catch {
      /* indirizzo illeggibile: resta com'e' */
    }
  }, [origine, value, daLink]);

  // Il fuoco, dopo un caricamento riuscito o una rimozione: sul pulsante che
  // ha preso il posto di quello premuto.
  useEffect(() => {
    if (!fuoco) return;
    const el =
      fuoco === 'sostituisci'
        ? (sostituisciRef.current ?? scegliRef.current)
        : fuoco === 'riprova'
          ? (riprovaRef.current ?? scegliRef.current ?? sostituisciRef.current)
          : (scegliRef.current ?? sostituisciRef.current ?? linkRef.current);
    el?.focus();
    setFuoco(null);
  }, [fuoco]);

  // Un file lasciato fuori dal riquadro non deve aprirsi nella scheda al posto
  // del modulo. Non ferma la propagazione: le altre zone di rilascio
  // ricevono l'evento come prima.
  useEffect(() => {
    if (!puoCaricare) return;
    const trattieni = (e: globalThis.DragEvent) => {
      if (haFile(e)) e.preventDefault();
    };
    window.addEventListener('dragover', trattieni);
    window.addEventListener('drop', trattieni);
    return () => {
      window.removeEventListener('dragover', trattieni);
      window.removeEventListener('drop', trattieni);
    };
  }, [puoCaricare]);

  const occupato = preparando || !!invio || !!daRitagliare;
  // Il caricamento in corso, a chi usa il campo: finisce anche se il campo
  // esce dal modulo prima della risposta.
  const occupatoPer = useRef(onBusy);
  useEffect(() => {
    occupatoPer.current = onBusy;
  }, [onBusy]);
  const inViaggio = !!invio;
  useEffect(() => {
    if (!inViaggio) return;
    const avvisaOccupato = occupatoPer.current;
    avvisaOccupato?.(true);
    return () => avvisaOccupato?.(false);
  }, [inViaggio]);
  const immagine = assetType === 'image';
  const riquadro = !!ritaglio && immagine;
  const tipi =
    assetType === 'image'
      ? t('typesImage')
      : assetType === 'audio'
        ? t('typesAudio')
        : t('typesDocument');
  const pesoMassimo = formattaPeso(ASSET_MAX_BYTES[assetType], locale);
  const formati = t('formats', { types: tipi, max: pesoMassimo });

  const ammessa = (url: string): boolean =>
    immagineAmmessa ? Boolean(immagineAmmessa(url)) : !immagineDaAltroSito(url, origine);
  const esterna =
    immagine &&
    avvisoImmagineEsterna &&
    origine !== null &&
    !!anteprima &&
    !ammessa(anteprima);
  // Un'immagine di un altro sito dove l'avviso non serve (l'anteprima per i
  // social): la CSP dell'area admin non la mostrerebbe, quindi niente
  // anteprima rotta, solo il nome.
  const senzaAnteprima =
    immagine && !avvisoImmagineEsterna && immagineDaAltroSito(anteprima, origine);
  // Un'immagine che non si carica. Non vale per quelle di altri siti, che la
  // CSP blocca comunque: per quelle c'e' gia' l'avviso (o il solo nome).
  const anteprimaRotta =
    !!anteprima && rotta === anteprima && !esterna && !senzaAnteprima;
  const caricatoOra = caricato && caricato.url === value ? caricato : null;

  const nomeMostrato = caricatoOra?.nome ?? (anteprima ? nomeDaUrl(anteprima) : null);
  const misuraMostrata = misura && misura.src === anteprima ? misura : null;
  const meta = [
    misuraMostrata
      ? t('pixels', { width: misuraMostrata.w, height: misuraMostrata.h })
      : null,
    caricatoOra ? formattaPeso(caricatoOra.peso, locale) : null,
  ].filter((x): x is string => !!x);
  if (assetType === 'document' && nomeMostrato && estensione(nomeMostrato)) {
    meta.unshift(estensione(nomeMostrato).toUpperCase());
  }
  const nonRitagliata =
    riquadro &&
    !!anteprima &&
    (caricatoOra
      ? caricatoOra.mime === 'image/svg+xml' || caricatoOra.mime === 'image/gif'
      : /\.(svg|gif)([?#]|$)/i.test(anteprima));

  // ── Caricamento ────────────────────────────────────────────────────────

  const messaggioErrore = (
    tipo: ReturnType<typeof erroreDaRisposta>,
    file: File
  ): string => {
    switch (tipo) {
      case 'troppoGrande':
        return t('errorTooBig', {
          name: file.name,
          size: formattaPeso(file.size, locale, { perEccesso: true }),
          max: pesoMassimo,
        });
      case 'tipo':
        return t('errorType', { name: file.name, types: tipi });
      case 'nonDisponibile':
        return t('uploadsUnavailable');
      case 'accesso':
        return t('errorAuth');
      case 'troppi':
        return t('errorRate');
      default:
        return t('errorGeneric');
    }
  };

  /** Il fuoco era nel campo, o e' caduto sulla pagina perche' il pulsante
   *  premuto non c'e' piu': solo allora lo si sposta. */
  const fuocoNelCampo = () => {
    const attivo = document.activeElement;
    return !attivo || attivo === document.body || !!gruppoRef.current?.contains(attivo);
  };

  const fermaAttesaLink = () => {
    if (attesaLink.current) clearTimeout(attesaLink.current);
    attesaLink.current = null;
  };

  const invia = async (file: File, piccola = false) => {
    if (file.size > ASSET_MAX_BYTES[assetType]) {
      setErrore({ testo: messaggioErrore('troppoGrande', file), riprova: null });
      return;
    }
    fermaAttesaLink();
    const locale_ = immagine ? URL.createObjectURL(file) : null;
    blobAperto.current = locale_;
    const ctrl = new AbortController();
    controllo.current = ctrl;
    setErrore(null);
    setInvio({ nome: file.name, percentuale: 0, locale: locale_ });
    setAnnuncio(t('uploadingSr', { name: file.name }));
    const corpo = new FormData();
    corpo.append('file', file);
    const esito = await inviaFile(
      `/api/admin/assets/upload-url?type=${assetType}`,
      corpo,
      {
        signal: ctrl.signal,
        onProgress: (p) => {
          if (montato.current) setInvio((i) => (i ? { ...i, percentuale: p } : i));
        },
      }
    );
    // Il campo e' uscito dal modulo: l'invio e' gia' interrotto, niente da dire.
    if (!montato.current) return;
    controllo.current = null;
    if (locale_) URL.revokeObjectURL(locale_);
    blobAperto.current = null;
    setInvio(null);

    if (esito.tipo === 'annullato') {
      setAnnuncio(t('cancelledSr'));
      setFuoco('scegli');
      return;
    }
    // Chi e' gia' passato a un altro campo non viene riportato indietro.
    const fuocoQui = fuocoNelCampo();
    const fallito = (testo: string, riprova: boolean) => {
      setErrore({ testo, riprova: riprova ? { file, piccola } : null });
      // Il pulsante «Annulla caricamento» non c'e' piu': il fuoco va sull'azione
      // che resta, «Riprova» se c'e'.
      if (fuocoQui) setFuoco('riprova');
    };
    if (esito.tipo === 'rete') {
      fallito(t('errorGeneric'), true);
      return;
    }
    if (esito.tipo === 'errore') {
      const tipo = erroreDaRisposta(esito.status, esito.codice);
      fallito(messaggioErrore(tipo, file), tipo === 'generico' && esito.status >= 500);
      return;
    }
    const dati = esito.corpo as Partial<AssetUploadResponse> | null;
    if (!dati || typeof dati.url !== 'string') {
      fallito(t('errorGeneric'), true);
      return;
    }
    const nome = dati.filename || file.name;
    avvisa.current(dati.url);
    avvisaCaricamento.current?.(dati as AssetUploadResponse);
    setDraft('');
    setToccato(false);
    setDaLink(false);
    setAnteprima(dati.url);
    setErroreLink(null);
    setCaricato({
      url: dati.url,
      nome,
      peso: typeof dati.size === 'number' ? dati.size : file.size,
      mime: dati.mime || file.type,
      piccola,
    });
    setAnnuncio(t('uploadedSr', { name: nome }));
    if (fuocoQui) setFuoco('sostituisci');
  };

  // Con un formato richiesto, un'immagine di altro formato passa prima dal
  // ritaglio; una gia' giusta si carica com'e' (un JPEG molto piu' grande del
  // necessario, ridotto alla larghezza richiesta). Quelle che non si
  // ritagliano (SVG, GIF) passano come sono.
  const scegli = async (file: File) => {
    if (disabled || occupato) return;
    setErrore(null);
    setErroreLink(null);
    if (!tipoAmmesso(assetType, file.type)) {
      setErrore({ testo: messaggioErrore('tipo', file), riprova: null });
      return;
    }
    if (riquadro && ritaglio && RITAGLIABILI.includes(file.type)) {
      setPreparando(true);
      const m = await misuraImmagine(file);
      if (!montato.current) return;
      if (m && Math.abs(m.w / m.h / ritaglio.rapporto - 1) > TOLLERANZA_FORMATO) {
        setPreparando(false);
        setDaRitagliare(file);
        return;
      }
      // Solo i JPEG: un PNG o un WebP possono avere parti trasparenti, che il
      // JPEG ridotto riempirebbe di bianco senza dirlo.
      const ridotta =
        file.type === 'image/jpeg' && m && m.w > ritaglio.larghezza * RIDUZIONE_OLTRE
          ? await riduciImmagine(file, ritaglio.larghezza)
          : null;
      if (!montato.current) return;
      setPreparando(false);
      void invia(ridotta ?? file, !!m && m.w < ritaglio.larghezza * SOGLIA_PICCOLA);
      return;
    }
    void invia(file);
  };

  const apriSelettore = () => {
    if (disabled || occupato) return;
    inputRef.current?.click();
  };

  const onFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Lo stesso file si puo' scegliere di nuovo (dopo un ritaglio annullato).
    e.target.value = '';
    if (file) void scegli(file);
  };

  // ── Trascinamento ──────────────────────────────────────────────────────

  const trascinaDentro = (e: DragEvent<HTMLDivElement>) => {
    if (!puoCaricare || disabled || !haFile(e)) return;
    e.preventDefault();
    setSopra(true);
  };
  const trascinaSopra = (e: DragEvent<HTMLDivElement>) => {
    if (!puoCaricare || !haFile(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = disabled || occupato ? 'none' : 'copy';
  };
  // Mentre ci si trascina sopra un file, un velo vuoto copre il riquadro e
  // riceve tutti gli eventi: si esce dal riquadro solo uscendo dal velo. Il
  // contenuto sotto cambia (testo, pulsanti), e un elemento tolto mentre il
  // puntatore ci passa sopra non direbbe mai che lo si e' lasciato.
  const trascinaFuori = (e: DragEvent<HTMLDivElement>) => {
    if (!puoCaricare) return;
    if ((e.target as HTMLElement).classList?.contains('campo-file__cattura'))
      setSopra(false);
  };
  const rilascia = (e: DragEvent<HTMLDivElement>) => {
    if (!puoCaricare) return;
    e.preventDefault();
    setSopra(false);
    if (disabled || occupato) return;
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    if (files.length > 1) {
      setErroreLink(null);
      setErrore({ testo: t('errorOneFile'), riprova: null });
      return;
    }
    const file = files[0];
    if (file) void scegli(file);
  };

  // Un clic sul riquadro vuoto apre il selettore (col mouse; da tastiera c'e'
  // il pulsante). Non i clic sui controlli che ci sono dentro.
  const cliccabile =
    puoCaricare && !disabled && !occupato && (!anteprima || esterna || anteprimaRotta);
  const clicSulRiquadro = (e: MouseEvent<HTMLDivElement>) => {
    if (!cliccabile) return;
    if ((e.target as HTMLElement).closest('button, a, input, audio')) return;
    apriSelettore();
  };

  // ── Link ───────────────────────────────────────────────────────────────

  /** Prova il link nell'anteprima; con `mostraErrore` dice anche se non va. */
  const provaLink = (raw: string, mostraErrore: boolean) => {
    if (attesaLink.current) clearTimeout(attesaLink.current);
    attesaLink.current = null;
    const v = String(withScheme(raw));
    if (!v) {
      setErroreLink(null);
      setAnteprima(null);
      return;
    }
    if (!linkValido(v)) {
      if (mostraErrore) setErroreLink(t('invalidUrl'));
      return;
    }
    setErroreLink(null);
    setAnteprima(v);
    if (immagine && avvisoImmagineEsterna && origine !== null && !ammessa(v)) {
      setAnnuncio(
        `${t('externalTitle')}. ${puoCaricare ? t('externalHint') : t('externalHintLink')}`
      );
    }
  };

  // Il modulo riceve il link mentre lo si scrive (un Invio nel modulo salva
  // quello che si vede), ma solo se e' valido; la casella non si riscrive.
  const onLink = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setDraft(raw);
    setToccato(true);
    setDaLink(true);
    setErrore(null);
    setErroreLink(null);
    const v = String(withScheme(raw));
    if (!v) avvisa.current(null);
    else if (linkValido(v)) avvisa.current(v);
    if (incollato.current) {
      incollato.current = false;
      provaLink(raw, true);
      return;
    }
    if (attesaLink.current) clearTimeout(attesaLink.current);
    attesaLink.current = setTimeout(() => {
      if (montato.current && bozza.current === raw) provaLink(raw, false);
    }, ATTESA_ANTEPRIMA_MS);
  };

  const esciDalLink = () => {
    if (toccato) provaLink(draft, true);
  };

  const tastoNelLink = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') provaLink(draft, true);
  };

  const rimuovi = () => {
    fermaAttesaLink();
    setErrore(null);
    setErroreLink(null);
    setDraft('');
    setToccato(false);
    setDaLink(false);
    setAnteprima(null);
    setCaricato(null);
    avvisa.current(null);
    setAnnuncio(t('removedSr', { label }));
    setFuoco('scegli');
  };

  // ── Disegno ────────────────────────────────────────────────────────────

  const mostraLink = !puoCaricare || !value || daLink || esterna;
  const etichettaLink = !puoCaricare
    ? t('linkOnly')
    : immagine && avvisoImmagineEsterna
      ? t('linkImagePortal')
      : t('linkAny');
  const titoloTrascina =
    assetType === 'image'
      ? t('dropImage')
      : assetType === 'audio'
        ? t('dropAudio')
        : t('dropFile');
  const testoRilascio = anteprima ? t('dropReleaseReplace') : t('dropRelease');
  const piena = !!anteprima && !esterna && !anteprimaRotta;
  const descriviScegli = [formatiId, errore ? erroreId : null].filter(Boolean).join(' ');
  const descriviLink =
    [erroreLink ? erroreLinkId : null, esterna ? avvisoId : null]
      .filter(Boolean)
      .join(' ') || undefined;

  const pulsanteScegli = (variante: 'primario' | 'secondario') => (
    <button
      ref={scegliRef}
      id={scegliId}
      type="button"
      className={`btn btn-sm ${variante === 'primario' ? 'btn-primary' : 'btn-outline-primary'} campo-file__scegli`}
      onClick={apriSelettore}
      disabled={disabled || occupato}
      aria-labelledby={`${scegliId} ${etichettaId}`}
      aria-describedby={descriviScegli}
    >
      {t('choose')}
    </button>
  );

  const pulsanteRimuovi = (
    <button
      id={rimuoviId}
      type="button"
      className="btn btn-sm btn-link text-danger campo-file__rimuovi"
      onClick={rimuovi}
      disabled={disabled || occupato}
      aria-labelledby={`${rimuoviId} ${etichettaId}`}
    >
      <Icon icon="it-delete" size="xs" color="danger" className="me-1" />
      {t('remove')}
    </button>
  );

  const azioniPiene = (
    <div className="campo-file__azioni">
      {puoCaricare && (
        <button
          ref={sostituisciRef}
          id={sostituisciId}
          type="button"
          className="btn btn-sm btn-outline-primary"
          onClick={apriSelettore}
          disabled={disabled || occupato}
          aria-labelledby={`${sostituisciId} ${etichettaId}`}
          aria-describedby={descriviScegli}
        >
          <Icon icon="it-upload" size="xs" color="primary" className="me-1" />
          {t('replace')}
        </button>
      )}
      {pulsanteRimuovi}
    </div>
  );

  const progresso = invio && (
    <>
      <div
        className="progress campo-file__progresso"
        role="progressbar"
        aria-valuenow={invio.percentuale}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('progressLabel')}
      >
        <div className="progress-bar" style={{ width: `${invio.percentuale}%` }} />
      </div>
      <p className="campo-file__velo-testo">
        {t('uploadingPercent', { percent: invio.percentuale })}
      </p>
      <button
        id={annullaId}
        type="button"
        className="btn btn-sm btn-outline-primary campo-file__annulla"
        onClick={() => controllo.current?.abort()}
        aria-labelledby={`${annullaId} ${etichettaId}`}
      >
        {t('cancelUpload')}
      </button>
    </>
  );

  const notaFormati = (
    <p id={formatiId} className="campo-file__formati">
      {formati}
      {riquadro && ritaglio && (
        <>
          <br />
          {t('cropNote', { format: formatoLeggibile(ritaglio.rapporto) })}
        </>
      )}
    </p>
  );

  const misuraDa = (src: string, img: HTMLImageElement) => {
    if (misura?.src === src || !img.naturalWidth) return;
    setMisura({ src, w: img.naturalWidth, h: img.naturalHeight });
  };
  const immagineAnteprima = (src: string, className?: string) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      // Un'immagine gia' arrivata prima che la pagina diventasse interattiva
      // non manda piu' «load»: la misura si legge subito.
      ref={(el) => {
        if (el?.complete) misuraDa(src, el);
      }}
      src={src}
      alt={t('previewAlt', { label })}
      className={className}
      onLoad={(e) => misuraDa(src, e.currentTarget)}
      onError={() => setRotta(src)}
    />
  );

  const avvisoEsterno = (
    <>
      <p className="campo-file__titolo campo-file__titolo--avviso">
        {t('externalTitle')}
      </p>
      <p id={avvisoId} className="campo-file__formati">
        {puoCaricare ? t('externalHint') : t('externalHintLink')}
      </p>
    </>
  );

  const statoZona = [
    sopra ? 'is-sopra' : '',
    errore ? 'is-errore' : '',
    occupato ? 'is-occupato' : '',
    cliccabile ? 'is-cliccabile' : '',
    disabled ? 'is-disattivato' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const gestoriZona = puoCaricare
    ? {
        onDragEnter: trascinaDentro,
        onDragOver: trascinaSopra,
        onDragLeave: trascinaFuori,
        onDrop: rilascia,
        onClick: clicSulRiquadro,
      }
    : {};

  const cattura = sopra ? (
    <div className="campo-file__cattura" aria-hidden="true" />
  ) : null;

  let zona: ReactNode = null;
  if (riquadro && ritaglio) {
    const forma = { aspectRatio: String(ritaglio.rapporto) };
    if (!puoCaricare) {
      zona = (
        <div
          className={`campo-file__zona campo-file__zona--riquadro ${
            esterna
              ? 'campo-file__zona--avviso'
              : piena
                ? 'campo-file__zona--piena'
                : 'campo-file__zona--segnaposto'
          }`}
          style={forma}
        >
          {esterna ? (
            <>
              <Icon
                icon="it-warning-circle"
                size="lg"
                className="campo-file__icona-avviso"
              />
              {avvisoEsterno}
            </>
          ) : piena && anteprima ? (
            immagineAnteprima(anteprima, 'campo-file__immagine')
          ) : (
            <p className="campo-file__formati">{t('previewEmpty')}</p>
          )}
        </div>
      );
    } else if (invio) {
      zona = (
        <div
          className={`campo-file__zona campo-file__zona--riquadro campo-file__zona--piena ${statoZona}`}
          style={forma}
          {...gestoriZona}
        >
          {invio.locale && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={invio.locale}
              alt=""
              className="campo-file__immagine campo-file__immagine--attesa"
            />
          )}
          <div className="campo-file__velo">{progresso}</div>
          {cattura}
        </div>
      );
    } else if (piena && anteprima && !sopra) {
      zona = (
        <div
          className={`campo-file__zona campo-file__zona--riquadro campo-file__zona--piena ${statoZona}`}
          style={forma}
          {...gestoriZona}
        >
          {immagineAnteprima(anteprima, 'campo-file__immagine')}
        </div>
      );
    } else if (esterna && !sopra) {
      zona = (
        <div
          className={`campo-file__zona campo-file__zona--riquadro campo-file__zona--avviso ${statoZona}`}
          style={forma}
          {...gestoriZona}
        >
          <Icon icon="it-warning-circle" size="lg" className="campo-file__icona-avviso" />
          {avvisoEsterno}
          {pulsanteScegli('primario')}
          <span className="visually-hidden" id={formatiId}>
            {formati}
          </span>
        </div>
      );
    } else {
      zona = (
        <div
          className={`campo-file__zona campo-file__zona--riquadro ${statoZona}`}
          style={forma}
          {...gestoriZona}
        >
          {sopra && piena && anteprima && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={anteprima}
              alt=""
              className="campo-file__immagine campo-file__immagine--attesa"
            />
          )}
          <div className={sopra && piena ? 'campo-file__velo' : 'campo-file__vuoto'}>
            <Icon icon="it-upload" size="lg" color="primary" />
            {sopra ? (
              <p className="campo-file__titolo">{testoRilascio}</p>
            ) : (
              <>
                <p className="campo-file__titolo campo-file__trascina" aria-hidden="true">
                  {titoloTrascina}
                </p>
                <p className="campo-file__oppure campo-file__trascina" aria-hidden="true">
                  {t('or')}
                </p>
                {pulsanteScegli('primario')}
              </>
            )}
            {notaFormati}
          </div>
          {cattura}
        </div>
      );
    }
  } else if (puoCaricare || (anteprima && !anteprimaRotta)) {
    // La forma compatta: miniatura, testo, azioni su una riga.
    const vuota = !anteprima || anteprimaRotta;
    let miniatura: ReactNode;
    if (invio?.locale) {
      miniatura = (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={invio.locale} alt="" className="campo-file__immagine--attesa" />
      );
    } else if (esterna) {
      miniatura = (
        <Icon icon="it-warning-circle" size="sm" className="campo-file__icona-avviso" />
      );
    } else if (invio || (!vuota && !immagine)) {
      miniatura = (
        <Icon icon={iconaFile(assetType, invio?.nome ?? nomeMostrato)} color="primary" />
      );
    } else if (!vuota && senzaAnteprima) {
      miniatura = <Icon icon="it-link" size="sm" color="primary" />;
    } else if (!vuota && anteprima) {
      miniatura = immagineAnteprima(anteprima);
    } else {
      miniatura = <Icon icon="it-upload" size="sm" color="primary" />;
    }
    const conImmagine = !invio && !vuota && immagine && !esterna && !senzaAnteprima;

    let testo: ReactNode;
    let azioni: ReactNode = null;
    if (invio) {
      testo = (
        <>
          <span className="campo-file__nome">{invio.nome}</span>
          {progresso}
        </>
      );
    } else if (sopra) {
      testo = <span className="campo-file__titolo">{testoRilascio}</span>;
    } else if (esterna) {
      testo = avvisoEsterno;
      azioni = puoCaricare ? pulsanteScegli('secondario') : azioniPiene;
    } else if (!vuota && anteprima) {
      testo = (
        <>
          {assetType === 'document' ? (
            <a
              className="campo-file__nome"
              href={anteprima}
              target="_blank"
              rel="noopener noreferrer"
            >
              {nomeMostrato ?? anteprima}
              <Icon icon="it-external-link" size="xs" color="primary" className="ms-1" />
              <span className="visually-hidden"> {t('opensInNewTab')}</span>
            </a>
          ) : (
            <span className="campo-file__nome">
              {caricatoOra && (
                <Icon icon="it-check-circle" size="xs" color="success" className="me-1" />
              )}
              {nomeMostrato ?? label}
            </span>
          )}
          {meta.length > 0 && (
            <span className="campo-file__formati">{meta.join(' · ')}</span>
          )}
        </>
      );
      azioni = azioniPiene;
    } else {
      testo = (
        <>
          <span className="campo-file__titolo campo-file__trascina" aria-hidden="true">
            {titoloTrascina}
          </span>
          <span id={formatiId} className="campo-file__formati">
            {formati}
          </span>
        </>
      );
      // Un file che non si riesce piu' a mostrare si puo' comunque togliere.
      azioni =
        anteprimaRotta && value ? (
          <div className="campo-file__azioni">
            {pulsanteScegli('secondario')}
            {pulsanteRimuovi}
          </div>
        ) : (
          pulsanteScegli('secondario')
        );
    }
    // La descrizione dei formati serve ai pulsanti anche a campo pieno.
    const formatiNascosti = !(vuota && !invio && !sopra && !esterna) && puoCaricare && (
      <span className="visually-hidden" id={formatiId}>
        {formati}
      </span>
    );

    zona = (
      <div
        className={`campo-file__zona campo-file__zona--compatta${
          esterna
            ? ' campo-file__zona--avviso'
            : !vuota || invio
              ? ' campo-file__zona--piena'
              : ''
        }${puoCaricare ? '' : ' campo-file__zona--segnaposto'} ${statoZona}`}
        {...gestoriZona}
      >
        <span
          className={`campo-file__miniatura${conImmagine ? ' campo-file__miniatura--scacchi' : ''}`}
        >
          {miniatura}
        </span>
        <div className="campo-file__testo">
          {testo}
          {formatiNascosti}
        </div>
        {azioni}
        {cattura}
      </div>
    );
  }

  const rigaPiena = riquadro &&
    puoCaricare &&
    (piena || (anteprimaRotta && !!value)) &&
    !invio &&
    !sopra && (
      <div className="campo-file__riga">
        {piena && (
          <span className="visually-hidden" id={formatiId}>
            {formati}
          </span>
        )}
        <p className="campo-file__meta">
          {caricatoOra && <Icon icon="it-check-circle" size="xs" color="success" />}
          {[nomeMostrato, ...meta]
            .filter((x): x is string => !!x)
            .map((parte, i) => (
              <span
                key={`${i}-${parte}`}
                className={i === 0 && nomeMostrato ? 'campo-file__nome' : undefined}
              >
                {i > 0 && <span aria-hidden="true">·{'\u00a0'}</span>}
                {parte}
              </span>
            ))}
        </p>
        {azioniPiene}
      </div>
    );
  const rigaSenzaCaricamento = riquadro && !puoCaricare && !!value && (
    <div className="campo-file__riga">{azioniPiene}</div>
  );

  const noteImmagine = [
    caricatoOra?.piccola ? t('crop.small') : null,
    nonRitagliata && piena ? t('svgNoCrop') : null,
  ].filter((x): x is string => !!x);

  const messaggioRotta = anteprimaRotta && (
    <p className="campo-file__errore">
      <Icon icon="it-error" size="xs" color="danger" />
      <span>{t('linkBroken')}</span>
    </p>
  );

  return (
    <>
      <div
        ref={gruppoRef}
        className={`campo-file${riquadro ? ' campo-file--riquadro' : ' campo-file--compatta'}`}
        data-testid={id}
        role="group"
        aria-labelledby={etichettaId}
        aria-describedby={helpText ? aiutoId : undefined}
      >
        <span id={etichettaId} className="campo-file__etichetta">
          {label}
          {required ? ' *' : ''}
        </span>
        {helpText && (
          <p id={aiutoId} className="campo-file__aiuto">
            {helpText}
          </p>
        )}

        {zona}
        {rigaPiena}
        {rigaSenzaCaricamento}
        {assetType === 'audio' && piena && anteprima && !invio && (
          <audio controls src={anteprima} className="campo-file__audio" />
        )}
        {noteImmagine.map((n) => (
          <p key={n} className="campo-file__nota">
            {n}
          </p>
        ))}

        {errore && (
          <p id={erroreId} className="campo-file__errore" role="alert">
            <Icon icon="it-error" size="xs" color="danger" />
            <span>{errore.testo}</span>
            {errore.riprova && (
              <button
                ref={riprovaRef}
                type="button"
                className="btn btn-sm btn-link campo-file__riprova"
                onClick={() => {
                  const r = errore.riprova;
                  if (r) void invia(r.file, r.piccola);
                }}
              >
                {t('retry')}
              </button>
            )}
          </p>
        )}
        {!mostraLink && messaggioRotta}

        {mostraLink && (
          <div className="campo-file__link">
            {/* Due etichette: la prima, nascosta, e' il nome del campo (chi
                legge lo schermo lo sente entrando nel link, e le impostazioni
                del sito lo citano nei loro errori); la seconda e' quella che
                si vede. */}
            <label htmlFor={linkId} className="visually-hidden">
              {label}
            </label>
            <label htmlFor={linkId} className="campo-file__link-etichetta">
              {etichettaLink}
            </label>
            <div className="campo-file__link-campo">
              <Icon icon="it-link" size="xs" className="campo-file__link-icona" />
              <input
                ref={linkRef}
                id={linkId}
                type="text"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="off"
                className={`form-control campo-file__input${erroreLink ? ' is-invalid' : ''}${
                  esterna ? ' campo-file__input--avviso' : ''
                }`}
                placeholder={t('urlPlaceholder')}
                value={draft}
                onChange={onLink}
                onBlur={esciDalLink}
                onKeyDown={tastoNelLink}
                onPaste={() => {
                  // Il cambiamento arriva subito dopo l'incolla; se non arriva
                  // (lo stesso testo), la battuta seguente non conta come incolla.
                  incollato.current = true;
                  setTimeout(() => {
                    incollato.current = false;
                  }, 0);
                }}
                aria-invalid={erroreLink ? true : undefined}
                aria-describedby={descriviLink}
                // Durante un caricamento il link aspetta: un file che arriva
                // dopo non deve cancellare un link scritto nel frattempo.
                disabled={disabled || occupato}
              />
            </div>
            {erroreLink && (
              <p id={erroreLinkId} className="campo-file__errore" role="alert">
                <Icon icon="it-error" size="xs" color="danger" />
                <span>{erroreLink}</span>
              </p>
            )}
            {!erroreLink && messaggioRotta}
            {motivo && (
              <p className="campo-file__nota">
                {motivo === 'sessione' ? t('uploadsStaffOnly') : t('uploadsUnavailable')}
              </p>
            )}
          </div>
        )}

        {/* Sempre presente e vuota all'inizio: chi legge lo schermo sente
            quando un caricamento parte, finisce, si annulla o si rimuove. */}
        <div role="status" className="visually-hidden">
          {annuncio}
        </div>
      </div>

      {/* Il selettore vero, nascosto: lo apre il pulsante. Fuori dal gruppo e
          dopo il link, cosi' non e' mai il primo campo del gruppo. */}
      {puoCaricare && (
        <input
          ref={inputRef}
          id={fileId}
          type="file"
          accept={accept ?? ASSET_MIME_TYPES[assetType].join(',')}
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={onFileInput}
          disabled={disabled}
        />
      )}

      {daRitagliare && ritaglio && (
        <ImageCropDialog
          file={daRitagliare}
          ritaglio={ritaglio}
          onAnnulla={() => setDaRitagliare(null)}
          onConferma={(ritagliato) => {
            setDaRitagliare(null);
            void invia(ritagliato);
          }}
        />
      )}
    </>
  );
}

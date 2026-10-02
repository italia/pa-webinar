/**
 * Il genere di un materiale, per l'icona e l'etichetta breve nella sala: un
 * PDF, un documento, delle slide, un foglio di calcolo, un testo, un link.
 *
 * Il tipo MIME, quando c'e', e' quello verificato dal server al caricamento;
 * per le righe che non lo portano decide l'estensione del nome o dell'indirizzo.
 */

export type MaterialKind = 'pdf' | 'doc' | 'slides' | 'sheet' | 'text' | 'file' | 'link';

export interface MaterialKindInput {
  type: string;
  mimeType?: string | null;
  fileName?: string | null;
  url?: string | null;
}

const PER_MIME: Record<string, MaterialKind> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'doc',
  'application/msword': 'doc',
  'application/vnd.oasis.opendocument.text': 'doc',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'slides',
  'application/vnd.ms-powerpoint': 'slides',
  'application/vnd.oasis.opendocument.presentation': 'slides',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'sheet',
  'application/vnd.ms-excel': 'sheet',
  'application/vnd.oasis.opendocument.spreadsheet': 'sheet',
  'text/csv': 'sheet',
  'text/plain': 'text',
};

const PER_ESTENSIONE: Record<string, MaterialKind> = {
  pdf: 'pdf',
  doc: 'doc',
  docx: 'doc',
  odt: 'doc',
  ppt: 'slides',
  pptx: 'slides',
  odp: 'slides',
  xls: 'sheet',
  xlsx: 'sheet',
  ods: 'sheet',
  csv: 'sheet',
  txt: 'text',
};

function estensione(nome: string | null | undefined): string | null {
  if (!nome) return null;
  // Dall'indirizzo conta il percorso, non la query (?sig=...) ne' l'ancora.
  const percorso = nome.split(/[?#]/)[0] ?? '';
  const m = /\.([a-z0-9]{2,5})$/i.exec(percorso);
  return m ? m[1]!.toLowerCase() : null;
}

export function materialKind(m: MaterialKindInput): MaterialKind {
  if (m.type !== 'FILE') return 'link';
  const daMime = m.mimeType ? PER_MIME[m.mimeType.toLowerCase()] : undefined;
  if (daMime) return daMime;
  const ext = estensione(m.fileName) ?? estensione(m.url);
  return (ext && PER_ESTENSIONE[ext]) || 'file';
}

/** Icona dello sprite di Bootstrap Italia per ogni genere. */
export const MATERIAL_KIND_ICON: Record<MaterialKind, string> = {
  pdf: 'it-file-pdf',
  doc: 'it-file-docx',
  slides: 'it-file-ppt',
  sheet: 'it-file-xlsx',
  text: 'it-file-txt',
  file: 'it-file',
  link: 'it-link',
};

/** Etichetta breve, uguale in ogni lingua (sono nomi di formato). */
export const MATERIAL_KIND_SHORT: Record<Exclude<MaterialKind, 'link'>, string> = {
  pdf: 'PDF',
  doc: 'DOCX',
  slides: 'PPTX',
  sheet: 'XLSX',
  text: 'TXT',
  file: 'FILE',
};

/** Il titolo proposto per un file: il nome senza estensione, leggibile. */
export function titleFromFileName(nome: string): string {
  const senza = nome.replace(/\.[a-z0-9]{2,5}$/i, '');
  return senza.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}

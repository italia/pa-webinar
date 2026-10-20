/**
 * Quali file si possono caricare dall'area admin, e quanto possono pesare.
 *
 * Una sola regola per i due lati: la rotta `/api/admin/assets/upload-url`
 * la applica sui byte veri, il campo «file o link» la controlla nel browser
 * prima di spedire, cosi' un file che il server rifiuterebbe si ferma subito,
 * con un messaggio che dice perche', senza attendere il caricamento.
 *
 * Senza dipendenze dal server: lo importano anche i componenti del browser.
 */
import type { AssetType } from '@/lib/utils/asset-key';
import {
  MATERIAL_FILE_MAX_BYTES,
  MATERIAL_FILE_MIME_TYPES,
} from '@/lib/validation/materials';

const MIB = 1024 * 1024;

export const ASSET_MIME_TYPES: Readonly<Record<AssetType, readonly string[]>> = {
  image: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/webm'],
  // I documenti sono i materiali dell'evento: stessa regola della sala.
  document: MATERIAL_FILE_MIME_TYPES,
};

/** In byte, su base 1024 come le console degli object store. */
export const ASSET_MAX_BYTES: Readonly<Record<AssetType, number>> = {
  image: 10 * MIB,
  audio: 20 * MIB,
  document: MATERIAL_FILE_MAX_BYTES,
};

export function tipoAmmesso(tipo: AssetType, mime: string): boolean {
  return ASSET_MIME_TYPES[tipo].includes(mime);
}

/**
 * Il peso di un file nella lingua della pagina: «72 kB», «1,4 MB». Stessa base
 * 1024 dei limiti, cosi' il massimo si legge «10 MB» e non «10,5 MB». Fra
 * numero e unita' uno spazio che non va a capo.
 */
export function formattaPeso(
  byte: number,
  locale: string,
  { perEccesso = false }: { perEccesso?: boolean } = {}
): string {
  const mega = byte >= MIB;
  // Per eccesso il peso di un file rifiutato: 10,03 MB si legge «10,1 MB», non
  // «10 MB» accanto a un massimo di «10 MB».
  const arrotonda = perEccesso ? Math.ceil : Math.round;
  const valore = mega
    ? arrotonda((byte / MIB) * 10) / 10
    : Math.max(1, arrotonda(byte / 1024));
  try {
    return (
      new Intl.NumberFormat(locale, {
        style: 'unit',
        unit: mega ? 'megabyte' : 'kilobyte',
        unitDisplay: 'short',
        maximumFractionDigits: mega ? 1 : 0,
      })
        .format(valore)
        // Gli spazi di Intl variano fra versioni (normale, stretto): uno solo,
        // uguale sul server e nel browser.
        .replace(/[\s\u202f]/g, '\u00a0')
    );
  } catch {
    return `${mega ? valore.toFixed(1) : valore}\u00a0${mega ? 'MB' : 'kB'}`;
  }
}

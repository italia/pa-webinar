/**
 * Sfondo virtuale scelto PRIMA di entrare in sala.
 *
 * Perche' esiste: il pulsante nativo per cambiare sfondo vive dentro la
 * conferenza, quindi si trova solo dopo essere entrati — e chi arriva da casa,
 * o da una stanza che preferirebbe non mostrare, lo scopre quando gli altri lo
 * stanno gia' guardando. La scelta si fa nella sala d'attesa e viene applicata
 * all'ingresso.
 *
 * COSA SI PUO' E COSA NO: l'API a distanza di Jitsi imposta soltanto uno
 * sfondo IMMAGINE (il tipo e' fissato nel gestore del comando). La SFOCATURA da
 * fuori non e' raggiungibile e resta appannaggio del pulsante nativo, dentro la
 * sala. L'anteprima della videocamera qui accanto mostra la miniatura scelta,
 * non l'effetto sul proprio volto: applicarlo davvero vorrebbe dire rifare la
 * segmentazione del video nel portale, cioe' un secondo motore di sfondi
 * accanto a quello che Jitsi ha gia'.
 *
 * L'immagine viaggia come data URI e non come indirizzo: Jitsi la carica in un
 * `<img crossOrigin="anonymous">` e poi la disegna su una tela: un indirizzo di
 * un'altra origine — il portale non e' la stessa origine della conferenza —
 * sporcherebbe la tela e l'effetto non partirebbe.
 */

export interface SfondoVirtuale {
  /** Identificativo stabile: e' quello che finisce nelle preferenze locali. */
  id: string;
  /** Percorso dell'immagine, o null per «nessuno sfondo». */
  url: string | null;
}

/** Sfondi spediti con la piattaforma: sfumature neutre, pensate per non
 *  rubare l'attenzione a chi parla e per non datarsi. */
export const SFONDI_VIRTUALI: readonly SfondoVirtuale[] = [
  { id: 'nessuno', url: null },
  { id: 'ufficio-chiaro', url: '/images/virtual-backgrounds/ufficio-chiaro.jpg' },
  { id: 'blu-istituzionale', url: '/images/virtual-backgrounds/blu-istituzionale.jpg' },
  { id: 'verde-salvia', url: '/images/virtual-backgrounds/verde-salvia.jpg' },
  { id: 'grafite', url: '/images/virtual-backgrounds/grafite.jpg' },
] as const;

export const SFONDO_PREDEFINITO = 'nessuno';

const CHIAVE = 'paw_sfondo_virtuale';

export function sfondoDa(id: string | null | undefined): SfondoVirtuale {
  return (
    SFONDI_VIRTUALI.find((s) => s.id === id) ??
    SFONDI_VIRTUALI.find((s) => s.id === SFONDO_PREDEFINITO)!
  );
}

/** La scelta dell'ultima volta. Un identificativo che non esiste piu' — sfondo
 *  tolto da una versione all'altra — torna «nessuno» invece di restare appeso
 *  a un'immagine che darebbe 404 dentro la conferenza. */
export function leggiSfondo(): string {
  if (typeof window === 'undefined') return SFONDO_PREDEFINITO;
  try {
    return sfondoDa(window.localStorage.getItem(CHIAVE)).id;
  } catch {
    return SFONDO_PREDEFINITO;
  }
}

export function scriviSfondo(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CHIAVE, sfondoDa(id).id);
  } catch {
    /* navigazione privata, spazio esaurito: la scelta vale per questa volta */
  }
}

/**
 * L'immagine come data URI, pronta per essere consegnata alla conferenza.
 * Null quando non c'e' niente da applicare o quando la lettura fallisce: uno
 * sfondo che non parte e' un fastidio, un ingresso che non avviene e' un danno.
 */
export async function dataUriSfondo(id: string): Promise<string | null> {
  const sfondo = sfondoDa(id);
  if (!sfondo.url) return null;
  try {
    const res = await fetch(sfondo.url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const lettore = new FileReader();
      lettore.onload = () => resolve(typeof lettore.result === 'string' ? lettore.result : null);
      lettore.onerror = () => resolve(null);
      lettore.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

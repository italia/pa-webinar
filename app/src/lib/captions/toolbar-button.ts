/**
 * Il pulsante dei sottotitoli nella barra dei comandi di Jitsi.
 *
 * È un pulsante personalizzato della configurazione di Jitsi
 * (`customToolbarButtons`): Jitsi lo disegna accanto ai suoi e ne riferisce
 * il clic con l'evento `toolbarButtonClicked`; l'icona e il testo cambiano
 * con `overwriteConfig`. Nasconde o mostra i sottotitoli solo per chi lo
 * preme: la trascrizione della sala la accende e la spegne chi modera.
 */

export const CAPTIONS_BUTTON_ID = 'pa-captions';

const STORAGE_KEY = 'pawebinar.captions.visible';

/** La scelta di chi guarda, ricordata nel browser; senza scelta, visibili. */
export function readCaptionsVisible(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function writeCaptionsVisible(value: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {
    // Archiviazione non disponibile (finestra privata): resta la scelta della sessione.
  }
}

// Disegnate come le icone di Jitsi: 24 px, tratto pieno bianco. Jitsi mostra
// l'icona di un pulsante personalizzato come immagine, quindi il colore è
// scritto nel disegno e non ereditato.
const FRAME =
  'M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm0 2v10h16V7H4Z';
const LINES = 'M6 13h5v2H6v-2Zm7 0h5v2h-5v-2ZM6 10h8v2H6v-2Zm10 0h2v2h-2v-2Z';
const SLASH = 'M3.3 2.3 21.7 20.7l-1.4 1.4L1.9 3.7l1.4-1.4Z';

function svg(paths: string[]): string {
  const body = paths.map((d) => `<path fill="#fff" fill-rule="evenodd" d="${d}"/>`).join('');
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${body}</svg>`;
  return `data:image/svg+xml;base64,${typeof btoa === 'function' ? btoa(markup) : Buffer.from(markup).toString('base64')}`;
}

/** Icona dei sottotitoli visibili e di quelli nascosti (barrata). */
export const CAPTIONS_ICON_ON = svg([FRAME, LINES]);
export const CAPTIONS_ICON_OFF = svg([FRAME, LINES, SLASH]);

export interface CustomToolbarButton {
  id: string;
  icon: string;
  text: string;
}

/**
 * Il pulsante nello stato corrente. Il testo è l'azione che il clic compie,
 * come per i pulsanti di Jitsi («Mostra…» quando sono nascosti).
 */
export function captionsToolbarButton(
  visible: boolean,
  labels: { show: string; hide: string },
): CustomToolbarButton {
  return {
    id: CAPTIONS_BUTTON_ID,
    icon: visible ? CAPTIONS_ICON_ON : CAPTIONS_ICON_OFF,
    text: visible ? labels.hide : labels.show,
  };
}


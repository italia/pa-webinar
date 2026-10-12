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

/**
 * Gli annunci vocali di registrazione che Jitsi fa sentire anche quando si
 * accende o si spegne la sola trascrizione: tolti dove i sottotitoli sono
 * accesi (vedi JitsiRoom).
 */
export const CAPTIONS_DISABLED_SOUNDS: readonly string[] = ['RECORDING_ON_SOUND', 'RECORDING_OFF_SOUND'];

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

// Disegnate come le icone di Jitsi: 24 px, bianche. Jitsi mostra l'icona di
// un pulsante personalizzato come immagine, quindi il colore è scritto nel
// disegno e non ereditato. Spenti, come il microfono e la videocamera di
// Jitsi: una barra diagonale che taglia il disegno, con un margine vuoto ai
// lati della barra.
const FRAME =
  'M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm0 2v10h16V7H4Z';
const LINES = 'M6 13h5v2H6v-2Zm7 0h5v2h-5v-2ZM6 10h8v2H6v-2Zm10 0h2v2h-2v-2Z';

function dataUri(markup: string): string {
  const base64 = typeof btoa === 'function' ? btoa(markup) : Buffer.from(markup).toString('base64');
  return `data:image/svg+xml;base64,${base64}`;
}

const DRAWING = `<path fill="#fff" fill-rule="evenodd" d="${FRAME}"/><path fill="#fff" d="${LINES}"/>`;
const SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">';

/** Icona dei sottotitoli visibili e di quelli nascosti (barrata). */
export const CAPTIONS_ICON_ON = dataUri(`${SVG_OPEN}${DRAWING}</svg>`);
export const CAPTIONS_ICON_OFF = dataUri(
  `${SVG_OPEN}<defs><mask id="taglio"><rect width="24" height="24" fill="#fff"/>` +
    '<path d="M2 2 22 22" stroke="#000" stroke-width="5"/></mask></defs>' +
    `<g mask="url(#taglio)">${DRAWING}</g>` +
    '<path d="M3 3 21 21" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
);

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


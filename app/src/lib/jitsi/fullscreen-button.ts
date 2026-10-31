import type { CustomToolbarButton } from '@/lib/jitsi/custom-buttons';

/**
 * Lo schermo intero della sala nella barra dei comandi di Jitsi, accanto agli
 * altri: la sala intera (video e colonna laterale), non solo la conferenza.
 * Il clic arriva alla sala con `toolbarButtonClicked`.
 */
export const FULLSCREEN_BUTTON_ID = 'pa-fullscreen';

function dataUri(markup: string): string {
  const base64 =
    typeof btoa === 'function' ? btoa(markup) : Buffer.from(markup).toString('base64');
  return `data:image/svg+xml;base64,${base64}`;
}

const SVG_OPEN =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';

/** I quattro angoli verso l'esterno (entra) e verso l'interno (esci). */
export const FULLSCREEN_ICON_ENTER = dataUri(
  `${SVG_OPEN}<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>`
);
export const FULLSCREEN_ICON_EXIT = dataUri(
  `${SVG_OPEN}<path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/></svg>`
);

/** Il pulsante nello stato corrente: testo e icona dicono che cosa fa il clic. */
export function fullscreenToolbarButton(
  attivo: boolean,
  labels: { enter: string; exit: string }
): CustomToolbarButton {
  return {
    id: FULLSCREEN_BUTTON_ID,
    icon: attivo ? FULLSCREEN_ICON_EXIT : FULLSCREEN_ICON_ENTER,
    text: attivo ? labels.exit : labels.enter,
  };
}

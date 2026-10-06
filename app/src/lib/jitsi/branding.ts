/**
 * I colori della scena della conferenza, perche' si fonda con il resto della
 * sala: lo stesso blu della barra in alto e delle schede, al posto del nero di
 * Jitsi dietro a chi non ha la telecamera accesa.
 *
 * La scena resta scura di proposito: testi e icone che Jitsi disegna sopra
 * (nomi nei riquadri, indicatori, sottotitoli) sono bianchi e non si cambiano.
 *
 * Due strade, perche' non tutte le installazioni le hanno entrambe:
 * - `JITSI_STAGE_BACKGROUND` va nell'interfaceConfig dell'IFrame API
 *   (`DEFAULT_BACKGROUND`): basta da solo per il colore della scena;
 * - il documento di branding dinamico (`/api/jitsi-branding.json`, se il
 *   server Jitsi lo punta con `DYNAMIC_BRANDING_URL`) aggiunge la filigrana,
 *   il colore dei riquadri e quello degli avatar con le iniziali.
 */

/** Il colore della scena: il blu scuro della barra della sala. */
export const JITSI_STAGE_BACKGROUND = '#004D99';

/**
 * Le superfici di Jitsi, al posto dei grigi quasi neri: un blu ardesia, dal
 * piu' scuro al piu' chiaro. Sono token condivisi: la prima e' la barra dei
 * controlli e lo sfondo di menu, finestre e pannelli; la seconda le
 * evidenziazioni su quelle superfici e i riquadri di chi non ha la
 * telecamera; la terza bordi e passaggi del mouse sui pulsanti. Testi e
 * icone di Jitsi restano bianchi: il contrasto resta oltre 4.5:1 su tutte.
 */
export const JITSI_SURFACE = '#2F5175';
export const JITSI_SURFACE_RAISED = '#3D6289';
export const JITSI_SURFACE_STRONG = '#4D7299';

/** I riquadri dei partecipanti senza telecamera. */
export const JITSI_TILE_BACKGROUND = JITSI_SURFACE_RAISED;

/**
 * Gli sfondi degli avatar con le iniziali, dalla palette di Bootstrap Italia:
 * tinte che si leggono sulla scena blu (nessuna uguale alla scena) e su cui le
 * iniziali bianche restano oltre 4.5:1.
 */
export const JITSI_AVATAR_BACKGROUNDS = [
  '#0073E6',
  '#6A50D3',
  '#00806E',
  '#B02E42',
  '#00804F',
  '#5C6F82',
  '#8B4FB8',
  '#C25400',
];

/**
 * La filigrana della scena: il gradiente della barra della sala e un motivo
 * di cerchi concentrici bianchi quasi trasparenti, decentrati. Nessun logo e
 * nessun testo. Jitsi la stende con `background-size: cover`, quindi i bordi
 * possono tagliarsi: il motivo sta lontano dal centro, dove compaiono i video.
 */
export const JITSI_STAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#004D99"/>
<stop offset="1" stop-color="#0059B3"/>
</linearGradient>
</defs>
<rect width="1600" height="900" fill="url(#g)"/>
<g fill="none" stroke="#FFFFFF" stroke-opacity="0.06" stroke-width="2">
<circle cx="1480" cy="-40" r="180"/>
<circle cx="1480" cy="-40" r="300"/>
<circle cx="1480" cy="-40" r="420"/>
<circle cx="1480" cy="-40" r="540"/>
<circle cx="80" cy="980" r="160"/>
<circle cx="80" cy="980" r="280"/>
<circle cx="80" cy="980" r="400"/>
</g>
</svg>`;

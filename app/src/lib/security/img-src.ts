/**
 * Gli unici siti esterni da cui le pagine del portale caricano immagini
 * (direttiva `img-src` della CSP, in middleware.ts). Lo legge anche il campo
 * immagine dell'amministrazione, per avvisare quando un indirizzo non verrebbe
 * mostrato: tenerli in un posto solo evita che i due si separino.
 */
export const IMMAGINI_ESTERNE_AMMESSE: readonly string[] = ['https://i.ytimg.com'];

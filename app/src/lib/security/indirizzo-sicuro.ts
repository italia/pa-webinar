/**
 * Un indirizzo da mettere in un link, un'immagine o un audio della pagina:
 * solo http(s), un file scelto ora (`blob:`), un'immagine o un audio
 * incorporati o un percorso di questo sito, senza barre o spazi che il
 * browser leggerebbe come un altro host. Il valore puo' arrivare dal server,
 * da chi scrive nel campo o dal file scelto: un altro indirizzo non arriva
 * all'attributo, e chi chiama lo tratta come un'anteprima rotta.
 *
 * L'indirizzo resta quello ricevuto, perche' chi chiama confronta host e
 * percorso sul valore originale. Cambiano solo `<`, `>` e `"`, che il browser
 * codifica comunque in un indirizzo http(s) e che nel corpo di un `data:`
 * valgono lo stesso codificati.
 *
 * Accetta `blob:` e `data:` perche' servono alle anteprime dell'area
 * amministrativa: un link pubblico vuole una verifica piu' stretta.
 */
const SCHEMI_AMMESSI =
  /^(https?:\/\/|blob:|data:(image|audio)\/|\/(?![/\\])(?=[^\s\\]*$))/i;

const SEGNI_DI_MARKUP = /[<>"]/g;

export function indirizzoSicuro(url: string | null | undefined): string | undefined {
  if (!url || !SCHEMI_AMMESSI.test(url)) return undefined;
  return url.replace(SEGNI_DI_MARKUP, encodeURIComponent);
}

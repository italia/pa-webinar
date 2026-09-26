/**
 * Il link al video su YouTube di un evento concluso (`Event.youtubeUrl`).
 *
 * La pagina evento NON incorpora il player di YouTube: un iframe di terze parti
 * fa contattare YouTube — e i suoi cookie — al browser di chiunque apra la
 * pagina, senza che l'abbia scelto, contro la regola del portale di non caricare
 * risorse esterne. Il video resta raggiungibile come link esterno, che il
 * visitatore apre di sua iniziativa.
 *
 * Qui si decide se l'indirizzo salvato è davvero un link YouTube da mostrare.
 * La validazione dell'API controlla solo che il testo CONTENGA «youtube.com» o
 * «youtu.be», non che l'host lo sia: `https://altro.example/?youtube.com` o
 * `javascript:…//youtube.com` passerebbero. In un `href` finisce quindi solo un
 * indirizzo http(s) il cui host è di YouTube; tutto il resto non si mostra.
 */
export function youtubeWatchLink(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  const isYouTube =
    host === 'youtu.be' ||
    host === 'youtube.com' ||
    host.endsWith('.youtube.com') ||
    host === 'youtube-nocookie.com' ||
    host.endsWith('.youtube-nocookie.com');
  return isYouTube ? url.href : null;
}

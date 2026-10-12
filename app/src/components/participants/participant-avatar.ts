/**
 * L'immagine dell'avatar di un partecipante, come la riporta Jitsi
 * (`avatarURL`, dal token che firma il portale): una foto caricata, il proxy
 * Gravatar, o l'SVG con le iniziali. Si mostra solo se viene dal portale
 * stesso o e' un'immagine incorporata: un indirizzo qualunque in un `<img>`
 * farebbe partire dal browser di chi guarda una richiesta verso terzi.
 */
export function safeAvatarSrc(url: string | null | undefined, origin: string): string | null {
  if (!url) return null;
  if (/^data:image\/(png|jpeg|webp|svg\+xml);/i.test(url)) return url;
  try {
    const u = new URL(url, origin);
    if (u.origin !== origin) return null;
    if (!u.pathname.startsWith('/api/avatar')) return null;
    return u.href;
  } catch {
    return null;
  }
}

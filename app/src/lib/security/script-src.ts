import { locales } from '@/i18n/config';

// La sala dell'evento (con la sala d'attesa): l'unica pagina che compila
// WebAssembly, per l'anteprima dello sfondo virtuale.
const PERCORSO_SALA_RE = new RegExp(`^/(?:${locales.join('|')})/(?:events|eventi)/[^/]+/live/?$`);

export function compilaWebAssembly(pathname: string): boolean {
  return PERCORSO_SALA_RE.test(pathname);
}

/**
 * La direttiva `script-src` della CSP: nonce per richiesta più
 * 'strict-dynamic', l'host di Jitsi per lo script dell'IFrame API.
 *
 * - Fuori produzione, 'unsafe-eval': `next dev` (hot reload, React Refresh,
 *   moduli webpack valutati) non parte senza.
 * - Solo nella sala, 'wasm-unsafe-eval': permette di compilare WebAssembly e
 *   nient'altro (l'eval di JavaScript resta bloccato). Serve al motore di
 *   MediaPipe dell'anteprima dello sfondo, servito da /vendor.
 */
export function direttivaScript({
  nonce,
  jitsiDomain,
  produzione,
  webAssembly,
}: {
  nonce: string;
  jitsiDomain: string;
  produzione: boolean;
  webAssembly: boolean;
}): string {
  return [
    'script-src',
    "'self'",
    ...(produzione ? [] : ["'unsafe-eval'"]),
    ...(webAssembly ? ["'wasm-unsafe-eval'"] : []),
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    'https:',
    `https://${jitsiDomain}`,
  ].join(' ');
}

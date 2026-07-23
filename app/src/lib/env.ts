/**
 * Runtime-safe access to NEXT_PUBLIC_* environment variables.
 *
 * Next.js inlines `process.env.NEXT_PUBLIC_*` at **build time** via webpack
 * DefinePlugin. This means the values are baked into the JS bundle and cannot
 * be changed at runtime — breaking single-image, multi-environment deploys.
 *
 * Bracket notation (`process.env['KEY']`) is NOT replaced by DefinePlugin,
 * so it reads from the actual Node.js runtime environment. Use this helper
 * in Server Components and API routes to get the real runtime value.
 *
 * For Client Components, pass the value as a prop from a Server Component.
 */

const ENV_DEFAULTS: Record<string, string> = {
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  NEXT_PUBLIC_JITSI_DOMAIN: 'localhost:8443',
  NEXT_PUBLIC_WATERMARK_URL: '/images/default-watermark.svg',
  NEXT_PUBLIC_DEFAULT_LOCALE: 'it',
};

export function getPublicEnv(key: string): string {
  return process.env[key] ?? ENV_DEFAULTS[key] ?? '';
}

/**
 * `NEXT_PUBLIC_APP_URL` come URL http(s), o null se è vuoto/malformato.
 *
 * `new URL()` LANCIA su un valore senza schema (`webinar.gov.it`, un misconfig
 * comune). Chiamarlo direttamente dentro un Server Component o una route fa
 * andare in 500 quel percorso — è già successo. Questo è l'unico posto in cui
 * fare quel parsing: chi ha bisogno dell'origin assoluto passa da qui, così la
 * regola sugli schemi ammessi vive in un punto solo.
 */
export function appBaseUrl(): URL | null {
  try {
    const url = new URL(getPublicEnv('NEXT_PUBLIC_APP_URL'));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

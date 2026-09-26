import { defaultLocale, locales } from '@/i18n/config';

/**
 * Le lingue in cui partono le email. L'interfaccia ne ha di piu': chi usa
 * una lingua senza testi email riceve l'inglese, lingua franca europea,
 * mentre i link nell'email restano nella lingua della pagina da cui e'
 * arrivato.
 */
export const EMAIL_LOCALES = ['it', 'en', 'fr', 'de', 'es'] as const;
export type EmailLocale = (typeof EMAIL_LOCALES)[number];

export const EMAIL_FALLBACK_LOCALE: EmailLocale = 'en';

/** La lingua dei testi di un'email per chi usa `locale`. */
export function linguaEmail(locale: string | null | undefined): EmailLocale {
  const base = (locale ?? '').toLowerCase().split(/[-_]/)[0] ?? '';
  return (EMAIL_LOCALES as readonly string[]).includes(base)
    ? (base as EmailLocale)
    : EMAIL_FALLBACK_LOCALE;
}

/**
 * La lingua dell'interfaccia da usare per i link, o `null` se `locale` non
 * e' una lingua della piattaforma. Serve a non costruire indirizzi verso
 * pagine inesistenti con un valore arrivato dal client.
 */
export function linguaPagina(locale: string | null | undefined): string | null {
  const base = (locale ?? '').toLowerCase().split(/[-_]/)[0] ?? '';
  return (locales as readonly string[]).includes(base) ? base : null;
}

/**
 * La lingua di chi scrive, dall'intestazione Accept-Language: solo quando la
 * richiesta non dice da quale pagina arriva.
 */
export function linguaDaIntestazione(acceptLanguage: string | null | undefined): string | null {
  for (const parte of (acceptLanguage ?? '').split(',')) {
    const trovata = linguaPagina(parte.split(';')[0]?.trim());
    if (trovata) return trovata;
  }
  return null;
}

/**
 * Le due lingue di un'email a chi si e' iscritto: quella della pagina da
 * cui si e' iscritto, per titolo e link, e quella dei testi. Le iscrizioni
 * nate prima che la lingua si registrasse ricadono sulla lingua predefinita
 * dell'istanza.
 */
export function lingueIscrizione(
  locale: string | null | undefined,
  /** La lingua predefinita dell'istanza (impostazioni), se nota. */
  predefinita?: string | null,
): {
  pagina: string;
  testi: EmailLocale;
} {
  const pagina = linguaPagina(locale) ?? linguaPagina(predefinita) ?? defaultLocale;
  return { pagina, testi: linguaEmail(pagina) };
}

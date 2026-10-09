import { localizedPath } from '@/lib/utils/localized-url';

export interface InformativaEvento {
  /** Dove leggerla: il link dell'evento, quello dell'istanza, o la pagina
   *  privacy del sito. */
  url: string;
  /** Il testo dell'evento, o del suo modello nella lingua della pagina (poi in
   *  italiano); assente se non c'e' (resta il link). */
  testo?: string;
}

/**
 * L'informativa privacy di un evento, la stessa per il modulo di iscrizione e
 * per la sala d'attesa: chi acconsente alla registrazione entrando dal link
 * della sala legge quello che avrebbe letto iscrivendosi.
 *
 * Il testo dell'evento vince (un evento puo' sempre avere un'informativa sua),
 * poi quello del modello collegato; un testo vuoto salvato da versioni
 * precedenti vale come assente.
 */
export function informativaEvento(
  event: {
    privacyPolicyUrl: string | null;
    privacyPolicyText: string | null;
    gdprTemplate?: { body: unknown } | null;
  },
  locale: string,
): InformativaEvento {
  const url =
    event.privacyPolicyUrl ??
    process.env.DEFAULT_PRIVACY_POLICY_URL ??
    localizedPath('/privacy', locale);
  const corpo = event.gdprTemplate?.body as Record<string, string | undefined> | null | undefined;
  const testo =
    event.privacyPolicyText?.trim() ||
    corpo?.[locale]?.trim() ||
    corpo?.it?.trim() ||
    undefined;
  return { url, testo };
}

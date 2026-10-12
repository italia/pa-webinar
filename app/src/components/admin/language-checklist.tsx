'use client';

/**
 * Le lingue di traduzione come caselle da spuntare, invece di codici da
 * scrivere a mano: prima le piu' richieste, poi le altre lingue dell'Unione
 * in un gruppo che si apre. Il valore resta quello salvato da sempre, i
 * codici separati da virgola (`en,fr`); nessuna spunta vale `null`.
 *
 * Un codice salvato che non e' fra le 24 lingue dell'interfaccia (`uk`,
 * `pt-br`, valido per la pipeline: lib/ai/providers parseTargetLocales) non si
 * perde: compare spuntato fra le altre lingue, e resta finche' non lo si
 * toglie.
 */

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';

import { localeNames, locales } from '@/i18n/config';
import { parseLocaleList } from '@/lib/ai/target-locales';

/** Le lingue mostrate per prime. */
export const COMMON_TARGET_LOCALES = ['en', 'fr', 'es', 'de'] as const;

const TUTTE = locales as readonly string[];

export { parseLocaleList };

/** Il nome di una lingua che non e' fra quelle dell'interfaccia. */
function nomeEsterno(codice: string): string {
  try {
    return new Intl.DisplayNames([codice], { type: 'language' }).of(codice) ?? codice;
  } catch {
    return codice;
  }
}

export default function LanguageChecklist({
  legend,
  description,
  value,
  onChange,
  invalid = false,
  errorText,
  emptyHint,
  exclude = [],
}: {
  legend: string;
  description?: string;
  value: string | null;
  onChange: (next: string | null) => void;
  invalid?: boolean;
  errorText?: string;
  /** Detto quando non e' spuntata nessuna lingua (e non e' un errore). */
  emptyHint?: string;
  /** Lingue da non offrire: quella in cui si svolge l'evento. */
  exclude?: readonly string[];
}) {
  const t = useTranslations('admin.form');
  const base = useId();
  const scelte = parseLocaleList(value);
  const nome = (c: string) => (localeNames as Record<string, string>)[c] ?? nomeEsterno(c);
  const disponibili = TUTTE.filter((c) => !exclude.includes(c) || scelte.includes(c));
  const comuni = COMMON_TARGET_LOCALES.filter((c) => disponibili.includes(c));
  // Le altre: le lingue dell'Unione e i codici salvati che l'elenco non ha.
  const altre = [
    ...disponibili.filter((c) => !(COMMON_TARGET_LOCALES as readonly string[]).includes(c)),
    ...scelte.filter((c) => !TUTTE.includes(c)),
  ].sort((a, b) => nome(a).localeCompare(nome(b)));
  const altreScelte = altre.filter((c) => scelte.includes(c)).length;
  // Aperto in partenza se c'e' gia' una lingua scelta li' dentro; poi lo
  // apre e chiude solo chi lo usa (togliere l'ultima spunta non lo chiude).
  const [apertoAllInizio] = useState(altreScelte > 0);
  const errorId = `${base}-err`;

  const cambia = (codice: string, on: boolean) => {
    // L'ordine resta quello salvato; una lingua aggiunta va in fondo.
    const next = on ? [...scelte.filter((c) => c !== codice), codice] : scelte.filter((c) => c !== codice);
    onChange(next.length > 0 ? next.join(',') : null);
  };

  // Con l'errore la prima casella porta il segno di campo da correggere: il
  // riepilogo degli errori del wizard la trova, la nomina con la legenda e
  // ci porta il fuoco; il messaggio e' collegato a lei e al gruppo.
  const prima = comuni[0] ?? altre[0];
  const casella = (c: string) => (
    <div key={c} className="form-check lang-checklist__item">
      <input
        id={`${base}-${c}`}
        className={`form-check-input${invalid && c === prima ? ' is-invalid' : ''}`}
        type="checkbox"
        checked={scelte.includes(c)}
        onChange={(e) => cambia(c, e.target.checked)}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid && errorText && c === prima ? errorId : undefined}
        data-wizard-label={invalid && c === prima ? legend : undefined}
      />
      <label className="form-check-label" htmlFor={`${base}-${c}`} lang={c}>
        {nome(c)}
      </label>
    </div>
  );

  const descritto = [description ? `${base}-desc` : '', invalid && errorText ? errorId : '']
    .filter(Boolean)
    .join(' ');

  return (
    <fieldset
      className={`lang-checklist${invalid ? ' lang-checklist--invalid' : ''}`}
      aria-describedby={descritto || undefined}
    >
      <legend className="lang-checklist__legend">{legend}</legend>
      {description && (
        <p id={`${base}-desc`} className="lang-checklist__desc">
          {description}
        </p>
      )}
      <div className="lang-checklist__grid">{comuni.map(casella)}</div>
      {altre.length > 0 && (
        <details className="lang-checklist__more" open={apertoAllInizio || undefined}>
          <summary>
            {t('aiLanguagesOther')}
            {altreScelte > 0 && <span className="lang-checklist__count"> ({altreScelte})</span>}
          </summary>
          <div className="lang-checklist__grid">{altre.map(casella)}</div>
        </details>
      )}
      {invalid && errorText && (
        <div id={errorId} className="invalid-feedback d-block" role="alert">
          {errorText}
        </div>
      )}
      {!invalid && emptyHint && scelte.length === 0 && (
        <p className="lang-checklist__empty" role="status">
          {emptyHint}
        </p>
      )}
    </fieldset>
  );
}

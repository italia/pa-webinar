'use client';

/**
 * Le domande di un questionario come le leggera' chi risponde, in sola
 * lettura: per vedere che cosa si chiede senza aprire l'editor. Le usa chi
 * compone i questionari (il wizard, la pagina dell'evento, la libreria dei
 * modelli).
 */

import { useLocale, useTranslations } from 'next-intl';

import { getLocalized } from '@/lib/utils/locale';

export interface DomandaInLettura {
  /** Il testo per lingua, oppure gia' nella lingua di chi compone. */
  prompt: unknown;
  type: string;
  options?: unknown;
  scaleMin?: number | null;
  scaleMax?: number | null;
  required?: boolean;
}

export interface GruppoDiDomande {
  /** Da dove vengono: un modello della libreria o le domande dell'evento. */
  titolo?: string;
  domande: DomandaInLettura[];
}

const ETICHETTA_TIPO: Record<string, string> = {
  SINGLE_CHOICE: 'questionTypeSingle',
  MULTI_CHOICE: 'questionTypeMulti',
  YES_NO: 'questionTypeYesNo',
  LIKERT: 'questionTypeLikert',
  OPEN_TEXT: 'questionTypeOpen',
};

function testo(valore: unknown, locale: string): string {
  if (typeof valore === 'string') return valore.trim();
  if (valore && typeof valore === 'object') {
    return getLocalized(valore as Record<string, string>, locale).trim();
  }
  return '';
}

function opzioni(valore: unknown, locale: string): string[] {
  if (!Array.isArray(valore)) return [];
  return valore.map((o) => testo(o, locale)).filter(Boolean);
}

export default function ElencoDomande({ gruppi }: { gruppi: GruppoDiDomande[] }) {
  const t = useTranslations('admin.wizard.step4');
  const locale = useLocale();
  const pieni = gruppi.filter((g) => g.domande.length > 0);
  if (pieni.length === 0) {
    return <p className="elenco-domande__vuoto">{t('previewEmpty')}</p>;
  }
  // La numerazione continua da un gruppo all'altro: e' un solo questionario.
  const inizi: number[] = [];
  let prossima = 1;
  for (const g of pieni) {
    inizi.push(prossima);
    prossima += g.domande.length;
  }
  return (
    <div className="elenco-domande">
      {pieni.map((g, gi) => (
        <div key={gi} className="elenco-domande__gruppo">
          {g.titolo && <p className="elenco-domande__fonte">{g.titolo}</p>}
          <ol start={inizi[gi]} className="elenco-domande__lista">
            {g.domande.map((d, i) => {
              const scelte = opzioni(d.options, locale);
              const scala =
                d.type === 'LIKERT' && d.scaleMin != null && d.scaleMax != null
                  ? ` ${t('previewScale', { min: d.scaleMin, max: d.scaleMax })}`
                  : '';
              return (
                <li key={i}>
                  <span className="elenco-domande__testo">
                    {testo(d.prompt, locale) || t('previewUntitled')}
                    {d.required && (
                      <>
                        <span aria-hidden="true"> *</span>
                        <span className="visually-hidden"> ({t('required')})</span>
                      </>
                    )}
                  </span>
                  <span className="elenco-domande__tipo">
                    {t(ETICHETTA_TIPO[d.type] ?? 'questionTypeOpen')}
                    {scala}
                  </span>
                  {scelte.length > 0 && (
                    <ul className="elenco-domande__opzioni">
                      {scelte.map((o, oi) => (
                        <li key={oi}>{o}</li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}

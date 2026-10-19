'use client';

/**
 * Nella pagina dell'evento, accanto a «Gestisci questionari»: le domande che
 * l'evento fa prima (all'iscrizione) e dopo (il gradimento), in sola lettura.
 * Si leggono quando si aprono.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import ElencoDomande, {
  type DomandaInLettura,
  type GruppoDiDomande,
} from '@/components/questionnaires/elenco-domande';

interface Questionario {
  placement: 'PRE_REGISTRATION' | 'POST_EVENT';
  templates: Array<{ name: string; items?: DomandaInLettura[] }>;
  adhocItems: DomandaInLettura[];
}

const ORDINE = ['PRE_REGISTRATION', 'POST_EVENT'] as const;

export default function EventQuestionsPreview({ eventId }: { eventId: string }) {
  const t = useTranslations('admin.wizard.step4');
  const [stato, setStato] = useState<'chiuso' | 'carica' | 'pronto' | 'errore'>('chiuso');
  const [righe, setRighe] = useState<Questionario[]>([]);

  const leggi = async () => {
    setStato('carica');
    try {
      const res = await fetch(`/api/admin/events/${eventId}/questionnaires`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { rows?: Questionario[] };
      setRighe(Array.isArray(data.rows) ? data.rows : []);
      setStato('pronto');
    } catch {
      setStato('errore');
    }
  };

  const gruppi = (q: Questionario): GruppoDiDomande[] => [
    ...q.templates.map((tpl) => ({
      titolo: t('previewFromTemplate', { name: tpl.name }),
      domande: tpl.items ?? [],
    })),
    ...(q.adhocItems.length > 0
      ? [{ titolo: t('previewAdhoc'), domande: q.adhocItems }]
      : []),
  ];

  return (
    <details
      className="anteprima-domande mt-2"
      onToggle={(e) => {
        // A ogni apertura le domande di adesso; mai due letture insieme.
        if ((e.currentTarget as HTMLDetailsElement).open && stato !== 'carica')
          void leggi();
      }}
    >
      <summary>{t('previewShowAll')}</summary>
      <div aria-live="polite">
        {stato === 'carica' && (
          <p className="elenco-domande__vuoto">{t('previewLoading')}</p>
        )}
        {stato === 'errore' && (
          <p className="elenco-domande__vuoto">{t('previewError')}</p>
        )}
        {stato === 'pronto' && !righe.some((r) => ORDINE.includes(r.placement)) && (
          <p className="elenco-domande__vuoto">{t('previewEmpty')}</p>
        )}
        {stato === 'pronto' &&
          ORDINE.map((momento) => {
            const q = righe.find((r) => r.placement === momento);
            if (!q) return null;
            return (
              <section key={momento} className="anteprima-domande__momento">
                <h3 className="anteprima-domande__titolo">
                  {t(momento === 'PRE_REGISTRATION' ? 'preHeading' : 'postHeading')}
                </h3>
                <ElencoDomande gruppi={gruppi(q)} />
              </section>
            );
          })}
      </div>
    </details>
  );
}

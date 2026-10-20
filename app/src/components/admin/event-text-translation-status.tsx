'use client';

/**
 * Le lingue di titolo e descrizione nella pagina dell'evento
 * (lib/text-translation): una riga con lo stato di ogni lingua della pagina
 * («English: automatica · Français: in traduzione») e, se qualcosa e' da
 * rileggere o da aggiornare, il link ai testi nel wizard. Si rilegge ogni 10
 * secondi solo mentre una lingua si sta traducendo; senza altre lingue della
 * pagina non si mostra.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Link, percorso } from '@/i18n/navigation';
import type { StatoTestiEvento } from '@/lib/text-translation/auto';

import { nomeLingua } from './event-wizard/text-translation';

const IN_CORSO = new Set(['translating', 'waiting']);
const DA_RIVEDERE = new Set(['machine', 'stale', 'failed']);

export default function EventTextTranslationStatus({
  eventId,
  editHref,
}: {
  eventId: string;
  editHref: string;
}) {
  const t = useTranslations('admin.textTranslation');
  const [stato, setStato] = useState<StatoTestiEvento | null>(null);

  const carica = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/events/${eventId}/text-translation`, {
        cache: 'no-store',
      });
      if (r.ok) setStato((await r.json()) as StatoTestiEvento);
    } catch {
      /* rete assente: si riprova al prossimo giro, o resta quello che c'era */
    }
  }, [eventId]);

  useEffect(() => {
    void carica();
  }, [carica]);

  // Le lingue della pagina diverse dalla principale.
  const lingue = (stato?.lingue ?? []).filter(
    (l) => l.page && l.code !== stato?.principale && (l.event || l.state !== 'empty')
  );
  // Si rilegge mentre una lingua si traduce; di rado se il motore non e' partito.
  const ogni = lingue.some((l) => l.state === 'translating')
    ? 10_000
    : lingue.some((l) => IN_CORSO.has(l.state))
      ? 60_000
      : null;
  useEffect(() => {
    if (!ogni) return undefined;
    const id = setInterval(() => void carica(), ogni);
    return () => clearInterval(id);
  }, [ogni, carica]);

  const testo =
    lingue.length > 0
      ? t('status.summary', {
          list: lingue
            .map((l) =>
              t('status.item', { language: nomeLingua(l.code), state: t(`stateLower.${l.state}`) })
            )
            .join(' · '),
        })
      : null;
  const daRivedere = lingue.some((l) => DA_RIVEDERE.has(l.state));

  // La regione resta nella pagina anche vuota: chi usa un lettore di schermo
  // sente i cambi di stato.
  return (
    <div role="status" aria-live="polite" className={testo ? 'mb-4' : undefined}>
      {testo && (
        <div
          className="border rounded px-3 py-2 d-flex flex-wrap align-items-center gap-2"
          style={{ background: '#f8f9fa' }}
        >
          <span className="small">{testo}</span>
          {daRivedere && (
            <Link href={percorso(editHref)} className="small">
              {t('status.review')}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

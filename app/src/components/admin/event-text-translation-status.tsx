'use client';

/**
 * Lo stato della traduzione automatica di titolo e descrizione nella pagina
 * dell'evento (lib/text-translation): in coda, in corso, pronta (con il link
 * alla modifica dei testi, dove la si rilegge e la si salva) o non riuscita.
 * Si rilegge ogni 10 secondi solo mentre il lavoro e' in coda o in corso; se
 * non c'e' niente da dire, non si mostra.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Link, percorso } from '@/i18n/navigation';

import { nomeLingua } from './event-wizard/text-translation';

interface Stato {
  job: { status: string; lastError: string | null } | null;
  pending: string[];
}

const IN_CORSO = new Set(['PENDING', 'CLAIMED', 'RUNNING']);

export default function EventTextTranslationStatus({
  eventId,
  editHref,
}: {
  eventId: string;
  editHref: string;
}) {
  const t = useTranslations('admin.textTranslation.status');
  const [stato, setStato] = useState<Stato | null>(null);

  const carica = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/events/${eventId}/text-translation`, {
        cache: 'no-store',
      });
      if (r.ok) setStato((await r.json()) as Stato);
    } catch {
      /* rete assente: si riprova al prossimo giro, o resta quello che c'era */
    }
  }, [eventId]);

  useEffect(() => {
    void carica();
  }, [carica]);

  const inCorso = !!stato?.job && IN_CORSO.has(stato.job.status);
  useEffect(() => {
    if (!inCorso) return undefined;
    const id = setInterval(() => void carica(), 10_000);
    return () => clearInterval(id);
  }, [inCorso, carica]);

  const job = stato?.job;
  let testo: string | null = null;
  let pronta = false;
  if (job && IN_CORSO.has(job.status)) {
    testo = job.status === 'RUNNING' ? t('running') : t('queued');
  } else if (job?.status === 'FAILED') {
    testo = job.lastError ? t('failed', { reason: job.lastError }) : t('failedGeneric');
  } else if (stato && stato.pending.length > 0) {
    testo = t('ready', { languages: stato.pending.map(nomeLingua).join(', ') });
    pronta = true;
  }

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
          {pronta && (
            <Link href={percorso(editHref)} className="small">
              {t('review')}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

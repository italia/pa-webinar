'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { orologioEvento } from '@/lib/live/event-clock';

/**
 * Per chi partecipa o interviene: un avviso solo negli ultimi minuti prima
 * che la sala si chiuda da sola, oltre la fine prevista. Non un orologio (il
 * pubblico non vede il tempo che scorre), ma un'informazione da non perdere:
 * chi sta parlando deve sapere che la chiamata sta per finire.
 */
export default function ClosingNotice({
  startsAt,
  endsAt,
  graceMinutes,
  scartoOrologio = 0,
}: {
  startsAt: string;
  endsAt: string;
  /** Tetto del fuori orario in minuti dopo la fine; negativo = nessuno. */
  graceMinutes: number;
  /** Scarto fra l'orologio del server e quello di questo browser (ms). */
  scartoOrologio?: number;
}) {
  const t = useTranslations('live');
  const [now, setNow] = useState<number | null>(null);
  // L'annuncio per i lettori di schermo parte una volta, quando l'avviso
  // compare: il conto dei minuti, riletto a ogni cambio, coprirebbe chi parla.
  const [annuncio, setAnnuncio] = useState('');
  const annunciato = useRef(false);

  useEffect(() => {
    setNow(Date.now() + scartoOrologio);
    const id = setInterval(() => setNow(Date.now() + scartoOrologio), 15_000);
    return () => clearInterval(id);
  }, [scartoOrologio]);

  const inizio = new Date(startsAt).getTime();
  const fine = new Date(endsAt).getTime();
  const valido = now !== null && !Number.isNaN(inizio) && !Number.isNaN(fine);
  const orologio = valido ? orologioEvento({ now: now as number, inizio, fine, graceMinutes }) : null;
  const visibile = orologio?.fase === 'in-chiusura' && orologio.minutiAllaChiusura !== null;
  const testo = visibile ? t('closingNotice', { minutes: orologio.minutiAllaChiusura as number }) : '';

  useEffect(() => {
    if (visibile && !annunciato.current) {
      annunciato.current = true;
      setAnnuncio(testo);
    } else if (!visibile && annunciato.current) {
      // Finestra chiusa (fine spostata più in là): se torna, si riannuncia.
      annunciato.current = false;
      setAnnuncio('');
    }
  }, [visibile, testo]);

  return (
    <>
      {visibile && <div className="live-closing-notice">{testo}</div>}
      <span className="visually-hidden" role="status">
        {annuncio}
      </span>
    </>
  );
}

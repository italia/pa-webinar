'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Icon } from '@/components/ui/icon';
import { suonaAvvisoCattura } from '@/lib/live/capture-tone';

/** Quanto resta un avviso: poi resta il segnale fisso nella barra in alto. */
const DURATA_MS = 10_000;
/** Due cambi ravvicinati (chi entra a cattura in corso) fanno un suono solo. */
const SILENZIO_FRA_SUONI_MS = 2_000;

export interface CatturaInSala {
  /** Il video completo (Jibri). */
  video: boolean;
  /** Le voci, una traccia per persona. */
  voci: boolean;
  trascrizione: boolean;
}

type Tipo = keyof CatturaInSala;
interface Avviso {
  id: number;
  tipo: Tipo;
  acceso: boolean;
}

const TESTO = {
  video: { on: 'captureNoticeRecordingOn', off: 'captureNoticeRecordingOff' },
  voci: { on: 'captureNoticeVoicesOn', off: 'captureNoticeVoicesOff' },
  trascrizione: {
    on: 'captureNoticeTranscriptionOn',
    off: 'captureNoticeTranscriptionOff',
  },
} as const;

const NESSUNA: CatturaInSala = { video: false, voci: false, trascrizione: false };

/**
 * L'avviso che una registrazione o una trascrizione parte o si ferma, con un
 * segnale sonoro. Vale anche per chi entra a cattura gia' in corso: per lui
 * parte in quel momento. Video e voci si seguono a parte: fermare il video
 * mentre le voci continuano va detto. Non e' una finestra: arriva da solo e
 * non deve togliere il fuoco a chi sta parlando o scrivendo.
 */
export default function CaptureNotice({ video, voci, trascrizione }: CatturaInSala) {
  const t = useTranslations('live');
  const tc = useTranslations('common');
  const [avvisi, setAvvisi] = useState<Avviso[]>([]);
  const statoRef = useRef<CatturaInSala>(NESSUNA);
  const prossimoId = useRef(0);
  const ultimoSuono = useRef(0);
  const timer = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const adesso: CatturaInSala = { video, voci, trascrizione };
    const prima = statoRef.current;
    statoRef.current = adesso;
    const cambi = (Object.keys(adesso) as Tipo[])
      .filter((tipo) => adesso[tipo] !== prima[tipo])
      .map((tipo) => ({ id: ++prossimoId.current, tipo, acceso: adesso[tipo] }));
    if (cambi.length === 0) return;
    if (Date.now() - ultimoSuono.current > SILENZIO_FRA_SUONI_MS) {
      ultimoSuono.current = Date.now();
      void suonaAvvisoCattura(cambi.some((c) => c.acceso));
    }
    setAvvisi((attuali) => [
      ...attuali.filter((a) => !cambi.some((c) => c.tipo === a.tipo)),
      ...cambi,
    ]);
    for (const { id } of cambi) {
      const scadenza = setTimeout(() => {
        timer.current.delete(scadenza);
        setAvvisi((attuali) => attuali.filter((a) => a.id !== id));
      }, DURATA_MS);
      timer.current.add(scadenza);
    }
  }, [video, voci, trascrizione]);

  useEffect(() => {
    const inCorso = timer.current;
    return () => {
      for (const scadenza of inCorso) clearTimeout(scadenza);
    };
  }, []);

  // La regione resta montata e cambia testo: un contenitore che nasce gia'
  // pieno molti lettori di schermo non lo annunciano.
  return (
    <div className="live-capture-notice-slot" role="status">
      {avvisi.length > 0 && (
        <div
          className={`live-capture-notice${avvisi.some((a) => a.acceso) ? ' live-capture-notice--on' : ''}`}
        >
          <span className="live-capture-notice__testo">
            {avvisi.map((a) => (
              <span key={a.id} className="d-block">
                {t(TESTO[a.tipo][a.acceso ? 'on' : 'off'])}
              </span>
            ))}
          </span>
          <button
            type="button"
            className="live-capture-notice__chiudi"
            aria-label={tc('close')}
            onClick={() => setAvvisi([])}
          >
            <Icon icon="it-close" size="sm" color="white" />
          </button>
        </div>
      )}
    </div>
  );
}

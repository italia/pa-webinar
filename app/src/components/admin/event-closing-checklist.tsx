'use client';

/**
 * «Chiudi l'evento»: in cima alla scheda «Dopo l'evento», cosa resta da fare.
 *
 * Una voce per ogni cosa che si chiude dopo la fine — registrazione,
 * trascrizione, resoconto, sala, materiali, valutazioni, pagina pubblica — con
 * il suo stato e un pulsante che porta alla parte della scheda dove si fa.
 * Gli stati li decide il server (lib/events/closing); qui si rileggono a
 * intervalli e al ritorno sulla pagina, cosi' quello che si pubblica piu'
 * sotto si vede spuntare qui senza ricaricare.
 */
import useSWR from 'swr';
import { useTranslations } from 'next-intl';

import { Link, percorso } from '@/i18n/navigation';
import type { StatoChiusura, StatoVoce, VoceStato } from '@/lib/events/closing';

/** Le parti della scheda a cui portano le voci (id degli elementi). */
export const ANCORE_CHIUSURA = {
  registrazione: 'dopo-registrazione',
  pagina: 'dopo-pagina',
  valutazioni: 'dopo-valutazioni',
  resoconto: 'dopo-resoconto',
  ai: 'dopo-ai',
  trascrizione: 'dopo-trascrizione',
} as const;

const CHIAVE_STATO: Record<StatoVoce, 'fatto' | 'daFare' | 'inCorso' | 'nonServe'> = {
  fatto: 'fatto',
  'da-fare': 'daFare',
  'in-corso': 'inCorso',
  'non-serve': 'nonServe',
};

function IconaStato({ stato }: { stato: StatoVoce }) {
  const comune = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  if (stato === 'fatto')
    return (
      <svg {...comune}>
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  if (stato === 'da-fare')
    return (
      <svg {...comune}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 16.5v.01" />
      </svg>
    );
  if (stato === 'in-corso')
    return (
      <svg {...comune}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  return (
    <svg {...comune}>
      <path d="M6 12h12" />
    </svg>
  );
}

/** Porta alla parte della scheda e ci mette il fuoco, senza scatti se il
 *  sistema chiede meno movimento. */
function vaiA(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const fermo = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: fermo ? 'auto' : 'smooth', block: 'start' });
  el.focus({ preventScroll: true });
}

export default function EventClosingChecklist({
  eventId,
  token,
  conTrascrizioneDaiSottotitoli,
  onMateriali,
}: {
  eventId: string;
  /** Il token di chi ha aperto la pagina dal link del moderatore; null per lo staff. */
  token: string | null;
  /** La parte «Trascrizione dai sottotitoli» c'e' nella scheda. */
  conTrascrizioneDaiSottotitoli: boolean;
  /** Apre la scheda dei contenuti, dove si aggiungono i materiali. */
  onMateriali: () => void;
}) {
  const t = useTranslations('admin.closing');
  const staff = token == null;
  const { data, error } = useSWR<StatoChiusura>(
    [`/api/admin/events/${eventId}/closing`, token],
    async ([url, tk]: [string, string | null]) => {
      const res = await fetch(
        url,
        tk ? { headers: { Authorization: `Bearer ${tk}` } } : undefined
      );
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as StatoChiusura;
    },
    { refreshInterval: 15_000, revalidateOnFocus: true }
  );

  function azione(v: VoceStato) {
    // Tanti «Apri» uguali: chi usa un lettore di schermo sente anche quale.
    const nomeVoce = t(`${v.voce}.title`);
    const pulsante = (testo: string, onClick: () => void) => (
      <button
        type="button"
        className="btn btn-outline-primary btn-sm"
        aria-label={`${testo}: ${nomeVoce}`}
        onClick={onClick}
      >
        {testo}
      </button>
    );
    switch (v.voce) {
      case 'registrazione':
        return v.stato === 'non-serve'
          ? null
          : pulsante(t('azioni.apri'), () => vaiA(ANCORE_CHIUSURA.registrazione));
      case 'trascrizione':
        if (v.stato === 'non-serve') return null;
        if (v.caso === 'prontaSottotitoli' && conTrascrizioneDaiSottotitoli) {
          return pulsante(t('azioni.rivedi'), () => vaiA(ANCORE_CHIUSURA.trascrizione));
        }
        // L'editor della trascrizione vive con la registrazione: ci entra lo
        // staff, e il ritorno riporta qui.
        return staff && v.recordingId ? (
          <Link
            href={percorso(`/admin/postprod/${v.recordingId}`)}
            className="btn btn-outline-primary btn-sm"
          >
            {t('azioni.rivedi')}
          </Link>
        ) : (
          pulsante(t('azioni.apri'), () => vaiA(ANCORE_CHIUSURA.ai))
        );
      case 'resoconto':
        return v.stato === 'non-serve' || !staff
          ? null
          : pulsante(t('azioni.apri'), () => vaiA(ANCORE_CHIUSURA.resoconto));
      case 'sala':
        return v.stato === 'non-serve'
          ? null
          : pulsante(t('azioni.apri'), () => vaiA(ANCORE_CHIUSURA.pagina));
      case 'materiali':
        // Ci sono ma la pagina non li mostra: si accende la sezione nella
        // configurazione dopo l'evento, non si aggiungono materiali.
        return v.caso === 'nascosti'
          ? pulsante(t('azioni.apri'), () => vaiA(ANCORE_CHIUSURA.pagina))
          : pulsante(t('azioni.materiali'), onMateriali);
      case 'valutazioni':
        if (v.stato === 'non-serve') return null;
        return pulsante(t('azioni.apri'), () =>
          vaiA(
            v.caso === 'emailSpenta'
              ? ANCORE_CHIUSURA.pagina
              : ANCORE_CHIUSURA.valutazioni
          )
        );
      case 'pagina':
        return v.stato === 'non-serve'
          ? null
          : pulsante(t('azioni.apri'), () => vaiA(ANCORE_CHIUSURA.pagina));
      default:
        return null;
    }
  }

  return (
    <section className="chiusura mb-4" aria-labelledby="chiusura-titolo">
      <div className="chiusura__testata">
        <h2 id="chiusura-titolo" className="chiusura__titolo">
          {t('title')}
        </h2>
        {data && (
          <p
            className={`chiusura__riepilogo${data.daFare > 0 ? ' chiusura__riepilogo--da-fare' : ''}`}
            role="status"
          >
            {data.daFare > 0
              ? t('summaryTodo', { count: data.daFare })
              : t('summaryDone')}
          </p>
        )}
      </div>
      <p className="chiusura__intro">{t('intro')}</p>

      {/* Una rilettura fallita non toglie la lista: si tiene l'ultima buona. */}
      {!data && error ? (
        <p className="chiusura__errore" role="alert">
          {t('error')}
        </p>
      ) : !data ? (
        <p className="chiusura__attesa" aria-busy="true">
          {t('loading')}
        </p>
      ) : (
        <ul className="chiusura__lista">
          {data.voci.map((v) => (
            <li key={v.voce} className={`chiusura__voce chiusura__voce--${v.stato}`}>
              <span className="chiusura__stato">
                <IconaStato stato={v.stato} />
                {t(`stato.${CHIAVE_STATO[v.stato]}`)}
              </span>
              <span className="chiusura__testo">
                <strong>{t(`${v.voce}.title`)}</strong>
                <span>{t(`${v.voce}.${v.caso}`, v.numeri ?? {})}</span>
              </span>
              <span className="chiusura__azione">{azione(v)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

'use client';

/**
 * La traduzione automatica di titolo e descrizione nel wizard
 * (lib/text-translation, api/admin/events/[id]/text-translation).
 *
 * In modifica: si chiede con il testo del modulo, anche non salvato, e
 * finche' il lavoro e' in coda o in corso lo stato si rilegge ogni 10
 * secondi. Quando e' pronto, le traduzioni riempiono SOLO i campi ancora
 * vuoti, e solo se il testo di partenza del modulo e' ancora quello chiesto;
 * le lingue riempite si segnano come da rileggere: un testo scritto da una
 * persona non si sostituisce mai, e il salvataggio del wizard e' la
 * revisione. Aprendo il wizard, le proposte gia' pronte per lo stesso testo
 * di partenza si offrono con un pulsante.
 *
 * In creazione l'evento non ha ancora un id: si sceglie qui se tradurre dopo
 * il salvataggio, e la richiesta la fa il wizard dopo aver creato l'evento.
 *
 * Si mostra solo allo staff e solo se l'installazione ha la pipeline AI
 * accesa e il motore di traduzione su CPU: altrimenti il wizard non cambia.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { localeNames, type Locale } from '@/i18n/config';
import {
  codiceErrore,
  messaggioErroreApi,
  type ApiErrorKey,
} from '@/lib/api-error-message';
import {
  letturaTraduzioni,
  proposteApplicabili,
  type TextTranslations,
} from '@/lib/text-translation/proposals';
import {
  improntaSorgente,
  testoSorgente,
  type TestoSorgente,
} from '@/lib/text-translation/source';

const IN_CORSO = new Set(['PENDING', 'CLAIMED', 'RUNNING']);
const OGNI_MS = 10_000;

interface Lavoro {
  status: string;
  /** Il motivo riconosciuto di un lavoro non riuscito; il testo grezzo
   *  (lastError, in inglese) resta al registro della post-produzione. */
  errorCode?: 'MT_UNAVAILABLE' | null;
  sourceHash: string | null;
}

type Messaggio =
  | {
      tipo:
        | 'queued'
        | 'running'
        | 'busy'
        | 'sourceChanged'
        | 'noTargets'
        | 'sourceMissing'
        | 'doneNothing'
        | 'failedGeneric';
    }
  | { tipo: 'done'; lingue: string[] }
  | { tipo: 'failed'; motivo: string }
  | { tipo: 'error'; testo: string };

/** Il nome di una lingua come nella barra delle lingue. */
export function nomeLingua(codice: string): string {
  return localeNames[codice as Locale] ?? codice.toUpperCase();
}

/**
 * Le lingue (attive, non quella di partenza) che hanno ancora un campo vuoto
 * dove la lingua di partenza ha testo: la scelta di partenza delle caselle.
 */
export function lingueDaTradurre(
  lingueAttive: string[],
  sorgente: string,
  titoli: Record<string, string>,
  descrizioni: Record<string, string>
): string[] {
  const conTitolo = !!titoli[sorgente]?.trim();
  const conDescrizione = !!descrizioni[sorgente]?.trim();
  return lingueAttive.filter(
    (l) =>
      l !== sorgente &&
      ((conTitolo && !titoli[l]?.trim()) || (conDescrizione && !descrizioni[l]?.trim()))
  );
}

export interface StatoTraduzione {
  /** La traduzione chiesta da questa pagina e' in coda o in corso. */
  inCorso: boolean;
  invio: boolean;
  messaggio: Messaggio | null;
  /** Le lingue che una proposta gia' pronta riempirebbe nel modulo. */
  offerte: string[];
  chiedi: (lingue: string[]) => Promise<void>;
  usaOfferte: () => void;
}

/**
 * Lo stato della traduzione automatica in modifica. `applica` riempie i
 * campi vuoti del modulo e restituisce le lingue riempite.
 */
export function useTraduzioneTesti(opts: {
  attiva: boolean;
  eventId: string | null;
  sorgente: string;
  titoli: Record<string, string>;
  descrizioni: Record<string, string>;
  applica: (proposta: TextTranslations, lingue: string[]) => string[];
}): StatoTraduzione {
  const { attiva, eventId, sorgente, titoli, descrizioni, applica } = opts;
  const tErr = useTranslations('apiErrors');
  const t = useTranslations('admin.textTranslation');
  const [lavoro, setLavoro] = useState<Lavoro | null>(null);
  const [proposta, setProposta] = useState<TextTranslations | null>(null);
  const [messaggio, setMessaggio] = useState<Messaggio | null>(null);
  const [invio, setInvio] = useState(false);
  const [impronta, setImpronta] = useState<string | null>(null);
  // L'impronta del testo di cui questa pagina ha chiesto la traduzione:
  // solo quel lavoro, finito, riempie i campi da solo.
  const nostro = useRef<string | null>(null);
  // La richiesta di questa pagina e' stata respinta perche' l'evento ha gia'
  // un'altra traduzione in coda o in corso: lo si dice finche' non finisce.
  const occupato = useRef(false);
  const applicaRef = useRef(applica);
  applicaRef.current = applica;
  // Il testo di partenza com'e' ora nel modulo: a lavoro finito si confronta
  // con quello chiesto.
  const testo = testoSorgente(sorgente, titoli, descrizioni);
  const testoRef = useRef<TestoSorgente>(testo);
  testoRef.current = testo;

  const carica = useCallback(async (): Promise<void> => {
    if (!eventId) return;
    try {
      const r = await fetch(`/api/admin/events/${eventId}/text-translation`, {
        cache: 'no-store',
      });
      if (!r.ok) return;
      const dati = (await r.json()) as { job: Lavoro | null; proposals: unknown };
      const p = letturaTraduzioni(dati.proposals);
      setLavoro(dati.job);
      setProposta(p);
      const job = dati.job;
      if (job && IN_CORSO.has(job.status)) {
        // Anche un lavoro chiesto altrove (alla creazione, da un'altra
        // finestra): si dice che c'e', e a lavoro finito la proposta si offre.
        // Se ha appena fatto respingere la richiesta di questa pagina, resta
        // l'avviso: «in coda» farebbe credere accodata la richiesta respinta.
        setMessaggio(
          occupato.current
            ? { tipo: 'busy' }
            : { tipo: job.status === 'RUNNING' ? 'running' : 'queued' }
        );
        return;
      }
      occupato.current = false;
      const chiesta = nostro.current;
      if (!chiesta) {
        setMessaggio((prima) =>
          prima?.tipo === 'queued' || prima?.tipo === 'running' || prima?.tipo === 'busy'
            ? null
            : prima
        );
        return;
      }
      nostro.current = null;
      if (p && p.sourceHash === chiesta) {
        // La traduzione chiesta da qui e' pronta (appena consegnata, o gia'
        // salvata per lo stesso testo). Se nel frattempo il testo di partenza
        // del modulo e' cambiato, tradurrebbe un testo che non c'e' piu': non
        // riempie niente, e la proposta torna utile solo se il testo torna
        // quello di prima (l'offerta la confronta con il modulo).
        if ((await improntaSorgente(testoRef.current)) !== chiesta) {
          setMessaggio({ tipo: 'sourceChanged' });
          return;
        }
        // Riempie i campi ancora vuoti.
        const riempite = applicaRef.current(p, [
          ...new Set([...Object.keys(p.title), ...Object.keys(p.description)]),
        ]);
        setMessaggio(
          riempite.length > 0
            ? { tipo: 'done', lingue: riempite }
            : { tipo: 'doneNothing' }
        );
      } else if (job?.status === 'FAILED' && job.sourceHash === chiesta) {
        setMessaggio(
          job.errorCode === 'MT_UNAVAILABLE'
            ? { tipo: 'failed', motivo: tErr('mtUnavailable') }
            : { tipo: 'failedGeneric' }
        );
      } else {
        setMessaggio({ tipo: 'failedGeneric' });
      }
    } catch {
      /* rete assente: si riprova al prossimo giro */
    }
  }, [eventId, tErr]);

  useEffect(() => {
    if (attiva) void carica();
  }, [attiva, carica]);

  const inCorso = !!lavoro && IN_CORSO.has(lavoro.status);
  useEffect(() => {
    if (!attiva || !inCorso) return undefined;
    const id = setInterval(() => void carica(), OGNI_MS);
    return () => clearInterval(id);
  }, [attiva, inCorso, carica]);

  // L'impronta del testo di partenza del modulo, per riconoscere le proposte
  // che vengono da questo testo.
  useEffect(() => {
    let vivo = true;
    void improntaSorgente(testo).then((h) => {
      if (vivo) setImpronta(h);
    });
    return () => {
      vivo = false;
    };
  }, [testo.sourceLanguage, testo.title, testo.description]); // eslint-disable-line react-hooks/exhaustive-deps

  const offerte = useMemo(
    () =>
      attiva && !nostro.current
        ? proposteApplicabili(proposta, impronta, titoli, descrizioni)
        : [],
    [attiva, proposta, impronta, titoli, descrizioni]
  );

  const chiedi = useCallback(
    async (lingue: string[]) => {
      if (!eventId) return;
      if (!testo.title && !testo.description) {
        setMessaggio({ tipo: 'sourceMissing' });
        return;
      }
      if (lingue.length === 0) {
        setMessaggio({ tipo: 'noTargets' });
        return;
      }
      setInvio(true);
      try {
        const h = await improntaSorgente(testo);
        const r = await fetch(`/api/admin/events/${eventId}/text-translation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceLanguage: testo.sourceLanguage,
            title: testo.title,
            description: testo.description,
            targetLanguages: lingue,
          }),
        });
        if (!r.ok) {
          const codice = await codiceErrore(r);
          setMessaggio({
            tipo: 'error',
            testo: messaggioErroreApi(
              r.status,
              (k: ApiErrorKey) => tErr(k),
              t('error'),
              {},
              codice
            ),
          });
          return;
        }
        const esito = (await r.json()) as { stato: string; sourceHash?: string | null };
        if (esito.stato === 'in-corso' && esito.sourceHash !== h) {
          // Una traduzione di un altro testo: la si lascia finire, e non si
          // accoda niente.
          occupato.current = true;
          setMessaggio({ tipo: 'busy' });
        } else {
          occupato.current = false;
          nostro.current = h;
          setMessaggio({ tipo: 'queued' });
        }
        await carica();
      } catch {
        setMessaggio({ tipo: 'error', testo: t('error') });
      } finally {
        setInvio(false);
      }
    },
    [eventId, testo.sourceLanguage, testo.title, testo.description, carica, t, tErr] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const usaOfferte = useCallback(() => {
    if (!proposta || offerte.length === 0) return;
    const riempite = applicaRef.current(proposta, offerte);
    setMessaggio(
      riempite.length > 0 ? { tipo: 'done', lingue: riempite } : { tipo: 'doneNothing' }
    );
  }, [proposta, offerte]);

  return {
    inCorso: inCorso && nostro.current !== null,
    invio,
    messaggio,
    offerte,
    chiedi,
    usaOfferte,
  };
}

function TestoMessaggio({ messaggio }: { messaggio: Messaggio }) {
  const t = useTranslations('admin.textTranslation');
  switch (messaggio.tipo) {
    case 'done':
      return <>{t('done', { languages: messaggio.lingue.map(nomeLingua).join(', ') })}</>;
    case 'failed':
      return <>{t('failed', { reason: messaggio.motivo })}</>;
    case 'sourceChanged':
      return <>{t('sourceChanged', { button: t('start') })}</>;
    case 'error':
      return <>{messaggio.testo}</>;
    default:
      return <>{t(messaggio.tipo)}</>;
  }
}

/**
 * La scheda sotto le lingue del passo «Evento»: le lingue in cui tradurre e,
 * in modifica, il pulsante e lo stato; in creazione, la scelta di tradurre
 * dopo il salvataggio.
 */
export function TraduzioneTestiCard(
  props: {
    lingueAttive: string[];
    sorgente: string;
    titoli: Record<string, string>;
    descrizioni: Record<string, string>;
  } & (
    | { mode: 'edit'; stato: StatoTraduzione }
    | {
        mode: 'create';
        dopo: { attiva: boolean; lingue: string[] | null };
        onDopo: (v: { attiva: boolean; lingue: string[] | null }) => void;
      }
  )
) {
  const t = useTranslations('admin.textTranslation');
  const { lingueAttive, sorgente, titoli, descrizioni } = props;
  const candidate = lingueAttive.filter((l) => l !== sorgente);
  const vuote = lingueDaTradurre(lingueAttive, sorgente, titoli, descrizioni);
  // In modifica la scelta resta quella di partenza finche' non si tocca.
  const [sceltaEdit, setSceltaEdit] = useState<string[] | null>(null);
  const scelte =
    props.mode === 'edit' ? (sceltaEdit ?? vuote) : (props.dopo.lingue ?? vuote);
  const imposta = (lingue: string[]) => {
    if (props.mode === 'edit') setSceltaEdit(lingue);
    else props.onDopo({ ...props.dopo, lingue });
  };
  const alterna = (l: string) =>
    imposta(
      scelte.includes(l)
        ? scelte.filter((x) => x !== l)
        : candidate.filter((x) => x === l || scelte.includes(x))
    );
  if (candidate.length === 0) return null;
  const disattiva =
    props.mode === 'edit' ? props.stato.invio || props.stato.inCorso : !props.dopo.attiva;

  const caselle = (
    <fieldset className="mb-2" disabled={disattiva}>
      <legend className="small fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>
        {t('languages')}
      </legend>
      <div className="d-flex flex-wrap gap-2">
        {candidate.map((l) => (
          <div key={l} className="form-check form-check-inline me-2 mb-0">
            <input
              id={`traduci-${l}`}
              type="checkbox"
              className="form-check-input"
              checked={scelte.includes(l)}
              onChange={() => alterna(l)}
            />
            <label className="form-check-label small" htmlFor={`traduci-${l}`}>
              {nomeLingua(l)}
            </label>
          </div>
        ))}
      </div>
    </fieldset>
  );

  return (
    <section
      className="border rounded p-3 mb-3"
      style={{ background: '#fff' }}
      aria-labelledby="traduzione-testi-titolo"
    >
      <h3
        id="traduzione-testi-titolo"
        className="h6 fw-semibold mb-1"
        style={{ color: 'var(--app-text)' }}
      >
        {t('heading')}
      </h3>
      <p className="text-secondary mb-2" style={{ fontSize: '0.85rem' }}>
        {t('intro')}
      </p>
      {props.mode === 'create' ? (
        <>
          <div className="form-check mb-2">
            <input
              id="traduci-dopo"
              type="checkbox"
              className="form-check-input"
              checked={props.dopo.attiva}
              onChange={(e) => props.onDopo({ ...props.dopo, attiva: e.target.checked })}
              aria-describedby="traduci-dopo-aiuto"
            />
            <label className="form-check-label" htmlFor="traduci-dopo">
              {t('afterCreate')}
            </label>
            <small id="traduci-dopo-aiuto" className="form-text text-muted d-block">
              {t('afterCreateHelp')}
            </small>
          </div>
          {props.dopo.attiva && caselle}
        </>
      ) : (
        <>
          {props.stato.offerte.length > 0 && (
            <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
              <span className="small">
                {t('offer', {
                  languages: props.stato.offerte.map(nomeLingua).join(', '),
                })}
              </span>
              <button
                type="button"
                className="btn btn-sm btn-outline-primary"
                onClick={props.stato.usaOfferte}
              >
                {t('useOffer')}
              </button>
            </div>
          )}
          {caselle}
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={disattiva || scelte.length === 0}
            onClick={() => void props.stato.chiedi(scelte)}
          >
            {t('start')}
          </button>
          <p className="small mb-0 mt-2" role="status" aria-live="polite">
            {props.stato.messaggio && (
              <TestoMessaggio messaggio={props.stato.messaggio} />
            )}
          </p>
        </>
      )}
    </section>
  );
}

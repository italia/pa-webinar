'use client';

/**
 * Le lingue dell'evento nel passo «Evento»: la riga «Lingue dell'evento»
 * (con la scelta delle lingue), lo stato scritto di ogni scheda di titolo e
 * descrizione, e l'avviso con le azioni dentro la scheda.
 *
 * Le lingue dell'evento sono un solo elenco (Event.aiTargetLocales): le
 * schede, la traduzione automatica al salvataggio (nelle lingue attive sul
 * sito) e, se accesa, la traduzione di sottotitoli e sintesi. La traduzione la
 * decide il server dopo il salvataggio (lib/text-translation/auto): qui si
 * dice che cosa succedera', senza promettere niente a motore spento.
 *
 * Lo stato di ogni lingua viene dal server (stato-lingue), corretto da cio'
 * che si fa in questa pagina: una lingua toccata (scritta, «Segna come
 * riletta», «È ancora corretta») e' di una persona; se il testo principale
 * del modulo non e' piu' quello caricato, le altre lingue non vengono piu' da
 * lui. Lo staff rilegge lo stato ogni 10 secondi mentre una lingua si sta
 * traducendo, e il testo arrivato entra nelle lingue che non ha toccato.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import LanguageChecklist, { parseLocaleList } from '@/components/admin/language-checklist';
import { Icon } from '@/components/ui/icon';
import type { StatoScheda as AspettoScheda } from '@/components/ui/locale-tab-bar';
import { localeNames, type Locale } from '@/i18n/config';
import { Link, percorso } from '@/i18n/navigation';
import { codiceErrore, messaggioErroreApi, type ApiErrorKey } from '@/lib/api-error-message';
import type { StatoTestiEvento } from '@/lib/text-translation/auto';
import {
  haTesto,
  statoLingua,
  type StatoScheda,
} from '@/lib/text-translation/stato-lingue';

const OGNI_MS = 10_000;
/** Mentre il motore non parte («in attesa») si rilegge di rado. */
const IN_ATTESA_OGNI_MS = 60_000;

/** Il nome di una lingua nella lingua stessa, come nelle schede. */
export function nomeLingua(codice: string): string {
  const noto = localeNames[codice as Locale];
  if (noto) return noto;
  try {
    return new Intl.DisplayNames([codice], { type: 'language' }).of(codice) ?? codice;
  } catch {
    return codice.toUpperCase();
  }
}

/** Il nome di una lingua nella lingua dell'interfaccia («italiano»), per le frasi. */
export function nomeNellaFrase(codice: string, interfaccia: string): string {
  try {
    return new Intl.DisplayNames([interfaccia], { type: 'language' }).of(codice) ?? codice;
  } catch {
    return nomeLingua(codice);
  }
}

/** L'aspetto di ogni stato nella sua scheda: icona e tono (mai il solo colore). */
const ASPETTO: Record<StatoScheda, Omit<AspettoScheda, 'testo'>> = {
  principale: { icona: 'it-star-full', tono: 'neutro' },
  onSave: { icona: 'it-refresh', tono: 'info' },
  translating: { icona: 'it-clock', tono: 'info' },
  waiting: { icona: 'it-clock', tono: 'avviso' },
  machine: { icona: 'it-exchange-circle', tono: 'avviso' },
  human: { icona: 'it-check-circle', tono: 'successo' },
  stale: { icona: 'it-warning-circle', tono: 'errore' },
  failed: { icona: 'it-error', tono: 'errore' },
  empty: { icona: 'it-minus-circle', tono: 'neutro' },
};

/** Il testo principale, senza spazi ai bordi: per sapere se e' cambiato. */
export interface TestoPrincipale {
  title: string;
  description: string;
}

export function testoPrincipale(
  principale: string,
  titoli: Record<string, string>,
  descrizioni: Record<string, string>
): TestoPrincipale {
  return {
    title: (titoli[principale] ?? '').trim(),
    description: (descrizioni[principale] ?? '').trim(),
  };
}

/**
 * Le schede di titolo e descrizione: la lingua principale, le lingue
 * dell'evento attive sul sito, e quelle del sito che hanno gia' un testo.
 */
export function schedeDelleLingue(opts: {
  principale: string;
  attive: readonly string[];
  lingueEvento: readonly string[];
  titoli: Record<string, string>;
  descrizioni: Record<string, string>;
}): string[] {
  const { principale, attive, lingueEvento, titoli, descrizioni } = opts;
  const pagina = lingueEvento.filter((l) => l !== principale && attive.includes(l));
  const conTesto = attive.filter(
    (l) => l !== principale && !pagina.includes(l) && haTesto(l, titoli, descrizioni)
  );
  return [principale, ...pagina, ...conTesto];
}

export interface StatoLingueEvento {
  schede: string[];
  stati: Record<string, StatoScheda>;
  /** Perche' e' fallita, per le lingue «Non riuscita». */
  fallimenti: Record<string, 'MT_UNAVAILABLE' | 'GENERIC'>;
  /** «Riprova»: la traduzione della lingua, subito (solo lo staff). */
  riprova: (lingua: string) => Promise<void>;
  /** La lingua per cui si sta chiedendo la traduzione. */
  inviando: string | null;
  errore: string | null;
  /** Il testo della regione che annuncia le traduzioni arrivate. */
  annuncio: string;
  /** Rilegge lo stato (lo staff, dopo un salvataggio). */
  ricarica: () => Promise<void>;
  /** Le letture partite prima di adesso non valgono (dopo un salvataggio). */
  scarta: () => void;
}

/** Lo stato delle lingue dell'evento nel wizard. */
export function useLingueEvento(opts: {
  eventId: string | null;
  iniziale: StatoTestiEvento | null;
  /** La traduzione automatica c'e' per questo evento. */
  motore: boolean;
  /** Lo staff rilegge lo stato e puo' riprovare. */
  staff: boolean;
  principale: string;
  attive: readonly string[];
  lingueEvento: readonly string[];
  titoli: Record<string, string>;
  descrizioni: Record<string, string>;
  toccate: ReadonlySet<string>;
  /** Il testo principale come lo conosce il server. */
  principaleSalvato: TestoPrincipale;
  /** Titolo e descrizione arrivati dal server, per le lingue non toccate. */
  onArrivati: (testi: StatoTestiEvento['testi']) => void;
}): StatoLingueEvento {
  const { eventId, motore, staff, principale, attive, lingueEvento, titoli, descrizioni, toccate } =
    opts;
  const t = useTranslations('admin.textTranslation');
  const tErr = useTranslations('apiErrors');
  const [server, setServer] = useState<StatoTestiEvento | null>(opts.iniziale);
  const [inviando, setInviando] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [annuncio, setAnnuncio] = useState('');
  const [ora, setOra] = useState(() => Date.now());
  const arrivatiRef = useRef(opts.onArrivati);
  arrivatiRef.current = opts.onArrivati;
  const serverRef = useRef(server);
  serverRef.current = server;

  // Ogni salvataggio cambia il giro: una lettura partita prima non vale piu'
  // (riporterebbe nel modulo il testo che il salvataggio ha appena cambiato).
  const giro = useRef(0);
  const scarta = useCallback(() => {
    giro.current += 1;
  }, []);

  const ricarica = useCallback(async () => {
    if (!eventId || !staff) return;
    const mio = giro.current;
    try {
      const r = await fetch(`/api/admin/events/${eventId}/text-translation`, { cache: 'no-store' });
      if (!r.ok || mio !== giro.current) return;
      const nuovo = (await r.json()) as StatoTestiEvento;
      if (mio !== giro.current) return;
      if (!Array.isArray(nuovo?.lingue) || !nuovo.testi) return;
      const prima = serverRef.current;
      // Le lingue che erano in traduzione e ora hanno un testo automatico.
      const pronte = nuovo.lingue
        .filter(
          (l) =>
            l.state === 'machine' &&
            prima?.lingue.some(
              (p) => p.code === l.code && (p.state === 'translating' || p.state === 'waiting')
            )
        )
        .map((l) => l.code);
      setServer(nuovo);
      setOra(Date.now());
      arrivatiRef.current(nuovo.testi);
      if (pronte.length > 0)
        setAnnuncio(t('announceReady', { languages: pronte.map(nomeLingua).join(', ') }));
    } catch {
      /* rete assente: si riprova al prossimo giro */
    }
  }, [eventId, staff, t]);

  const principaleCambiato = useMemo(() => {
    const ora = testoPrincipale(principale, titoli, descrizioni);
    return (
      ora.title !== opts.principaleSalvato.title ||
      ora.description !== opts.principaleSalvato.description
    );
  }, [principale, titoli, descrizioni, opts.principaleSalvato]);

  const schede = useMemo(
    () => schedeDelleLingue({ principale, attive, lingueEvento, titoli, descrizioni }),
    [principale, attive, lingueEvento, titoli, descrizioni]
  );

  const { stati, fallimenti } = useMemo(() => {
    const stati: Record<string, StatoScheda> = {};
    const fallimenti: Record<string, 'MT_UNAVAILABLE' | 'GENERIC'> = {};
    const lavoro = server?.job ?? null;
    for (const l of schede) {
      const s = server?.lingue.find((x) => x.code === l);
      const toccata = toccate.has(l);
      const inTraduzione =
        !toccata && !!s && (s.state === 'translating' || s.state === 'waiting') && !!lavoro;
      const fallita = !toccata && !principaleCambiato && s?.state === 'failed';
      stati[l] = statoLingua({
        principale: l === principale,
        conTesto: haTesto(l, titoli, descrizioni),
        origine: toccata ? 'HUMAN' : (s?.origin ?? null),
        aggiornata: toccata || !s ? true : s.current && !principaleCambiato,
        // Solo le lingue dell'evento attive sul sito si traducono.
        motore: motore && lingueEvento.includes(l) && attive.includes(l),
        inTraduzioneDaMs: inTraduzione ? Math.max(0, ora - new Date(lavoro!.createdAt).getTime()) : null,
        fallita,
      });
      if (stati[l] === 'failed') fallimenti[l] = s?.failure ?? 'GENERIC';
    }
    return { stati, fallimenti };
  }, [schede, server, toccate, principaleCambiato, principale, titoli, descrizioni, motore, lingueEvento, attive, ora]);

  // Si rilegge solo mentre una lingua si sta traducendo, e solo lo staff (la
  // lettura e' dell'amministrazione); di rado se il motore non e' partito.
  const valori = Object.values(stati);
  const ogni = valori.includes('translating')
    ? OGNI_MS
    : valori.includes('waiting')
      ? IN_ATTESA_OGNI_MS
      : null;
  useEffect(() => {
    if (!ogni || !staff || !eventId) return undefined;
    const id = setInterval(() => void ricarica(), ogni);
    return () => clearInterval(id);
  }, [ogni, staff, eventId, ricarica]);

  const riprova = useCallback(
    async (lingua: string) => {
      if (!eventId || !staff) return;
      setInviando(lingua);
      setErrore(null);
      try {
        const r = await fetch(`/api/admin/events/${eventId}/text-translation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lingue: [lingua] }),
        });
        if (!r.ok) {
          const codice = await codiceErrore(r);
          setErrore(
            messaggioErroreApi(r.status, (k: ApiErrorKey) => tErr(k), t('retryError'), {}, codice)
          );
          return;
        }
        // Accodata, o gia' un'altra in corso, o niente da tradurre: lo si
        // dice com'e'.
        const { stato } = ((await r.json().catch(() => ({}))) ?? {}) as { stato?: string };
        if (stato === 'accodato') setAnnuncio(t('announceQueued', { languages: nomeLingua(lingua) }));
        else setErrore(stato === 'in-corso' ? t('retryBusy') : t('retryNothing'));
        await ricarica();
      } catch {
        setErrore(t('retryError'));
      } finally {
        setInviando(null);
      }
    },
    [eventId, staff, ricarica, t, tErr]
  );

  return { schede, stati, fallimenti, riprova, inviando, errore, annuncio, ricarica, scarta };
}

/** Il testo e l'aspetto di ogni scheda, per LocaleTabBar. */
export function useAspettoSchede(
  stati: Record<string, StatoScheda>
): Record<string, AspettoScheda> {
  const t = useTranslations('admin.textTranslation.state');
  return useMemo(
    () =>
      Object.fromEntries(
        Object.entries(stati).map(([l, s]) => [l, { ...ASPETTO[s], testo: t(s) }])
      ),
    [stati, t]
  );
}

/**
 * La riga «Lingue dell'evento»: le lingue, «Cambia lingue» che apre la
 * scelta, e una riga che dice che cosa succede alle lingue senza testo.
 * Togliere una lingua che ha un testo chiede conferma: al salvataggio il
 * testo se ne va.
 */
export function RigaLingue(props: {
  principale: string;
  /** Le lingue dell'evento, codici separati da virgola. */
  valore: string | null;
  /** Le lingue nuove; `tolte` sono quelle che perdono il testo. */
  onCambia: (valore: string | null, tolte: string[]) => void;
  attive: readonly string[];
  /** La post-produzione puo' tradurre sottotitoli e sintesi: si offrono anche le altre lingue. */
  altreLingue: boolean;
  conTesto: (lingua: string) => boolean;
  /** La traduzione automatica c'e' per questo evento. */
  motore: boolean;
  /** Il motore manca nell'installazione, e chi guarda la amministra. */
  avvisoAmministrazione: boolean;
  invalid?: boolean;
  /** Le traduzioni arrivate o chieste, per chi usa un lettore di schermo. */
  annuncio?: string;
}) {
  const t = useTranslations('admin.textTranslation');
  const interfaccia = useLocale();
  const base = useId();
  const idCaselle = `ev-lingue-${base.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [aperta, setAperta] = useState(false);
  const [conferma, setConferma] = useState<{ valore: string | null; lingua: string } | null>(null);
  const togliRef = useRef<HTMLButtonElement>(null);
  const cambiaRef = useRef<HTMLButtonElement>(null);
  const lingue = parseLocaleList(props.valore).filter((l) => l !== props.principale);
  const fuocoSu = (lingua: string) =>
    requestAnimationFrame(() => document.getElementById(`${idCaselle}-${lingua}`)?.focus());

  // Un errore sulle lingue apre la scelta, perche' si possa correggere.
  useEffect(() => {
    if (props.invalid) setAperta(true);
  }, [props.invalid]);
  useEffect(() => {
    if (conferma) togliRef.current?.focus();
  }, [conferma]);

  const elenco = [
    t('mainLanguage', { language: nomeLingua(props.principale) }),
    ...lingue.map((l) =>
      props.attive.includes(l) ? nomeLingua(l) : t('onlyCaptions', { language: nomeLingua(l) })
    ),
  ].join(' · ');

  const cambia = (valore: string | null) => {
    const dopo = parseLocaleList(valore);
    const tolta = lingue.find((l) => !dopo.includes(l) && props.conTesto(l));
    if (tolta) {
      setConferma({ valore, lingua: tolta });
      return;
    }
    props.onCambia(valore, []);
  };

  const aiuto = props.motore
    ? t('helpAuto')
    : t('helpManual', { source: nomeNellaFrase(props.principale, interfaccia) });

  return (
    <div id="aiTargetLocales" className="lingue-evento mb-3">
      <p className="lingue-evento__riga mb-1">
        <span className="fw-semibold me-2">{t('eventLanguages')}</span>
        <span className="me-2">{elenco}</span>
        <button
          ref={cambiaRef}
          id="ev-lingue-cambia"
          type="button"
          className="btn btn-link p-0 align-baseline lingue-evento__cambia"
          aria-expanded={aperta}
          aria-controls={`${idCaselle}-scelta`}
          aria-describedby="ev-lingue-aiuto"
          onClick={() => setAperta((v) => !v)}
        >
          {t('change')}
        </button>
      </p>
      <p id="ev-lingue-aiuto" className="lingue-evento__aiuto mb-2">
        {aiuto}
        {props.avvisoAmministrazione && (
          <>
            {' '}
            {t('engineOff')}{' '}
            <Link href={percorso('/admin/settings')}>{t('settings')}</Link>
          </>
        )}
      </p>
      <div id={`${idCaselle}-scelta`} hidden={!aperta} className="lingue-evento__scelta">
        {aperta && (
          <>
            <LanguageChecklist
              legend={t('eventLanguages')}
              description={t('chooseHelp')}
              value={props.valore}
              onChange={cambia}
              exclude={[props.principale]}
              available={props.attive.filter((l) => l !== props.principale)}
              othersLabel={t('othersGroup')}
              showOthers={props.altreLingue}
              idBase={idCaselle}
              invalid={props.invalid}
              errorText={t('languagesRequired')}
            />
            {conferma && (
              <div
                className="lingue-evento__conferma"
                role="group"
                aria-labelledby={`${idCaselle}-domanda`}
              >
                <p id={`${idCaselle}-domanda`} className="mb-2">
                  {t('removeQuestion', { language: nomeLingua(conferma.lingua) })}
                </p>
                <div className="d-flex flex-wrap gap-2">
                  <button
                    ref={togliRef}
                    type="button"
                    className="btn btn-danger lingue-evento__azione"
                    onClick={() => {
                      const { valore, lingua } = conferma;
                      setConferma(null);
                      props.onCambia(valore, [lingua]);
                      fuocoSu(lingua);
                    }}
                  >
                    {t('removeConfirm')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-secondary lingue-evento__azione"
                    onClick={() => {
                      const { lingua } = conferma;
                      setConferma(null);
                      fuocoSu(lingua);
                    }}
                  >
                    {t('cancel')}
                  </button>
                </div>
              </div>
            )}
            <button
              type="button"
              className="btn btn-outline-primary btn-sm mt-2 lingue-evento__azione"
              onClick={() => {
                setAperta(false);
                setConferma(null);
                cambiaRef.current?.focus();
              }}
            >
              {t('done')}
            </button>
          </>
        )}
      </div>
      {props.invalid && !aperta && (
        <div className="invalid-feedback d-block">{t('languagesRequired')}</div>
      )}
      <p className="visually-hidden" role="status" aria-live="polite">
        {props.annuncio}
      </p>
    </div>
  );
}

/**
 * Dentro la scheda di una lingua: che cosa vuol dire il suo stato, e le
 * azioni che lo cambiano. «Ritraduci» chiede conferma: toglie il testo di una
 * persona, e al salvataggio arriva la traduzione automatica.
 */
export function PannelloLingua(props: {
  lingua: string;
  stato: StatoScheda;
  principale: string;
  /** La traduzione automatica c'e' per questa lingua. */
  motore: boolean;
  /** «Ritraduci» e «Riprova» sono dello staff. */
  staff: boolean;
  fallimento?: 'MT_UNAVAILABLE' | 'GENERIC';
  inviando: boolean;
  errore: string | null;
  onRiletta: () => void;
  onRitraduci: () => void;
  onRiprova: () => void;
}) {
  const t = useTranslations('admin.textTranslation');
  const tErr = useTranslations('apiErrors');
  const interfaccia = useLocale();
  const [chiede, setChiede] = useState(false);
  const confermaRef = useRef<HTMLButtonElement>(null);
  const ritraduciRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (chiede) confermaRef.current?.focus();
  }, [chiede]);
  // Un'altra lingua, o un altro stato: la domanda non vale piu'.
  useEffect(() => setChiede(false), [props.lingua, props.stato]);

  const source = nomeNellaFrase(props.principale, interfaccia);
  const language = nomeLingua(props.lingua);
  const { stato } = props;
  if (stato === 'principale' || stato === 'human') return null;

  const tono: Record<string, string> = {
    onSave: 'info',
    translating: 'info',
    waiting: 'warning',
    machine: 'warning',
    stale: 'danger',
    failed: 'danger',
    empty: 'info',
  };
  const testo =
    stato === 'failed'
      ? props.fallimento === 'MT_UNAVAILABLE'
        ? t('panel.failed', { reason: tErr('mtUnavailable') })
        : t('panel.failedGeneric')
      : t(`panel.${stato}`, { source, language });

  return (
    <div className={`alert alert-${tono[stato]} lingue-pannello mb-3`}>
      <p className="mb-0">{testo}</p>
      {(stato === 'machine' || stato === 'stale' || (stato === 'failed' && props.staff)) && (
        <div className="d-flex flex-wrap gap-2 mt-2">
          {stato === 'machine' && (
            <button type="button" className="btn btn-outline-primary lingue-pannello__azione" onClick={props.onRiletta}>
              {t('markReviewed')}
            </button>
          )}
          {stato === 'stale' && props.motore && props.staff && !chiede && (
            <button
              ref={ritraduciRef}
              type="button"
              className="btn btn-outline-primary lingue-pannello__azione"
              onClick={() => setChiede(true)}
            >
              {t('retranslate')}
            </button>
          )}
          {stato === 'stale' && !chiede && (
            <button type="button" className="btn btn-outline-primary lingue-pannello__azione" onClick={props.onRiletta}>
              {t('stillCorrect')}
            </button>
          )}
          {stato === 'failed' && props.staff && (
            <button
              type="button"
              className="btn btn-outline-primary lingue-pannello__azione"
              disabled={props.inviando}
              onClick={props.onRiprova}
            >
              {t('retry')}
            </button>
          )}
        </div>
      )}
      {chiede && (
        <div className="lingue-pannello__conferma mt-2" role="group" aria-labelledby="ev-ritraduci-domanda">
          <p id="ev-ritraduci-domanda" className="mb-2">
            {t('retranslateQuestion', { language })}
          </p>
          <div className="d-flex flex-wrap gap-2">
            <button
              ref={confermaRef}
              type="button"
              className="btn btn-primary lingue-pannello__azione"
              onClick={() => {
                setChiede(false);
                props.onRitraduci();
              }}
            >
              {t('retranslateConfirm')}
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary lingue-pannello__azione"
              onClick={() => {
                setChiede(false);
                requestAnimationFrame(() => ritraduciRef.current?.focus());
              }}
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      )}
      {props.errore && stato === 'failed' && (
        <p className="mb-0 mt-2 d-flex align-items-start gap-1">
          <Icon icon="it-error" size="sm" />
          <span>{props.errore}</span>
        </p>
      )}
    </div>
  );
}


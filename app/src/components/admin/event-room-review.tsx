'use client';

/**
 * «Cosa è successo in sala»: la revisione, a evento concluso, di chat,
 * domande, sondaggi e «In una parola», dalla scheda «Dopo l'evento».
 *
 * Le modifiche passano dalle rotte della sala, con il token di chi modera (la
 * pagina di gestione lo ha sempre): nascondere un messaggio o una parola,
 * chiudere una domanda, pubblicare i risultati di un sondaggio. Le domande
 * segnate in chat e le parole di tutti i giri si leggono da una rotta
 * dell'area (room-review): la sala ne vede solo una parte. Il riepilogo della
 * pagina pubblica, congelato alla prima visita, si rifa' a ogni modifica; in
 * fondo «Aggiorna il riepilogo pubblico» lo rifa' comunque a richiesta.
 */
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useFormatter, useTranslations } from 'next-intl';

import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { codiceErrore, messaggioErroreApi } from '@/lib/api-error-message';

type Scheda = 'chat' | 'qa' | 'polls' | 'words';
const SCHEDE: Scheda[] = ['chat', 'qa', 'polls', 'words'];

/** Quanti messaggi si rileggono: il massimo che la rotta della chat concede. */
const MESSAGGI_MAX = 500;

/**
 * Le liste non si rileggono a ogni ritorno sulla pagina (sono dati di un
 * evento finito), ma si', riaprendo una scheda: una modifica fatta da
 * un'altra scheda puo' averle cambiate.
 */
const SWR_OPZIONI = { revalidateOnFocus: false } as const;

interface Messaggio {
  id: string;
  senderName: string;
  isModerator: boolean;
  text: string;
  createdAt: string;
  isQuestion: boolean;
}
interface DomandaQa {
  id: string;
  authorName: string;
  text: string;
  status: string;
  upvoteCount: number;
}
interface DomandaChat {
  id: string;
  senderName: string;
  text: string;
  answeredAt: string | null;
  dismissedAt: string | null;
}
interface Revisione {
  domandeChat: DomandaChat[];
  /** Le domande in chat sono piu' di quelle restituite (le piu' recenti). */
  domandeTroncate?: boolean;
  giri: {
    id: string;
    prompt: string;
    createdAt: string;
    words: { word: string; count: number }[];
  }[];
}
interface Sondaggio {
  id: string;
  question: string;
  options: string[];
  status: 'OPEN' | 'CLOSED' | 'PUBLISHED';
  totalVotes: number;
  optionCounts: number[] | null;
}

type Leggi = <T>(url: string) => Promise<T>;
type Modifica = (
  url: string,
  init: RequestInit,
  rileggi: string,
  ok: string
) => Promise<void>;
interface Azioni {
  modifica: Modifica;
  occupato: boolean;
  conferma: (titolo: string, testo: string, etichetta: string) => Promise<boolean>;
}

export default function EventRoomReview({
  eventId,
  slug,
  token,
  concluso,
}: {
  eventId: string;
  slug: string;
  /** Il token di chi modera: le rotte della sala lo chiedono. */
  token: string;
  /** L'evento e' concluso (non archiviato): solo allora il riepilogo si rifa'. */
  concluso: boolean;
}) {
  const t = useTranslations('admin.roomReview');
  const tApi = useTranslations('apiErrors');
  const toast = useToast();
  const confirm = useConfirm();
  const { mutate } = useSWRConfig();
  const [scheda, setScheda] = useState<Scheda>('chat');
  const [occupato, setOccupato] = useState(false);
  const idBase = useId();
  const schedeRef = useRef<Array<HTMLButtonElement | null>>([]);
  const pannelloRef = useRef<HTMLDivElement>(null);

  const auth = { Authorization: `Bearer ${token}` };
  const base = `/api/events/${encodeURIComponent(slug)}`;
  const urlRevisione = `/api/admin/events/${eventId}/room-review`;
  const urlChiusura = `/api/admin/events/${eventId}/closing`;
  const leggi: Leggi = async (url) => {
    const res = await fetch(url, { headers: auth });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  };

  /**
   * Una modifica, una alla volta. Se riesce si rileggono la lista toccata,
   * domande e parole, e lo stato della chiusura di QUESTO evento; si annuncia
   * l'esito e il fuoco torna al pannello: la riga col pulsante premuto
   * spesso non c'e' piu'.
   */
  const modifica: Modifica = async (url, init, rileggi, ok) => {
    setOccupato(true);
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          ...auth,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
      });
      if (!res.ok) {
        toast.error(
          messaggioErroreApi(
            res.status,
            tApi,
            t('actionError'),
            {},
            await codiceErrore(res)
          )
        );
        return;
      }
      toast.success(ok);
      await Promise.all([
        mutate([rileggi, token]),
        mutate([urlRevisione, token]),
        mutate((key) => Array.isArray(key) && key[0] === urlChiusura),
      ]);
    } catch {
      toast.error(t('actionError'));
    } finally {
      setOccupato(false);
      // Il pulsante premuto si spegne durante la richiesta e dopo spesso non
      // c'e' piu': il fuoco torna al pannello, riuscita o no.
      pannelloRef.current?.focus();
    }
  };
  const conferma = (titolo: string, testo: string, etichetta: string) =>
    confirm({ title: titolo, message: testo, confirmLabel: etichetta, danger: true });
  const azioni: Azioni = { modifica, occupato, conferma };

  // Il pulsante non si disattiva (il fuoco di chi usa la tastiera restera'
  // li'): una seconda pressione durante la richiesta si ignora.
  async function aggiornaRiepilogo() {
    if (occupato) return;
    setOccupato(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/recap`, {
        method: 'POST',
        headers: auth,
      });
      if (res.ok) {
        toast.success(t('recap.done'));
      } else {
        toast.error(
          messaggioErroreApi(
            res.status,
            tApi,
            t('recap.error'),
            { 409: t('recap.notPossible') },
            await codiceErrore(res)
          )
        );
      }
    } catch {
      toast.error(t('recap.error'));
    } finally {
      setOccupato(false);
    }
  }

  // Schede come quelle di sistema: frecce, Home e Fine spostano il fuoco e
  // aprono la scheda (sono quattro e leggere, non serve aspettare Invio).
  function tasti(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const dove =
      e.key === 'ArrowRight'
        ? (i + 1) % SCHEDE.length
        : e.key === 'ArrowLeft'
          ? (i - 1 + SCHEDE.length) % SCHEDE.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? SCHEDE.length - 1
              : null;
    if (dove === null) return;
    e.preventDefault();
    setScheda(SCHEDE[dove]!);
    schedeRef.current[dove]?.focus();
  }

  const urlChat = `${base}/chat?limit=${MESSAGGI_MAX}`;

  return (
    <div className="sala-rivista">
      <p className="sala-rivista__intro">{t('intro')}</p>
      <ul
        className="nav nav-tabs sala-rivista__schede"
        role="tablist"
        aria-label={t('title')}
      >
        {SCHEDE.map((s, i) => (
          <li key={s} className="nav-item" role="presentation">
            <button
              ref={(el) => {
                schedeRef.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${idBase}-tab-${s}`}
              aria-selected={scheda === s}
              // Il pannello c'e' solo per la scheda aperta.
              aria-controls={scheda === s ? `${idBase}-panel` : undefined}
              tabIndex={scheda === s ? 0 : -1}
              className={`nav-link${scheda === s ? ' active' : ''}`}
              onClick={() => setScheda(s)}
              onKeyDown={(e) => tasti(e, i)}
            >
              {t(`tabs.${s}`)}
            </button>
          </li>
        ))}
      </ul>
      <div
        ref={pannelloRef}
        role="tabpanel"
        id={`${idBase}-panel`}
        aria-labelledby={`${idBase}-tab-${scheda}`}
        tabIndex={-1}
        className="sala-rivista__pannello"
      >
        {scheda === 'chat' && (
          <Chat url={urlChat} token={token} leggi={leggi} base={base} azioni={azioni} />
        )}
        {scheda === 'qa' && (
          <Domande
            urlQa={`${base}/questions`}
            urlRevisione={urlRevisione}
            token={token}
            leggi={leggi}
            base={base}
            azioni={azioni}
          />
        )}
        {scheda === 'polls' && (
          <Sondaggi
            url={`${base}/polls`}
            token={token}
            leggi={leggi}
            base={base}
            azioni={azioni}
          />
        )}
        {scheda === 'words' && (
          <Parole
            url={urlRevisione}
            token={token}
            leggi={leggi}
            base={base}
            azioni={azioni}
          />
        )}
      </div>
      {concluso && (
        <div className="sala-rivista__piede">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={aggiornaRiepilogo}
            aria-disabled={occupato}
          >
            {t('recap.button')}
          </button>
        </div>
      )}
    </div>
  );
}

function Stato({
  errore,
  vuoto,
  testoVuoto,
}: {
  errore: unknown;
  vuoto: boolean;
  testoVuoto: string;
}) {
  const t = useTranslations('admin.roomReview');
  if (errore) {
    return (
      <p className="sala-rivista__nota" role="alert">
        {t('error')}
      </p>
    );
  }
  if (vuoto) return <p className="sala-rivista__nota">{testoVuoto}</p>;
  return null;
}

function Attesa() {
  const t = useTranslations('admin.roomReview');
  return (
    <p className="sala-rivista__nota" aria-busy="true">
      {t('loading')}
    </p>
  );
}

function Chat({
  url,
  token,
  leggi,
  base,
  azioni,
}: {
  url: string;
  token: string;
  leggi: Leggi;
  base: string;
  azioni: Azioni;
}) {
  const t = useTranslations('admin.roomReview');
  const format = useFormatter();
  const { data, error } = useSWR<{ messages: Messaggio[] }>(
    [url, token],
    ([u]: [string]) => leggi(u),
    SWR_OPZIONI
  );
  if (!data && !error) return <Attesa />;
  const messaggi = data?.messages ?? [];
  return (
    <>
      <Stato
        errore={!data && error}
        vuoto={!!data && messaggi.length === 0}
        testoVuoto={t('chat.empty')}
      />
      {messaggi.length >= MESSAGGI_MAX && (
        <p className="sala-rivista__nota">{t('chat.limit', { count: MESSAGGI_MAX })}</p>
      )}
      {messaggi.length > 0 && (
        <ul className="sala-rivista__lista" tabIndex={0} aria-label={t('tabs.chat')}>
          {messaggi.map((m) => (
            <li key={m.id} className="sala-rivista__voce">
              <div className="sala-rivista__testa">
                <strong>{m.senderName}</strong>
                {m.isModerator && (
                  <span className="sala-rivista__etichetta">{t('chat.moderator')}</span>
                )}
                {m.isQuestion && (
                  <span className="sala-rivista__etichetta">{t('chat.question')}</span>
                )}
                <time dateTime={m.createdAt}>
                  {format.dateTime(new Date(m.createdAt), { timeStyle: 'short' })}
                </time>
              </div>
              <p className="sala-rivista__testo">{m.text}</p>
              <button
                type="button"
                className="btn btn-outline-danger btn-xs"
                aria-label={t('chat.hideFor', { name: m.senderName })}
                disabled={azioni.occupato}
                onClick={async () => {
                  // Nascondere non si annulla e cancella l'allegato: si chiede.
                  if (
                    !(await azioni.conferma(
                      t('chat.confirmTitle'),
                      t('chat.confirmBody'),
                      t('chat.hide')
                    ))
                  )
                    return;
                  await azioni.modifica(
                    `${base}/chat/${m.id}`,
                    { method: 'DELETE' },
                    url,
                    t('chat.hidden')
                  );
                }}
              >
                {t('chat.hide')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Domande({
  urlQa,
  urlRevisione,
  token,
  leggi,
  base,
  azioni,
}: {
  urlQa: string;
  urlRevisione: string;
  token: string;
  leggi: Leggi;
  base: string;
  azioni: Azioni;
}) {
  const t = useTranslations('admin.roomReview');
  const revisione = useSWR<Revisione>(
    [urlRevisione, token],
    ([u]: [string]) => leggi(u),
    SWR_OPZIONI
  );
  const qa = useSWR<{ questions: DomandaQa[] }>(
    [urlQa, token],
    ([u]: [string]) => leggi(u),
    SWR_OPZIONI
  );
  if ((!revisione.data && !revisione.error) || (!qa.data && !qa.error)) return <Attesa />;
  // Le domande del pannello Q&A e tutte quelle segnate in chat, in un elenco
  // solo: prima quelle ancora aperte.
  const righe = [
    ...(qa.data?.questions ?? []).map((q) => ({
      id: q.id,
      chi: q.authorName,
      testo: q.text,
      stato: q.status,
      voti: q.upvoteCount as number | null,
      daChat: false,
    })),
    ...(revisione.data?.domandeChat ?? []).map((m) => ({
      id: m.id,
      chi: m.senderName,
      testo: m.text,
      stato: m.answeredAt ? 'ANSWERED' : m.dismissedAt ? 'DISMISSED' : 'PENDING',
      voti: null as number | null,
      daChat: true,
    })),
  ];
  const aperta = (s: string) => s === 'PENDING' || s === 'HIGHLIGHTED';
  righe.sort((a, b) => Number(aperta(b.stato)) - Number(aperta(a.stato)));
  const imposta = (r: (typeof righe)[number], status: 'ANSWERED' | 'DISMISSED') => {
    const ok = status === 'ANSWERED' ? t('qa.answeredOk') : t('qa.dismissedOk');
    const corpo = { method: 'PATCH', body: JSON.stringify({ status }) };
    return r.daChat
      ? azioni.modifica(`${base}/chat/${r.id}/question`, corpo, urlRevisione, ok)
      : azioni.modifica(`${base}/questions/${r.id}`, corpo, urlQa, ok);
  };
  const errore = (!qa.data && qa.error) || (!revisione.data && revisione.error);
  return (
    <>
      <Stato
        errore={errore}
        vuoto={!errore && righe.length === 0}
        testoVuoto={t('qa.empty')}
      />
      {revisione.data?.domandeTroncate && (
        <p className="sala-rivista__nota">
          {t('qa.limit', { count: revisione.data.domandeChat.length })}
        </p>
      )}
      {righe.length > 0 && (
        <ul className="sala-rivista__lista" tabIndex={0} aria-label={t('tabs.qa')}>
          {righe.map((r) => (
            <li key={`${r.daChat ? 'c' : 'q'}-${r.id}`} className="sala-rivista__voce">
              <div className="sala-rivista__testa">
                <strong>{r.chi}</strong>
                <span
                  className={`sala-rivista__etichetta${aperta(r.stato) ? ' sala-rivista__etichetta--aperta' : ''}`}
                >
                  {t(
                    `qa.status.${r.stato as 'PENDING' | 'HIGHLIGHTED' | 'ANSWERED' | 'DISMISSED'}`
                  )}
                </span>
                {r.daChat && (
                  <span className="sala-rivista__nota-breve">{t('qa.fromChat')}</span>
                )}
                {r.voti != null && r.voti > 0 && (
                  <span className="sala-rivista__nota-breve">
                    {t('qa.votes', { count: r.voti })}
                  </span>
                )}
              </div>
              <p className="sala-rivista__testo">{r.testo}</p>
              {aperta(r.stato) && (
                <div className="d-flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-outline-primary btn-xs"
                    disabled={azioni.occupato}
                    onClick={() => void imposta(r, 'ANSWERED')}
                  >
                    {t('qa.markAnswered')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-xs"
                    disabled={azioni.occupato}
                    onClick={() => void imposta(r, 'DISMISSED')}
                  >
                    {t('qa.dismiss')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Sondaggi({
  url,
  token,
  leggi,
  base,
  azioni,
}: {
  url: string;
  token: string;
  leggi: Leggi;
  base: string;
  azioni: Azioni;
}) {
  const t = useTranslations('admin.roomReview');
  const { data, error } = useSWR<{ polls: Sondaggio[] }>(
    [url, token],
    ([u]: [string]) => leggi(u),
    SWR_OPZIONI
  );
  if (!data && !error) return <Attesa />;
  const sondaggi = data?.polls ?? [];
  return (
    <>
      <Stato
        errore={!data && error}
        vuoto={!!data && sondaggi.length === 0}
        testoVuoto={t('polls.empty')}
      />
      {sondaggi.length > 0 && (
        <ul className="sala-rivista__lista sala-rivista__lista--larga">
          {sondaggi.map((p) => (
            <li key={p.id} className="sala-rivista__voce">
              <div className="sala-rivista__testa">
                <strong>{p.question}</strong>
                <span
                  className={`sala-rivista__etichetta${p.status === 'CLOSED' ? ' sala-rivista__etichetta--aperta' : ''}`}
                >
                  {t(`polls.status.${p.status}`)}
                </span>
                <span className="sala-rivista__nota-breve">
                  {t('polls.votes', { count: p.totalVotes })}
                </span>
              </div>
              {p.optionCounts && (
                <ul className="sala-rivista__opzioni">
                  {p.options.map((o, i) => {
                    const n = p.optionCounts![i] ?? 0;
                    const quota =
                      p.totalVotes > 0 ? Math.round((n / p.totalVotes) * 100) : 0;
                    return (
                      <li key={i}>
                        <span>{o}</span>
                        <span className="sala-rivista__barra" aria-hidden="true">
                          <span style={{ width: `${quota}%` }} />
                        </span>
                        <span className="sala-rivista__numero">{n}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {p.status === 'CLOSED' && (
                <button
                  type="button"
                  className="btn btn-outline-primary btn-xs"
                  disabled={azioni.occupato}
                  onClick={() =>
                    void azioni.modifica(
                      `${base}/polls/${p.id}`,
                      { method: 'PATCH', body: JSON.stringify({ status: 'PUBLISHED' }) },
                      url,
                      t('polls.published')
                    )
                  }
                >
                  {t('polls.publish')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Parole({
  url,
  token,
  leggi,
  base,
  azioni,
}: {
  url: string;
  token: string;
  leggi: Leggi;
  base: string;
  azioni: Azioni;
}) {
  const t = useTranslations('admin.roomReview');
  const format = useFormatter();
  const { data, error } = useSWR<Revisione>(
    [url, token],
    ([u]: [string]) => leggi(u),
    SWR_OPZIONI
  );
  if (!data && !error) return <Attesa />;
  // Tutti i giri: il riepilogo pubblico conta le parole di ognuno.
  const giri = (data?.giri ?? []).filter((g) => g.words.length > 0);
  return (
    <>
      <Stato
        errore={!data && error}
        vuoto={!!data && giri.length === 0}
        testoVuoto={t('words.empty')}
      />
      {giri.map((g) => (
        <section
          key={g.id}
          className="sala-rivista__giro"
          aria-label={t('words.round', {
            date: format.dateTime(new Date(g.createdAt), {
              dateStyle: 'short',
              timeStyle: 'short',
            }),
          })}
        >
          <p className="sala-rivista__nota">{t('words.prompt', { prompt: g.prompt })}</p>
          <ul className="sala-rivista__parole">
            {g.words.map((w) => (
              <li key={w.word}>
                <span className="sala-rivista__parola">{w.word}</span>
                <span className="sala-rivista__nota-breve">
                  {t('words.people', { count: w.count })}
                </span>
                <button
                  type="button"
                  className="btn btn-outline-danger btn-xs"
                  aria-label={t('words.hideFor', { word: w.word })}
                  disabled={azioni.occupato}
                  onClick={async () => {
                    if (
                      !(await azioni.conferma(
                        t('words.confirmTitle'),
                        t('words.confirmBody'),
                        t('words.hide')
                      ))
                    )
                      return;
                    await azioni.modifica(
                      `${base}/wordcloud/${g.id}/words?word=${encodeURIComponent(w.word)}`,
                      { method: 'DELETE' },
                      url,
                      t('words.hidden')
                    );
                  }}
                >
                  {t('words.hide')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

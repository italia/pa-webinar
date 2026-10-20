'use client';

/**
 * Il passo «Programma» del wizard, facoltativo: gli argomenti dell'incontro in
 * ordine, chi interviene (fra le persone dell'evento) e quanto dura ciascuno.
 * Con l'agenda accesa il programma compare nella pagina pubblica, sotto la
 * descrizione, e in sala mostra a tutti l'argomento in corso.
 *
 * Si parte anche dalle persone: ognuna ha il suo pulsante «+ Intervento», che
 * aggiunge una riga con lei, e chi manca si aggiunge da qui con un modulo
 * breve (le stesse regole del passo «Persone», people-draft) senza tornare
 * indietro. Un argomento aggiunto ad agenda spenta la accende: chi prepara un
 * programma vuole pubblicarlo. Spenta, gli argomenti gia' scritti si leggono
 * soltanto: il salvataggio non li manda (in modifica resta il programma
 * salvato), e una modifica fatta qui andrebbe persa senza che niente lo dica.
 *
 * Gli orari si calcolano dall'inizio dell'evento, nel suo fuso, sommando le
 * durate: si fermano al primo argomento senza durata. Contano solo le righe
 * con un titolo, come nel salvataggio e nella pagina pubblica. Un programma
 * che va oltre la fine dell'evento lo dice, senza impedire di salvare.
 *
 * Quando l'agenda e' gia' stata usata in sala (un argomento non piu' da
 * discutere) il programma si legge soltanto: da li' l'agenda si guida dalla
 * sala. Le scelte di chi e' stato tolto nel passo «Persone» le toglie il
 * wizard (senzaRelatoriAssenti), anche senza aprire questo passo: qui lo si
 * dice.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { PersonAvatar } from '@/components/admin/person-photo-field';
import { Icon } from '@/components/ui/icon';
import { useDurataTesto } from '@/hooks/use-durata-testo';
import { splitAgendaLines, MAX_AGENDA_ITEMS } from '@/lib/agenda/status';
import type { PersonRole } from '@/lib/events/grant-profile';

import {
  BOZZA_VUOTA,
  controllaBozza,
  conRuolo,
  indirizziPresi,
  type Bozza,
  type ErrorePersona,
} from './people-draft';
import {
  CHIAVE_PRINCIPALE,
  chiavePersona,
  conIntervento,
  haTitolo,
  istanteDalModulo,
  nuovaVoce,
  opzioniConPrincipale,
  oraNelFuso,
  orariDelModulo,
  relatoriSenzaIntervento,
  rigaIntatta,
  type AgendaDraft,
  type OpzioneRelatore,
} from './programme-plan';
import type { ModeratorEntry, SpeakerEntry } from './step-2-people';

/** Cio' che il passo cambia nel modulo. */
export interface ProgrammaPatch {
  agenda?: AgendaDraft[];
  agendaEnabled?: boolean;
  /** Una persona aggiunta da qui, o mostrata nella pagina pubblica. */
  moderators?: ModeratorEntry[];
  speakers?: SpeakerEntry[];
  moderatorPublicListed?: boolean;
}

interface Props {
  value: {
    agenda: AgendaDraft[];
    agendaEnabled: boolean;
    startsAt: string;
    endsAt: string;
    timezone: string;
    moderatorName: string;
    moderatorEmail: string;
    moderatorPublicListed: boolean;
    moderatorPhotoId?: string | null;
    moderators: ModeratorEntry[];
    speakers: SpeakerEntry[];
  };
  onChange: (patch: ProgrammaPatch) => void;
  /** L'agenda e' gia' stata usata in sala: il programma si legge soltanto. */
  locked?: boolean;
  fieldErrors?: Record<string, string>;
  /** Quanti argomenti hanno perso chi interviene (persona tolta nel passo
   *  «Persone») dall'ultima volta che il passo si e' visto. */
  tolte?: number;
  /** Porta al passo «Persone». */
  onVaiPersone?: () => void;
  /** Si sta creando l'evento: ad agenda spenta il programma non si salva
   *  (in modifica resta quello dell'ultimo salvataggio). */
  creazione?: boolean;
}

export default function StepProgramma({
  value,
  onChange,
  locked = false,
  fieldErrors = {},
  tolte = 0,
  onVaiPersone,
  creazione = false,
}: Props) {
  const t = useTranslations('admin.wizard.step3');
  const tp = useTranslations('admin.wizard.programme');
  // Le stesse frasi dell'agenda della sala: e' lo stesso elenco.
  const ta = useTranslations('agenda');
  const locale = useLocale();
  const durata = useDurataTesto();
  const id = useId();
  const agenda = useMemo(() => value.agenda ?? [], [value.agenda]);
  // Pieno: un argomento in piu' supererebbe il massimo. La riga intatta in
  // fondo non conta, perche' un intervento la usa invece di aggiungerne una.
  const pieno = agenda.length - (rigaIntatta(agenda.at(-1)) ? 1 : 0) >= MAX_AGENDA_ITEMS;
  // Le righe si cambiano solo ad agenda accesa e mai usata in sala.
  const soloLettura = locked || !value.agendaEnabled;

  // Le persone fra cui scegliere, organizzatore principale sempre compreso
  // (le stesse con cui il wizard toglie le scelte rimaste senza persona).
  const opzioni = useMemo(
    () =>
      opzioniConPrincipale({
        moderatorName: value.moderatorName,
        moderatorPublicListed: value.moderatorPublicListed,
        moderators: value.moderators,
        speakers: value.speakers,
      }),
    [value.moderatorName, value.moderatorPublicListed, value.moderators, value.speakers]
  );

  // Il fuoco va a un campo di una riga appena aggiunta (o al suo «Chi
  // interviene»), quando la riga c'e': gli id delle righe sono fissi.
  const [fuoco, setFuoco] = useState<{ riga: number; campo: 'titolo' | 'chi' } | null>(null);
  useEffect(() => {
    if (!fuoco) return;
    document.getElementById(`wiz-programma-${fuoco.riga}-${fuoco.campo}`)?.focus();
    setFuoco(null);
  }, [fuoco, agenda]);

  // Cio' che succede senza che il fuoco lo mostri: lo si dice una volta.
  const [annuncio, setAnnuncio] = useState('');
  const annuncia = (testo: string) =>
    // Lo stesso testo due volte di fila non si ripeterebbe: uno spazio lo
    // rende diverso.
    setAnnuncio((prima) => (prima === testo ? `${testo} ` : testo));

  const [nuovaAperta, setNuovaAperta] = useState(false);
  const nuovaRef = useRef<HTMLButtonElement>(null);

  const tz = value.timezone;
  const inizio = istanteDalModulo(value.startsAt, tz);
  const fine = istanteDalModulo(value.endsAt, tz);
  // Solo le righe con un titolo: una riga vuota non si salva, non ha orario
  // e non sposta quelli dopo.
  const { inizi, totale, fine: fineProgramma } = orariDelModulo(agenda, inizio);
  const ora = (d: Date | null | undefined) => (d ? oraNelFuso(d, tz) : null);
  const compilate = agenda.filter(haTitolo).length;
  const oltre =
    fineProgramma && fine
      ? Math.round((fineProgramma.getTime() - fine.getTime()) / 60_000)
      : 0;

  const etichettaRuolo = (r: PersonRole) =>
    r === 'organizer'
      ? t('roleOrganizer')
      : r === 'moderator'
        ? t('roleModerator')
        : t('roleSpeaker');
  const nomeDi = (o: OpzioneRelatore) =>
    o.key === CHIAVE_PRINCIPALE && !o.name.trim() ? t('programLeadOrganizer') : o.name;
  const nomeOpzione = (o: OpzioneRelatore) =>
    o.key === CHIAVE_PRINCIPALE && !o.name.trim()
      ? nomeDi(o)
      : t('programPerson', { name: o.name, role: etichettaRuolo(o.role) });
  const fotoDi = (chiave: string): string | null => {
    if (chiave === CHIAVE_PRINCIPALE) return value.moderatorPhotoId ?? null;
    const p = [...value.moderators, ...value.speakers].find((x) => chiavePersona(x) === chiave);
    return p?.photoId ?? null;
  };

  /**
   * Il programma nuovo, e l'agenda accesa se era spenta: un argomento
   * preparato da qui e' un programma da pubblicare. Lo si dice.
   */
  const conAccensione = (nuova: AgendaDraft[]): { patch: ProgrammaPatch; accesa: boolean } => {
    const accesa = !value.agendaEnabled && nuova.length > 0;
    return { patch: accesa ? { agenda: nuova, agendaEnabled: true } : { agenda: nuova }, accesa };
  };

  /** Il momento in cui comincia una riga aggiunta in fondo, se si sa. */
  const oraInFondo = (): string | null => {
    if (compilate === 0) return ora(inizio);
    return totale !== null ? ora(fineProgramma) : null;
  };

  const aggiungiIntervento = (o: OpzioneRelatore) => {
    if (pieno) return;
    const { agenda: nuova, indice } = conIntervento(agenda, o.key);
    const { patch, accesa } = conAccensione(nuova);
    onChange(patch);
    setFuoco({ riga: indice, campo: 'titolo' });
    const quando = oraInFondo();
    const detto = quando
      ? tp('talkAdded', { name: nomeDi(o), time: quando })
      : tp('talkAddedNoTime', { name: nomeDi(o) });
    annuncia(accesa ? `${tp('turnedOn')} ${detto}` : detto);
  };

  const aggiungiPersona = (persona: SpeakerEntry, role: PersonRole) => {
    if (pieno) return;
    const persone = conRuolo(value.moderators, value.speakers, persona, role);
    const { agenda: nuova, indice } = conIntervento(agenda, `e:${persona.email}`);
    const { patch, accesa } = conAccensione(nuova);
    onChange({ ...persone, ...patch });
    setNuovaAperta(false);
    setFuoco({ riga: indice, campo: 'titolo' });
    const detto = tp('newPersonDone', { name: persona.name, n: indice + 1 });
    annuncia(accesa ? `${tp('turnedOn')} ${detto}` : detto);
  };

  /** Chi interviene si mostra nella pagina pubblica: la stessa scelta della
   *  casella del passo «Persone», fatta da qui per una persona. */
  const mostraNome = (o: OpzioneRelatore, riga: number) => {
    if (o.key === CHIAVE_PRINCIPALE) {
      onChange({ moderatorPublicListed: true });
    } else if (value.moderators.some((m) => chiavePersona(m) === o.key)) {
      onChange({
        moderators: value.moderators.map((m) =>
          chiavePersona(m) === o.key ? { ...m, publicListed: true } : m
        ),
      });
    } else {
      onChange({
        speakers: value.speakers.map((s) =>
          chiavePersona(s) === o.key ? { ...s, publicListed: true } : s
        ),
      });
    }
    // Il pulsante sparisce: il fuoco resta sulla riga.
    setFuoco({ riga, campo: 'chi' });
    annuncia(tp('madePublic', { name: nomeDi(o) }));
  };

  const accendi = () => {
    if (agenda.length === 0) {
      onChange({ agendaEnabled: true, agenda: [nuovaVoce()] });
      setFuoco({ riga: 0, campo: 'titolo' });
    } else {
      onChange({ agendaEnabled: true });
    }
    annuncia(tp('turnedOn'));
  };

  const aggiorna = (i: number, patch: Partial<AgendaDraft>) =>
    onChange({ agenda: agenda.map((v, j) => (j === i ? { ...v, ...patch } : v)) });
  const sposta = (i: number, verso: -1 | 1) => {
    const j = i + verso;
    if (j < 0 || j >= agenda.length) return;
    const nuova = [...agenda];
    [nuova[i], nuova[j]] = [nuova[j]!, nuova[i]!];
    onChange({ agenda: nuova });
  };

  const senzaPersone = value.moderators.length + value.speakers.length === 0;
  const senzaIntervento = relatoriSenzaIntervento(value);
  const elenco = (nomi: string[]) => {
    try {
      return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(nomi);
    } catch {
      return nomi.join(', ');
    }
  };
  const presi = indirizziPresi(
    value.moderators,
    value.speakers,
    value.moderatorEmail.trim() ? [value.moderatorEmail] : []
  );
  const oraInizio = ora(inizio);

  return (
    <div className="wizard-programma-passo">
      <h2 className="h4 fw-bold mb-3" style={{ color: 'var(--app-text)' }}>
        {tp('heading')}
      </h2>
      <p className="text-secondary mb-3" style={{ fontSize: '0.9rem' }}>
        {oraInizio ? tp('intro', { start: oraInizio }) : tp('introNoStart')}
      </p>

      {locked && (
        <p className="wizard-programma__nota" role="note">
          <Icon icon="it-info-circle" size="sm" />
          <span>{t('programFrozen')}</span>
        </p>
      )}
      {tolte > 0 && (
        <p className="wizard-programma__nota" role="status">
          <Icon icon="it-info-circle" size="sm" />
          <span>{t('programSpeakerRemoved', { count: tolte })}</span>
        </p>
      )}

      {value.agendaEnabled ? (
        <p className="wizard-programma__stato">
          <Icon icon="it-check-circle" size="sm" />
          <span>{tp('statusOn')}</span>
        </p>
      ) : (
        <div className="wizard-programma__stato wizard-programma__stato--spento">
          <Icon icon="it-info-circle" size="sm" />
          <span id={`${id}-spento`}>{tp('statusOff')}</span>
          {!locked && (
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              aria-describedby={`${id}-spento`}
              onClick={accendi}
            >
              {tp('turnOn')}
            </button>
          )}
          {!locked && compilate > 0 && (
            <span className="wizard-programma__stato-nota">
              {creazione ? tp('offKeptCreate') : tp('offKeptEdit')}
            </span>
          )}
        </div>
      )}

      {/* Una sola regione per cio' che il fuoco non dice da solo. */}
      <p className="visually-hidden" role="status">
        {annuncio}
      </p>

      {!locked && (
        <section className="wizard-programma__blocco" aria-labelledby={`${id}-chi`}>
          <h3 id={`${id}-chi`} className="wizard-programma__sottotitolo">
            {tp('whoHeading')}
          </h3>
          {senzaPersone && (
            <p className="wizard-programma__vuoto">
              {tp('noPeople')}{' '}
              {onVaiPersone && (
                <button
                  type="button"
                  className="btn btn-link p-0 align-baseline"
                  onClick={onVaiPersone}
                >
                  {tp('goToPeople')}
                </button>
              )}
            </p>
          )}
          <ul className="wizard-programma__persone" role="list">
            {opzioni.map((o) => (
              <li key={o.key}>
                <button
                  type="button"
                  className="wizard-programma__persona"
                  aria-label={tp('addTalkFor', { name: nomeDi(o) })}
                  disabled={pieno}
                  onClick={() => aggiungiIntervento(o)}
                >
                  <PersonAvatar name={nomeDi(o)} photoId={fotoDi(o.key)} size={32} />
                  <span className="wizard-programma__persona-testo">
                    <span className="wizard-programma__persona-nome">{nomeDi(o)}</span>
                    <span className="wizard-programma__persona-ruolo">
                      {etichettaRuolo(o.role)}
                    </span>
                  </span>
                  <span className="wizard-programma__persona-azione">
                    <Icon icon="it-plus" size="xs" />
                    {tp('addTalk')}
                  </span>
                </button>
              </li>
            ))}
            <li>
              <button
                ref={nuovaRef}
                type="button"
                className="wizard-programma__persona wizard-programma__persona--nuova"
                aria-expanded={nuovaAperta}
                aria-controls={nuovaAperta ? `${id}-nuova` : undefined}
                disabled={pieno && !nuovaAperta}
                onClick={() => setNuovaAperta((v) => !v)}
              >
                <span className="wizard-programma__persona-azione">
                  <Icon icon="it-plus" size="xs" />
                  {tp('newPerson')}
                </span>
              </button>
            </li>
          </ul>
          {senzaIntervento.length > 0 && (
            <p className="wizard-programma__senza">
              {tp('withoutTalk', { names: elenco(senzaIntervento.map((o) => o.name)) })}
            </p>
          )}
          {nuovaAperta && (
            <NuovaPersona
              id={`${id}-nuova`}
              presi={presi}
              pieno={pieno}
              onAggiungi={aggiungiPersona}
              onAnnulla={() => {
                setNuovaAperta(false);
                nuovaRef.current?.focus();
              }}
            />
          )}
        </section>
      )}

      <section className="wizard-programma__blocco" aria-labelledby={`${id}-argomenti`}>
        <h3 id={`${id}-argomenti`} className="wizard-programma__sottotitolo">
          {tp('topicsHeading')}
        </h3>
        {agenda.length === 0 ? (
          <p className="wizard-programma__vuoto">{tp('empty')}</p>
        ) : (
          <>
            {/* Le intestazioni delle colonne, per chi vede; ogni campo ha la sua
                etichetta (nascosta sugli schermi larghi, dove c'e' questa riga). */}
            <div className="wizard-programma__intestazione" aria-hidden="true">
              <span>{t('programTime')}</span>
              <span>{t('programTopicHeader')}</span>
              <span>{t('programSpeaker')}</span>
              <span>{t('programMinutes')}</span>
              <span />
            </div>
            <ol className="wizard-programma" role="list">
              {agenda.map((v, i) => {
                const n = i + 1;
                // Id fissi: il riepilogo porta al campo di una riga (idDelCampo).
                const rid = `wiz-programma-${i}`;
                const scelta = opzioni.find((o) => o.key === v.speakerKey);
                const minutiErrati = !!fieldErrors[`agenda.${i}.minutes`];
                const inizioRiga = inizi[i] ?? null;
                return (
                  <li key={v.key} className="wizard-programma__voce">
                    <span className="wizard-programma__ora">
                      {inizioRiga ? (
                        <time dateTime={inizioRiga.toISOString()}>{ora(inizioRiga)}</time>
                      ) : haTitolo(v) ? (
                        <span title={t('programTimeUnknown')}>
                          <span aria-hidden="true">–</span>
                          <span className="visually-hidden">{t('programTimeUnknown')}</span>
                        </span>
                      ) : (
                        // Una riga senza titolo non ha orario: non si salva.
                        <span aria-hidden="true">–</span>
                      )}
                    </span>
                    <div className="wizard-programma__argomento">
                      <label
                        className="wizard-programma__etichetta"
                        htmlFor={`${rid}-titolo`}
                      >
                        <span aria-hidden="true">{t('programTopicHeader')}</span>
                        <span className="visually-hidden">{t('programTopic', { n })}</span>
                      </label>
                      <input
                        id={`${rid}-titolo`}
                        type="text"
                        maxLength={500}
                        className="form-control form-control-sm"
                        value={v.label}
                        readOnly={soloLettura}
                        onChange={(e) => aggiorna(i, { label: e.target.value })}
                      />
                    </div>
                    <div className="wizard-programma__chi">
                      <label className="wizard-programma__etichetta" htmlFor={`${rid}-chi`}>
                        <span aria-hidden="true">{t('programSpeaker')}</span>
                        <span className="visually-hidden">
                          {t('programSpeakerFor', { n })}
                        </span>
                      </label>
                      <select
                        id={`${rid}-chi`}
                        className="form-select form-select-sm"
                        value={v.speakerKey ?? ''}
                        disabled={soloLettura}
                        aria-describedby={
                          scelta && !scelta.publicListed ? `${rid}-nascosto` : undefined
                        }
                        onChange={(e) => aggiorna(i, { speakerKey: e.target.value || null })}
                      >
                        <option value="">{t('programNone')}</option>
                        {opzioni.map((o) => (
                          <option key={o.key} value={o.key}>
                            {nomeOpzione(o)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="wizard-programma__min">
                      <label className="wizard-programma__etichetta" htmlFor={`${rid}-min`}>
                        <span aria-hidden="true">{t('programMinutes')}</span>
                        <span className="visually-hidden">
                          {t('programMinutesFor', { n })}
                        </span>
                      </label>
                      <input
                        id={`${rid}-min`}
                        type="text"
                        inputMode="numeric"
                        maxLength={3}
                        className={`form-control form-control-sm${minutiErrati ? ' is-invalid' : ''}`}
                        value={v.minutes}
                        readOnly={soloLettura}
                        data-wizard-label={t('programMinutesFor', { n })}
                        onChange={(e) => aggiorna(i, { minutes: e.target.value })}
                      />
                      {minutiErrati && (
                        <div className="invalid-feedback d-block">{ta('minutesInvalid')}</div>
                      )}
                    </div>
                    {!soloLettura && (
                      <div className="wizard-programma__comandi">
                        <button
                          type="button"
                          className="btn btn-sm btn-icon wizard-programma__comando"
                          onClick={() => sposta(i, -1)}
                          disabled={i === 0}
                          aria-label={t('programMoveUp', { n })}
                          title={t('programMoveUp', { n })}
                        >
                          <Icon icon="it-arrow-up" size="sm" />
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-icon wizard-programma__comando"
                          onClick={() => sposta(i, 1)}
                          disabled={i === agenda.length - 1}
                          aria-label={t('programMoveDown', { n })}
                          title={t('programMoveDown', { n })}
                        >
                          <Icon icon="it-arrow-down" size="sm" />
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-icon wizard-programma__comando wizard-programma__comando--togli"
                          onClick={() => onChange({ agenda: agenda.filter((_, j) => j !== i) })}
                          aria-label={t('programRemove', { n })}
                          title={t('programRemove', { n })}
                        >
                          <Icon icon="it-close" size="sm" />
                        </button>
                      </div>
                    )}
                    {scelta && !scelta.publicListed && (
                      <p className="wizard-programma__nascosto">
                        <span id={`${rid}-nascosto`}>
                          {tp('notPublic', { name: nomeDi(scelta) })}
                        </span>{' '}
                        {!soloLettura && (
                          <button
                            type="button"
                            className="btn btn-link p-0 align-baseline wizard-programma__mostra"
                            aria-describedby={`${rid}-nascosto`}
                            onClick={() => mostraNome(scelta, i)}
                          >
                            {tp('makePublic')}
                          </button>
                        )}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          </>
        )}

        {!locked && (
          <Aggiunta
            agenda={agenda}
            onAggiunte={(nuova, indice) => {
              const { patch, accesa } = conAccensione(nuova);
              onChange(patch);
              setFuoco({ riga: indice, campo: 'titolo' });
              if (accesa) annuncia(tp('turnedOn'));
            }}
          />
        )}

        {compilate > 0 && (
          <div className="wizard-programma__totale" aria-live="polite">
            {fineProgramma && totale !== null ? (
              <p className="mb-0">
                {t('programTotal', {
                  duration: durata(0, totale * 60_000),
                  end: ora(fineProgramma) ?? '',
                })}
              </p>
            ) : (
              <p className="mb-0">{t('programTotalPartial')}</p>
            )}
            {oltre > 0 && (
              <p className="wizard-iscrizione__avviso">
                <Icon icon="it-warning-circle" size="sm" />
                <span>{t('programOverrun', { duration: durata(0, oltre * 60_000) })}</span>
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Una persona nuova, con il suo intervento: nome, email, ruolo ed ente, e se
 * mostrarla nella pagina pubblica (spento, come nel passo «Persone»). Niente
 * rubrica ne' foto: per quelle c'e' il passo «Persone».
 */
function NuovaPersona({
  id,
  presi,
  pieno,
  onAggiungi,
  onAnnulla,
}: {
  id: string;
  /** Gli indirizzi gia' usati, organizzatore principale compreso. */
  presi: ReadonlySet<string>;
  /** Il programma ha gia' il numero massimo di argomenti: non se ne
   *  aggiungono (il modulo puo' essere stato aperto prima). */
  pieno: boolean;
  onAggiungi: (persona: SpeakerEntry, role: PersonRole) => void;
  onAnnulla: () => void;
}) {
  const t = useTranslations('admin.wizard.step3');
  const tp = useTranslations('admin.wizard.programme');
  const tc = useTranslations('common');
  const [bozza, setBozza] = useState<Bozza>(BOZZA_VUOTA);
  const [errore, setErrore] = useState<ErrorePersona | null>(null);
  const nomeRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  // Aperto, si comincia dal nome.
  useEffect(() => {
    nomeRef.current?.focus();
  }, []);

  // Un errore vale per cio' che si era scritto: cambiando un campo se ne va.
  const cambia = (patch: Partial<Bozza>) => {
    setBozza((prima) => ({ ...prima, ...patch }));
    setErrore(null);
  };

  const conferma = () => {
    if (pieno) return;
    const esito = controllaBozza(bozza, presi);
    if ('errore' in esito) {
      setErrore(esito.errore);
      // Il fuoco al campo da correggere: il nome se manca, altrimenti l'email.
      (esito.errore === 'personRequired' && !bozza.name.trim() ? nomeRef : emailRef).current?.focus();
      return;
    }
    onAggiungi(esito.persona, esito.role);
  };
  // Invio in un campo conferma, come il pulsante.
  const alTasto = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      conferma();
    }
  };
  const nomeErrato = errore === 'personRequired' && !bozza.name.trim();
  const emailErrata =
    (errore === 'personRequired' && !bozza.email.trim()) ||
    errore === 'invalidEmail' ||
    errore === 'duplicateEmail';
  const descrizioneEmail = [`${id}-email-aiuto`, emailErrata ? `${id}-errore` : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div id={id} className="wizard-programma__nuova" role="group" aria-labelledby={`${id}-titolo`}>
      <h4 id={`${id}-titolo`} className="wizard-programma__nuova-titolo">
        {tp('newPersonHeading')}
      </h4>
      <div className="row g-2">
        <div className="col-md-6">
          <label className="form-label small mb-1" htmlFor={`${id}-nome`}>
            {t('personName')} *
          </label>
          <input
            ref={nomeRef}
            id={`${id}-nome`}
            type="text"
            className="form-control form-control-sm"
            value={bozza.name}
            aria-invalid={nomeErrato || undefined}
            aria-describedby={nomeErrato ? `${id}-errore` : undefined}
            onKeyDown={alTasto}
            onChange={(e) => cambia({ name: e.target.value })}
          />
        </div>
        <div className="col-md-6">
          <label className="form-label small mb-1" htmlFor={`${id}-email`}>
            {t('personEmail')} *
          </label>
          <input
            ref={emailRef}
            id={`${id}-email`}
            type="email"
            className="form-control form-control-sm"
            value={bozza.email}
            aria-invalid={emailErrata || undefined}
            aria-describedby={descrizioneEmail}
            onKeyDown={alTasto}
            onChange={(e) => cambia({ email: e.target.value })}
          />
          <small id={`${id}-email-aiuto`} className="d-block text-secondary mt-1">
            {tp('newPersonEmailHelp')}
          </small>
        </div>
        <div className="col-md-6">
          <label className="form-label small mb-1" htmlFor={`${id}-ruolo`}>
            {t('personRole')}
          </label>
          <select
            id={`${id}-ruolo`}
            className="form-select form-select-sm"
            value={bozza.role}
            onChange={(e) => cambia({ role: e.target.value as PersonRole })}
          >
            <option value="speaker">{t('roleSpeaker')}</option>
            <option value="moderator">{t('roleModerator')}</option>
            <option value="organizer">{t('roleOrganizer')}</option>
          </select>
        </div>
        <div className="col-md-6">
          <label className="form-label small mb-1" htmlFor={`${id}-ente`}>
            {t('personOrganization')}
          </label>
          <input
            id={`${id}-ente`}
            type="text"
            maxLength={200}
            className="form-control form-control-sm"
            value={bozza.organization ?? ''}
            onKeyDown={alTasto}
            onChange={(e) => cambia({ organization: e.target.value || null })}
          />
        </div>
        <div className="col-12">
          <div className="form-check mb-0">
            <input
              id={`${id}-pubblica`}
              type="checkbox"
              className="form-check-input"
              checked={bozza.publicListed}
              aria-describedby={`${id}-pubblica-aiuto`}
              onChange={(e) => cambia({ publicListed: e.target.checked })}
            />
            <label className="form-check-label small" htmlFor={`${id}-pubblica`}>
              {t('personPublic')}
            </label>
          </div>
          <small id={`${id}-pubblica-aiuto`} className="d-block text-secondary">
            {tp('newPersonPublicHelp')}
          </small>
        </div>
        {errore && (
          <div className="col-12">
            <p id={`${id}-errore`} className="small text-danger fw-semibold mb-0" role="alert">
              {t(errore)}
            </p>
          </div>
        )}
        <div className="col-12 d-flex flex-wrap gap-2 mt-2">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={pieno}
            onClick={conferma}
          >
            {tp('newPersonAssign')}
          </button>
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onAnnulla}>
            {tc('cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** «Aggiungi un argomento» e, a richiesta, un elenco incollato: un argomento
 *  per riga. */
function Aggiunta({
  agenda,
  onAggiunte,
}: {
  agenda: AgendaDraft[];
  /** Il programma con le righe nuove, e la prima di loro (prende il fuoco). */
  onAggiunte: (agenda: AgendaDraft[], indice: number) => void;
}) {
  const t = useTranslations('admin.wizard.step3');
  const ta = useTranslations('agenda');
  const tc = useTranslations('common');
  const id = useId();
  const [incolla, setIncolla] = useState(false);
  const [testo, setTesto] = useState('');
  // La riga appena aggiunta in fondo e ancora intatta (senza argomento, chi
  // interviene ne' durata) si sostituisce: non occupa posto, e non resta
  // vuota in mezzo all'elenco.
  const base = rigaIntatta(agenda.at(-1)) ? agenda.slice(0, -1) : agenda;
  const posti = MAX_AGENDA_ITEMS - base.length;
  const righe = splitAgendaLines(testo).slice(0, posti);

  return (
    <>
      <div className="wizard-programma__azioni">
        <button
          type="button"
          className="btn btn-outline-primary btn-sm d-inline-flex align-items-center gap-1"
          disabled={agenda.length >= MAX_AGENDA_ITEMS}
          onClick={() => onAggiunte([...agenda, nuovaVoce()], agenda.length)}
        >
          <Icon icon="it-plus" size="sm" color="primary" />
          {t('programAdd')}
        </button>
        <button
          type="button"
          className="btn btn-link btn-sm"
          aria-expanded={incolla}
          aria-controls={`${id}-incolla`}
          disabled={posti <= 0}
          onClick={() => setIncolla((v) => !v)}
        >
          {t('programPaste')}
        </button>
      </div>
      {incolla && (
        <div id={`${id}-incolla`} className="wizard-programma__incolla">
          <label className="form-label small mb-1" htmlFor={`${id}-testo`}>
            {t('programPasteLabel')}
          </label>
          <textarea
            id={`${id}-testo`}
            className="form-control form-control-sm"
            rows={4}
            value={testo}
            aria-describedby={`${id}-aiuto`}
            onChange={(e) => setTesto(e.target.value)}
          />
          <small id={`${id}-aiuto`} className="d-block text-secondary mt-1">
            {t('programPasteHelp')}
          </small>
          <div className="d-flex flex-wrap gap-2 mt-2">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={righe.length === 0}
              onClick={() => {
                onAggiunte([...base, ...righe.map((r) => nuovaVoce(r))], base.length);
                setTesto('');
                setIncolla(false);
              }}
            >
              {ta('addMany', { count: righe.length })}
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => {
                setTesto('');
                setIncolla(false);
              }}
            >
              {tc('cancel')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

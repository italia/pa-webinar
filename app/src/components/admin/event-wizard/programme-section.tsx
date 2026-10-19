'use client';

/**
 * Il programma dell'incontro nel passo «Persone»: gli argomenti in ordine,
 * chi interviene (fra le persone del passo) e quanto dura ciascuno. Con
 * l'agenda accesa compare nella pagina pubblica dell'evento; con l'agenda
 * spenta il gruppo e' una riga sola, con il pulsante che la accende.
 *
 * Gli orari si calcolano dall'inizio dell'evento, nel suo fuso, sommando le
 * durate: si fermano al primo argomento senza durata. Un programma che va
 * oltre la fine dell'evento lo dice, senza impedire di salvare.
 *
 * Quando l'agenda e' gia' stata usata in sala (un argomento avviato, o con le
 * reazioni del pubblico) il gruppo si legge soltanto: da li' l'agenda si
 * guida dalla sala.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Icon } from '@/components/ui/icon';
import { useDurataTesto } from '@/hooks/use-durata-testo';
import { orariProgramma, parsePlannedMinutes } from '@/lib/agenda/programme';
import { splitAgendaLines, MAX_AGENDA_ITEMS } from '@/lib/agenda/status';
import type { PersonRole } from '@/lib/events/grant-profile';
import { toDatetimeLocalInTz } from '@/lib/utils/date-format';

import {
  CHIAVE_PRINCIPALE,
  chiaviOrfane,
  istanteDalModulo,
  nuovaVoce,
  opzioniRelatore,
  type AgendaDraft,
} from './programme-plan';
import Gruppo from './wizard-group';
import type { ModeratorEntry, SpeakerEntry } from './step-2-people';

interface Props {
  value: {
    agenda: AgendaDraft[];
    agendaEnabled: boolean;
    startsAt: string;
    endsAt: string;
    timezone: string;
    moderatorName: string;
    moderatorPublicListed: boolean;
    moderators: ModeratorEntry[];
    speakers: SpeakerEntry[];
  };
  onChange: (patch: { agenda?: AgendaDraft[]; agendaEnabled?: boolean }) => void;
  /** L'agenda e' gia' stata usata in sala: il programma si legge soltanto. */
  locked?: boolean;
  fieldErrors?: Record<string, string>;
}

export default function ProgrammeSection({
  value,
  onChange,
  locked = false,
  fieldErrors = {},
}: Props) {
  const t = useTranslations('admin.wizard.step3');
  // Le stesse frasi dell'agenda della sala: e' lo stesso elenco.
  const ta = useTranslations('agenda');
  const durata = useDurataTesto();
  const id = useId();
  const agenda = useMemo(() => value.agenda ?? [], [value.agenda]);

  // Le persone fra cui scegliere. L'organizzatore principale c'e' sempre,
  // anche senza nome: cancellarlo e riscriverlo non deve togliere la scelta.
  const opzioni = useMemo(() => {
    const tutte = opzioniRelatore(value);
    return tutte.some((o) => o.key === CHIAVE_PRINCIPALE)
      ? tutte
      : [
          {
            key: CHIAVE_PRINCIPALE,
            name: '',
            role: 'organizer' as PersonRole,
            publicListed: !!value.moderatorPublicListed,
          },
          ...tutte,
        ];
  }, [value]);

  // Una persona tolta dal passo non interviene piu': la sua scelta si toglie,
  // e lo si dice.
  const [tolte, setTolte] = useState(0);
  const orfane = chiaviOrfane(agenda, opzioni);
  const firmaOrfane = [...orfane].sort().join('|');
  useEffect(() => {
    if (locked || orfane.size === 0) return;
    const quante = agenda.filter((v) => v.speakerKey && orfane.has(v.speakerKey)).length;
    setTolte(quante);
    onChange({
      agenda: agenda.map((v) =>
        v.speakerKey && orfane.has(v.speakerKey) ? { ...v, speakerKey: null } : v
      ),
    });
    // Solo quando cambia l'insieme delle scelte rimaste senza persona.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmaOrfane, locked]);

  // Accendendo l'agenda da qui il fuoco va al primo argomento: il pulsante
  // che e' stato premuto sparisce.
  const primoCampoRef = useRef<HTMLInputElement | null>(null);
  const [daFocalizzare, setDaFocalizzare] = useState(false);
  useEffect(() => {
    if (!daFocalizzare || !value.agendaEnabled) return;
    primoCampoRef.current?.focus();
    setDaFocalizzare(false);
  }, [daFocalizzare, value.agendaEnabled]);

  if (!value.agendaEnabled) {
    return (
      <section
        className="wizard-group wizard-group--static wizard-programma-spento mb-3"
        aria-labelledby={`${id}-spento`}
      >
        <div className="wizard-group__body">
          <div className="wizard-programma-spento__testo">
            <h3 id={`${id}-spento`} className="wizard-group__title h6 mb-1">
              {t('programHeading')}
            </h3>
            <p className="wizard-group__help mt-0 mb-0">{t('programOff')}</p>
          </div>
          <button
            type="button"
            className="btn btn-outline-primary btn-sm flex-shrink-0"
            onClick={() => {
              onChange({
                agendaEnabled: true,
                ...(agenda.length === 0 ? { agenda: [nuovaVoce()] } : {}),
              });
              setDaFocalizzare(true);
            }}
          >
            {t('programEnable')}
          </button>
        </div>
      </section>
    );
  }

  const tz = value.timezone;
  const inizio = istanteDalModulo(value.startsAt, tz);
  const fine = istanteDalModulo(value.endsAt, tz);
  const minuti = agenda.map((v) => parsePlannedMinutes(v.minutes) ?? null);
  const orari = inizio
    ? orariProgramma(
        inizio,
        minuti.map((m) => ({ plannedMinutes: m }))
      )
    : [];
  const ora = (d: Date | null | undefined) =>
    d ? toDatetimeLocalInTz(d, tz).slice(11, 16) : null;
  const compilate = agenda.filter((v) => v.label.trim()).length;
  const tutteConDurata = agenda.length > 0 && minuti.every((m) => m !== null);
  const totale = minuti.reduce<number>((s, m) => s + (m ?? 0), 0);
  const fineProgramma = tutteConDurata ? (orari.at(-1)?.end ?? null) : null;
  const oltre =
    fineProgramma && fine
      ? Math.round((fineProgramma.getTime() - fine.getTime()) / 60_000)
      : 0;

  const aggiorna = (i: number, patch: Partial<AgendaDraft>) =>
    onChange({ agenda: agenda.map((v, j) => (j === i ? { ...v, ...patch } : v)) });
  const sposta = (i: number, verso: -1 | 1) => {
    const j = i + verso;
    if (j < 0 || j >= agenda.length) return;
    const nuova = [...agenda];
    [nuova[i], nuova[j]] = [nuova[j]!, nuova[i]!];
    onChange({ agenda: nuova });
  };
  const etichettaRuolo = (r: PersonRole) =>
    r === 'organizer'
      ? t('roleOrganizer')
      : r === 'moderator'
        ? t('roleModerator')
        : t('roleSpeaker');
  const nomeOpzione = (o: (typeof opzioni)[number]) =>
    o.key === CHIAVE_PRINCIPALE && !o.name
      ? t('programLeadOrganizer')
      : t('programPerson', { name: o.name, role: etichettaRuolo(o.role) });

  return (
    <Gruppo
      title={t('programHeading')}
      help={t('programHelp')}
      count={compilate}
      aperto={agenda.length > 0}
    >
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

      {agenda.length > 0 && (
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
              const orario = ora(orari[i]?.start);
              return (
                <li key={v.key} className="wizard-programma__voce">
                  <span className="wizard-programma__ora">
                    {orario ? (
                      <time dateTime={orari[i]!.start!.toISOString()}>{orario}</time>
                    ) : (
                      <span title={t('programTimeUnknown')}>
                        <span aria-hidden="true">–</span>
                        <span className="visually-hidden">{t('programTimeUnknown')}</span>
                      </span>
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
                      ref={i === 0 ? primoCampoRef : undefined}
                      id={`${rid}-titolo`}
                      type="text"
                      maxLength={500}
                      className="form-control form-control-sm"
                      value={v.label}
                      readOnly={locked}
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
                      disabled={locked}
                      aria-describedby={
                        scelta && !scelta.publicListed ? `${rid}-nascosto` : undefined
                      }
                      onChange={(e) =>
                        aggiorna(i, { speakerKey: e.target.value || null })
                      }
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
                      readOnly={locked}
                      data-wizard-label={t('programMinutesFor', { n })}
                      onChange={(e) => aggiorna(i, { minutes: e.target.value })}
                    />
                    {minutiErrati && (
                      <div className="invalid-feedback d-block">
                        {ta('minutesInvalid')}
                      </div>
                    )}
                  </div>
                  {!locked && (
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
                        onClick={() =>
                          onChange({ agenda: agenda.filter((_, j) => j !== i) })
                        }
                        aria-label={t('programRemove', { n })}
                        title={t('programRemove', { n })}
                      >
                        <Icon icon="it-close" size="sm" />
                      </button>
                    </div>
                  )}
                  {scelta && !scelta.publicListed && (
                    <p id={`${rid}-nascosto`} className="wizard-programma__nascosto">
                      {t('programNotPublic')}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}

      {!locked && <Aggiunta agenda={agenda} onChange={onChange} />}

      {agenda.length > 0 && (
        <div className="wizard-programma__totale" aria-live="polite">
          {fineProgramma ? (
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
    </Gruppo>
  );
}

/** «Aggiungi un argomento» e, a richiesta, un elenco incollato: un argomento
 *  per riga. */
function Aggiunta({
  agenda,
  onChange,
}: {
  agenda: AgendaDraft[];
  onChange: (patch: { agenda: AgendaDraft[] }) => void;
}) {
  const t = useTranslations('admin.wizard.step3');
  const ta = useTranslations('agenda');
  const tc = useTranslations('common');
  const id = useId();
  const [incolla, setIncolla] = useState(false);
  const [testo, setTesto] = useState('');
  const pieno = agenda.length >= MAX_AGENDA_ITEMS;
  const righe = splitAgendaLines(testo).slice(0, MAX_AGENDA_ITEMS - agenda.length);
  const ultimoRef = useRef<number | null>(null);

  // Una riga aggiunta: il fuoco va al suo argomento.
  useEffect(() => {
    if (ultimoRef.current === null) return;
    const indice = ultimoRef.current;
    ultimoRef.current = null;
    const campi = document.querySelectorAll<HTMLInputElement>(
      '.wizard-programma__argomento input'
    );
    campi[indice]?.focus();
  }, [agenda.length]);

  return (
    <>
      <div className="wizard-programma__azioni">
        <button
          type="button"
          className="btn btn-outline-primary btn-sm d-inline-flex align-items-center gap-1"
          disabled={pieno}
          onClick={() => {
            ultimoRef.current = agenda.length;
            onChange({ agenda: [...agenda, nuovaVoce()] });
          }}
        >
          <Icon icon="it-plus" size="sm" color="primary" />
          {t('programAdd')}
        </button>
        <button
          type="button"
          className="btn btn-link btn-sm"
          aria-expanded={incolla}
          aria-controls={`${id}-incolla`}
          disabled={pieno}
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
                // Una sola riga vuota appena aggiunta si sostituisce.
                const base =
                  agenda.length === 1 && !agenda[0]!.label.trim() && !agenda[0]!.id
                    ? []
                    : agenda;
                ultimoRef.current = base.length;
                onChange({ agenda: [...base, ...righe.map((r) => nuovaVoce(r))] });
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

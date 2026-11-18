// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Button } from 'design-react-kit';

import type { PartecipantiNelVideo, VoceNelVideo } from '@/lib/live/consent-rule';
import { MESI_RUBRICA_PREDEFINITI } from '@/lib/persons/retention';
import { chiaveConsenso, type Destinazione } from '@/lib/recording/destination';

export interface StatoConsensoVista {
  dato: boolean;
  ritiratoIl: string | null;
}

export interface ConsensiVista {
  recording: StatoConsensoVista | null;
  transcription: StatoConsensoVista | null;
  futureCommunications: StatoConsensoVista | null;
  /** La spunta della rubrica che aspetta una conferma (lib/persons/spunta-in-attesa). */
  addressBookPending?: boolean;
}

/**
 * I consensi che la pagina puo' far dare di nuovo, con il testo da mostrare
 * (lib/gdpr/consent-giving, `offertaConsensi`). `null`: oggi non si da' da qui.
 */
export interface OffertaVista {
  recording: {
    destination: Destinazione;
    voice: VoceNelVideo;
    participants: PartecipantiNelVideo;
    eventText: string | null;
    /** Il consenso dato vale per il testo in vigore: uno su un testo che non lo
     *  copre resta dato, ma va dato di nuovo. Assente nelle risposte di prima. */
    inForce?: boolean;
  } | null;
  transcription: {
    text: 'multitrack' | 'multitrackRetained';
    voice: VoceNelVideo;
    needsRecording: boolean;
    inForce?: boolean;
  } | null;
  futureCommunications: boolean;
}

type Chiave = 'recording' | 'transcription' | 'futureCommunications';

/**
 * I consensi di un'iscrizione nella pagina dei propri dati: si ritirano uno
 * per uno, con una conferma che dice cosa cambia, senza cancellare
 * l'iscrizione. Uno non dato o ritirato si da' di nuovo da qui, con il testo
 * della casella davanti, finche' l'evento lo chiede (`offerta`): vale dal
 * prossimo ingresso in sala. Una spunta della rubrica rimasta in attesa si
 * conferma o si annulla da qui.
 */
export default function RegistrationConsents({
  token,
  registrationId,
  consensi,
  voce = 'rimovibile',
  comunicazioniRitirateIl = null,
  onComunicazioniRitirate,
  rubricaConfermata = false,
  onRubricaConfermata,
  offerta = null,
  locale,
}: {
  voce?: VoceNelVideo;
  /** Cosa si puo' dare di nuovo, e con quale testo. */
  offerta?: OffertaVista | null;
  /** La lingua della pagina: va con la prova del consenso dato. */
  locale?: string;
  token: string;
  registrationId: string;
  consensi: ConsensiVista;
  /** Il ritiro delle comunicazioni vale per tutte le iscrizioni dell'indirizzo:
   *  chi ospita le schede lo riporta su ciascuna. */
  comunicazioniRitirateIl?: string | null;
  onComunicazioniRitirate?: (quando: string) => void;
  /** Anche la conferma vale per l'indirizzo: chiude ogni spunta in attesa, e chi
   *  ospita le schede lo riporta su ciascuna. */
  rubricaConfermata?: boolean;
  onRubricaConfermata?: () => void;
}) {
  const t = useTranslations('gdpr.export');
  const tl = useTranslations('live.consents');
  const tc = useTranslations('common');
  const tGdpr = useTranslations('gdpr.consent');
  const format = useFormatter();
  const [statiLocali, setStati] = useState(consensi);
  // Le comunicazioni ridate da qui dopo un ritiro fatto da un'altra scheda della
  // pagina: il ritiro piu' vecchio non le spegne di nuovo.
  const [comunicazioniRidateIl, setComunicazioniRidateIl] = useState<string | null>(null);
  const [dato, setDato] = useState<Chiave | null>(null);
  // Cio' che la pagina ha cambiato da quando ha letto i dati: prevale su `inForce`.
  const [vigoreLocale, setVigoreLocale] = useState<Partial<Record<Chiave, boolean>>>({});
  const dopoConferma: ConsensiVista =
    rubricaConfermata && statiLocali.addressBookPending
      ? {
          ...statiLocali,
          addressBookPending: false,
          futureCommunications: { dato: true, ritiratoIl: null },
        }
      : statiLocali;
  const ritiroDaFuori =
    comunicazioniRitirateIl &&
    !(comunicazioniRidateIl && comunicazioniRidateIl > comunicazioniRitirateIl)
      ? comunicazioniRitirateIl
      : null;
  const stati: ConsensiVista = ritiroDaFuori
    ? {
        ...dopoConferma,
        addressBookPending: false,
        ...(dopoConferma.futureCommunications?.dato
          ? { futureCommunications: { dato: false, ritiratoIl: ritiroDaFuori } }
          : {}),
      }
    : dopoConferma;
  const [conferma, setConferma] = useState<Chiave | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  // Il testo a cui si acconsente, lo stesso della casella del modulo e della sala.
  const testoDaDare: Record<Chiave, string | null> = {
    recording: offerta?.recording
      ? [
          offerta.recording.eventText,
          tGdpr(chiaveConsenso(offerta.recording.destination, offerta.recording.participants)),
        ]
          .filter(Boolean)
          .join(' ')
      : null,
    transcription: offerta?.transcription
      ? [
          tGdpr(offerta.transcription.text),
          tGdpr(
            offerta.transcription.voice === 'fissa'
              ? 'multitrackOptional'
              : 'multitrackOptionalShort'
          ),
        ].join(' ')
      : null,
    // Con una spunta in attesa si conferma quella, piu' su: un secondo pulsante
    // per la stessa cosa confonderebbe.
    futureCommunications: offerta?.futureCommunications && !stati.addressBookPending
      ? [
          tGdpr('stayInTouch'),
          tGdpr('stayInTouchRetention', { months: MESI_RUBRICA_PREDEFINITI }),
          t('consentFutureGiveEffect'),
        ].join(' ')
      : null,
  };
  const etichettaDai: Record<Chiave, string> = {
    recording: tl('recording.give'),
    transcription: tl('transcription.give'),
    futureCommunications: t('consentFutureGive'),
  };
  // Vale per il testo in vigore: lo dice il server alla lettura, poi cio' che la
  // pagina ha dato o ritirato.
  // Le comunicazioni future non hanno un testo che cambia: vale lo stato, che segue
  // anche i ritiri e le conferme fatti da altre schede della pagina.
  const inVigore = (chiave: Chiave): boolean => {
    if (chiave === 'futureCommunications') return !!stati.futureCommunications?.dato;
    if (vigoreLocale[chiave] !== undefined) return vigoreLocale[chiave]!;
    return offerta?.[chiave]?.inForce ?? !!stati[chiave]?.dato;
  };
  // La trascrizione senza la registrazione non avrebbe la voce: va data dopo.
  const serveRegistrazione =
    !!offerta?.transcription?.needsRecording && !inVigore('recording');

  const voci: Array<{ chiave: Chiave; titolo: string; effetto: string; nota?: string }> =
    [
      {
        chiave: 'recording',
        titolo: tl('recording.title'),
        // Il ritiro porta con se' la trascrizione (`ritira`): la conferma lo dice.
        effetto: [
          ...(voce === 'assente'
            ? []
            : [tl(voce === 'rimovibile' ? 'recording.withdraw.voce' : 'recording.withdraw.soloAscolto')]),
          ...(stati.transcription?.dato ? [tl('recording.withdrawTranscript')] : []),
        ].join(' '),
        nota: tl('recording.alreadyRecorded'),
      },
      {
        chiave: 'transcription',
        titolo: tl('transcription.title'),
        effetto: tl('transcription.withdrawEffect'),
      },
      {
        chiave: 'futureCommunications',
        titolo: t('consentFuture'),
        effetto: t('consentFutureEffect'),
      },
    ];
  const visibili = voci.filter((v) => stati[v.chiave] !== null);
  if (visibili.length === 0 && !stati.addressBookPending && !errore) return null;

  const invia = async (
    azione: Record<string, unknown>,
    fatto: () => void,
    nonTrovato?: () => void
  ) => {
    setInCorso(true);
    setErrore(null);
    setDato(null);
    try {
      const res = await fetch('/api/gdpr/consents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, registrationId, ...azione }),
      });
      // Il token dura un'ora: riprovare non serve, ci vuole un link nuovo.
      if (res.status === 401) return setErrore(t('linkInvalid'));
      if (res.status === 429) return setErrore(t('rateLimited'));
      if (res.status === 404 && nonTrovato) return nonTrovato();
      if (res.status === 409) {
        const { code } = (await res.json().catch(() => ({}))) as { code?: string };
        return setErrore(
          code === 'CONSENT_TEXT_CHANGED'
            ? t('consentGiveTextChanged')
            : code === 'RECORDING_CONSENT_REQUIRED'
              ? tl('transcription.needsRecording')
              : t('consentGiveClosed')
        );
      }
      if (!res.ok) return setErrore(tl('error'));
      fatto();
    } catch {
      setErrore(tl('error'));
    } finally {
      setInCorso(false);
    }
  };

  const ritira = (chiave: Chiave) =>
    invia({ consent: chiave }, () => {
      const adesso = new Date().toISOString();
      setStati((prima) => ({
        ...prima,
        [chiave]: { dato: false, ritiratoIl: adesso },
        // Senza registrazione non c'e' trascrizione: si ritira insieme.
        ...(chiave === 'recording' && prima.transcription?.dato
          ? { transcription: { dato: false, ritiratoIl: adesso } }
          : {}),
        // Il ritiro delle comunicazioni toglie anche la spunta in attesa.
        ...(chiave === 'futureCommunications' ? { addressBookPending: false } : {}),
      }));
      if (chiave === 'futureCommunications') onComunicazioniRitirate?.(adesso);
      if (chiave !== 'futureCommunications') {
        setVigoreLocale((prima) => ({
          ...prima,
          [chiave]: false,
          ...(chiave === 'recording' ? { transcription: false } : {}),
        }));
      }
      setConferma(null);
    });

  const dai = (chiave: Chiave) =>
    invia(
      {
        consent: chiave,
        give: true,
        locale,
        ...(chiave === 'recording'
          ? { recordingDestination: offerta?.recording?.destination ?? null }
          : {}),
        ...(chiave === 'transcription' ? { transcriptionText: offerta?.transcription?.text } : {}),
      },
      () => {
        setStati((prima) => ({
          ...prima,
          [chiave]: { dato: true, ritiratoIl: null },
          ...(chiave === 'futureCommunications' ? { addressBookPending: false } : {}),
        }));
        if (chiave !== 'futureCommunications') {
          setVigoreLocale((prima) => ({ ...prima, [chiave]: true }));
        }
        if (chiave === 'futureCommunications') {
          setComunicazioniRidateIl(new Date().toISOString());
          // Il rientro in rubrica chiude anche le spunte in attesa delle altre
          // iscrizioni dell'indirizzo, come la conferma.
          onRubricaConfermata?.();
        }
        setDato(chiave);
      }
    );

  const confermaRubrica = () =>
    invia(
      { confirmAddressBook: true },
      () => {
        setStati((prima) => ({
          ...prima,
          addressBookPending: false,
          futureCommunications: { dato: true, ritiratoIl: null },
        }));
        onRubricaConfermata?.();
      },
      // Una pagina rimasta aperta: la spunta non aspetta piu', perche' confermata
      // altrove o tolta dove la rubrica non si propone. I pulsanti non servono piu'.
      () => {
        setStati((prima) => ({ ...prima, addressBookPending: false }));
        setErrore(t('addressBookPendingGone'));
      }
    );

  return (
    <section className="mb-3" aria-label={tl('title')}>
      <h4 className="h6 text-secondary mb-2">{tl('title')}</h4>
      <p className="text-muted mb-2" style={{ fontSize: '0.9rem' }}>
        {t('consentsIntro')}
      </p>
      <ul className="list-unstyled mb-2" style={{ fontSize: '0.9rem' }}>
        {stati.addressBookPending && (
          <li className="mb-3">
            <div className="fw-semibold">{t('addressBookPendingTitle')}</div>
            <div className="text-muted">{t('addressBookPendingBody')}</div>
            <div className="text-muted">{t('addressBookPendingEffect')}</div>
            <div className="d-flex flex-wrap gap-2 mt-1">
              <Button
                color="primary"
                size="sm"
                disabled={inCorso}
                onClick={() => void confermaRubrica()}
              >
                {t('addressBookPendingConfirm')}
              </Button>
              <Button
                color="secondary"
                outline
                size="sm"
                disabled={inCorso}
                onClick={() => void ritira('futureCommunications')}
              >
                {t('addressBookPendingCancel')}
              </Button>
            </div>
          </li>
        )}
        {visibili.map(({ chiave, titolo, effetto, nota }) => {
          const stato = stati[chiave]!;
          return (
            <li key={chiave} className="mb-3">
              <div className="fw-semibold">{titolo}</div>
              <div className="text-muted">
                {stato.dato
                  ? tl('given')
                  : stato.ritiratoIl
                    ? t('consentWithdrawnOn', {
                        date: format.dateTime(new Date(stato.ritiratoIl), {
                          dateStyle: 'long',
                        }),
                      })
                    : tl('notGiven')}
              </div>
              {stato.dato && nota && <div className="text-muted">{nota}</div>}
              {stato.dato && !inVigore(chiave) && testoDaDare[chiave] && (
                <div className="text-muted">{t('consentGiveNewText')}</div>
              )}
              {stato.dato &&
                (conferma === chiave ? (
                  <div
                    className="d-flex flex-wrap align-items-center gap-2 mt-1"
                    role="group"
                    aria-label={tl('confirmTitle')}
                  >
                    {effetto && <span className="w-100 text-muted">{effetto}</span>}
                    <span className="fw-semibold">{tl('confirmTitle')}</span>
                    <Button
                      color="danger"
                      size="sm"
                      disabled={inCorso}
                      onClick={() => void ritira(chiave)}
                    >
                      {tl('confirm')}
                    </Button>
                    <Button
                      color="secondary"
                      outline
                      size="sm"
                      disabled={inCorso}
                      onClick={() => setConferma(null)}
                    >
                      {tc('cancel')}
                    </Button>
                  </div>
                ) : (
                  <Button
                    className="mt-1"
                    color="primary"
                    outline
                    size="sm"
                    onClick={() => setConferma(chiave)}
                  >
                    {tl('withdraw')}
                  </Button>
                ))}
              {!inVigore(chiave) && testoDaDare[chiave] && (
                <div className="mt-1">
                  <div id={`${registrationId}-${chiave}-testo`} className="text-muted">
                    {testoDaDare[chiave]}
                  </div>
                  {chiave === 'transcription' && serveRegistrazione && (
                    <div className="text-muted">{tl('transcription.needsRecording')}</div>
                  )}
                  <Button
                    className="mt-1"
                    color="primary"
                    outline
                    size="sm"
                    disabled={inCorso || (chiave === 'transcription' && serveRegistrazione)}
                    aria-describedby={`${registrationId}-${chiave}-testo`}
                    onClick={() => void dai(chiave)}
                  >
                    {etichettaDai[chiave]}
                  </Button>
                </div>
              )}
              {inVigore(chiave) && dato === chiave && (
                <div className="text-success" role="status">
                  {chiave === 'futureCommunications'
                    ? t('consentFutureGiveDone')
                    : t('consentGiveDone')}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {errore && (
        <p className="text-danger small mb-2" role="alert">
          {errore}
        </p>
      )}
      <p className="text-muted small mb-0">{t('consentNoteInRoom')}</p>
      {(offerta?.recording || offerta?.transcription) && (
        <p className="text-muted small mb-0 mt-1">{t('consentGiveNoteInRoom')}</p>
      )}
    </section>
  );
}

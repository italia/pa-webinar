// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Button } from 'design-react-kit';

import type { VoceNelVideo } from '@/lib/live/consent-rule';

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

type Chiave = 'recording' | 'transcription' | 'futureCommunications';

/**
 * I consensi di un'iscrizione nella pagina dei propri dati: si ritirano uno
 * per uno, con una conferma che dice cosa cambia, senza cancellare
 * l'iscrizione. Registrazione e trascrizione si possono ridare in sala finche'
 * l'evento e' aperto. Una spunta della rubrica rimasta in attesa si conferma o si
 * annulla da qui.
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
}: {
  voce?: VoceNelVideo;
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
  const format = useFormatter();
  const [statiLocali, setStati] = useState(consensi);
  const dopoConferma: ConsensiVista =
    rubricaConfermata && statiLocali.addressBookPending
      ? {
          ...statiLocali,
          addressBookPending: false,
          futureCommunications: { dato: true, ritiratoIl: null },
        }
      : statiLocali;
  const stati: ConsensiVista = comunicazioniRitirateIl
    ? {
        ...dopoConferma,
        addressBookPending: false,
        ...(dopoConferma.futureCommunications?.dato
          ? { futureCommunications: { dato: false, ritiratoIl: comunicazioniRitirateIl } }
          : {}),
      }
    : dopoConferma;
  const [conferma, setConferma] = useState<Chiave | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

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
      setConferma(null);
    });

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
    </section>
  );
}

// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from 'design-react-kit';

import { testoConsensoEvento, type PartecipantiNelVideo } from '@/lib/live/consent-rule';
import {
  chiaveAvvisoConduce,
  chiaveConsenso,
  type Destinazione,
} from '@/lib/recording/destination';
import type { chiaveConsensoTrascrizione } from '@/lib/registration/consents';

/**
 * I consensi della persona per questo evento, dalla sala: si danno e si
 * ritirano qui, in qualunque momento (art. 7.3 GDPR: ritirarli e' facile come
 * darli). Ogni cambio porta un token nuovo e la conferenza si ricollega per
 * qualche secondo.
 *
 * La finestra mostra i consensi che l'evento chiede a questa persona, quelli
 * che ha gia' dato e quello che le serve per rientrare nella registrazione;
 * cosa cambia lo dice la riga sotto ciascuno, prima di agire. Chi non ha dato
 * un consenso legge qui lo stesso testo della casella, con quello scelto
 * dall'ente per la registrazione: il clic vale per quello. Il ritiro chiede una
 * conferma: ricollega la conferenza
 * (o la chiude), e un clic per sbaglio non deve farlo.
 *
 * Chi conduce non da' il consenso alla registrazione: e' sempre nel video
 * (lib/live/consent-rule). La finestra non glielo offre e non lo nasconde:
 * dice al suo posto che e' nella registrazione, con dove va il video, come la
 * sala d'attesa (`conduce`).
 */

/**
 * Cosa cambia con il consenso alla registrazione. `avvertenza`: la voce resta nel
 * video e l'evento si limita ad avvisare, quindi in sala non cambia nulla, e chi
 * riceve la parola resta nel video. `assente`: un video completo non c'e'.
 */
export type EffettoRitiroRegistrazione =
  | 'voce'
  | 'soloAscolto'
  | 'conduce'
  | 'avvertenza'
  | 'assente';

export interface ConsensiInSala {
  /** Chi conduce, dove c'e' un video della sala: e' nella registrazione, con
   *  nome e immagine. Nessuna casella: solo l'avviso, con la destinazione. */
  conduce?: { destinazione: Destinazione };
  /** `destinazione` e `partecipanti` scelgono il testo a cui si acconsente;
   *  `testoEvento` e' quello scelto dall'ente, che vale per lo stesso consenso. */
  registrazione?: {
    dato: boolean;
    ritiro: EffettoRitiroRegistrazione;
    destinazione: Destinazione;
    partecipanti: PartecipantiNelVideo;
    testoEvento?: string | null;
  };
  /** `serveRegistrazione`: si puo' dare solo dopo il consenso alla registrazione.
   *  `testo` e `partecipanti` scelgono il testo della casella e la nota che
   *  l'accompagna. */
  trascrizione?: {
    dato: boolean;
    serveRegistrazione: boolean;
    testo: ReturnType<typeof chiaveConsensoTrascrizione>;
    partecipanti: PartecipantiNelVideo;
  };
}

type Azione = 'ritiraRegistrazione' | 'ritiraTrascrizione';

/** Dove il consenso non cambia cio' che si fa in sala, la riga e' la stessa. */
const senzaConsenso = (ritiro: EffettoRitiroRegistrazione) =>
  ritiro === 'avvertenza' || ritiro === 'assente' ? 'comeTutti' : ritiro;

export default function ConsentsDialog({
  aperta,
  onChiudi,
  consensi,
  onAcconsentiRegistrazione,
  onAcconsentiTrascrizione,
  onRitira,
  inCorso,
  errore,
  testoCambiato = false,
  container,
}: {
  aperta: boolean;
  onChiudi: () => void;
  consensi: ConsensiInSala;
  onAcconsentiRegistrazione: () => void;
  onAcconsentiTrascrizione: () => void;
  /** `registrazione`: ritira anche il consenso alla registrazione. */
  onRitira: (registrazione: boolean) => void;
  inCorso: boolean;
  errore: boolean;
  /** Il consenso e' arrivato su un testo non piu' in vigore: va riletto. */
  testoCambiato?: boolean;
  container?: HTMLElement | null;
}) {
  const t = useTranslations('live.consents');
  const tc = useTranslations('common');
  const tGdpr = useTranslations('gdpr.consent');
  const [conferma, setConferma] = useState<Azione | null>(null);
  const chiudi = () => {
    setConferma(null);
    onChiudi();
  };
  const { registrazione, trascrizione, conduce } = consensi;
  const testoEvento = registrazione
    ? testoConsensoEvento(registrazione.testoEvento, registrazione.partecipanti)
    : null;
  // La trascrizione si nomina dove la finestra la mostra: l'evento la chiede, o
  // la persona l'ha data. Il ritiro la comprende solo se c'e' un consenso da
  // ritirare; per chi conduce la riga dice che cosa succede alle sue tracce.
  const effettoRegistrazione = (r: NonNullable<ConsensiInSala['registrazione']>) => {
    // Dove chi partecipa puo' comparire nel video, chi non ha acconsentito sa che
    // il suo nome puo' finirci anche senza intervenire. Chi conduce c'e' comunque.
    const nomiVisibili = !r.dato && r.partecipanti === 'visibili' && r.ritiro !== 'conduce';
    const effetto = r.dato
      ? t(`recording.withdraw.${r.ritiro}`)
      : nomiVisibili
        ? `${t(`recording.without.${senzaConsenso(r.ritiro)}`)} ${tGdpr('namesMayAppear')}`
        : t(`recording.without.${senzaConsenso(r.ritiro)}`);
    if (!trascrizione) return effetto;
    if (r.ritiro === 'conduce') {
      return `${effetto} ${t(r.dato ? 'recording.withdrawTranscriptHost' : 'recording.withoutTranscriptHost')}`;
    }
    return r.dato && trascrizione.dato ? `${effetto} ${t('recording.withdrawTranscript')}` : effetto;
  };
  // Dopo un'azione il pulsante premuto sparisce (o si ferma): il focus va al
  // titolo del consenso, dentro la finestra, cosi' Esc e Tab continuano a
  // valere e il lettore di schermo resta al suo posto.
  const restaQui = (id: string) =>
    requestAnimationFrame(() => document.getElementById(`${id}-titolo`)?.focus());

  const blocco = (
    id: string,
    titolo: string,
    dato: boolean,
    effetto: string,
    nota: string | null,
    azione: React.ReactNode
  ) => (
    <section className="live-consents__voce" aria-labelledby={`${id}-titolo`}>
      <h3 id={`${id}-titolo`} className="h6 mb-1" tabIndex={-1}>
        {titolo}
      </h3>
      <p className="mb-1 small">
        <strong>{dato ? t('given') : t('notGiven')}</strong>
      </p>
      <p id={`${id}-effetto`} className="mb-2 small text-secondary">
        {effetto}
      </p>
      {nota && (
        <p id={`${id}-nota`} className="mb-2 small text-secondary">
          {nota}
        </p>
      )}
      {azione}
    </section>
  );

  const confermaRitiro = (id: string, azione: Azione, etichetta: string) =>
    conferma === azione ? (
      <div
        className="d-flex flex-wrap align-items-center gap-2"
        role="group"
        aria-label={t('confirmTitle')}
      >
        <span className="small fw-semibold">{t('confirmTitle')}</span>
        <Button
          color="danger"
          size="sm"
          disabled={inCorso}
          onClick={() => {
            setConferma(null);
            onRitira(azione === 'ritiraRegistrazione');
            restaQui(id);
          }}
        >
          {t('confirm')}
        </Button>
        <Button
          color="secondary"
          outline
          size="sm"
          disabled={inCorso}
          onClick={() => {
            setConferma(null);
            restaQui(id);
          }}
        >
          {tc('cancel')}
        </Button>
      </div>
    ) : (
      <Button
        color="danger"
        outline
        size="sm"
        disabled={inCorso}
        onClick={() => setConferma(azione)}
      >
        {etichetta}
      </Button>
    );

  return (
    <Modal
      isOpen={aperta}
      toggle={chiudi}
      centered
      container={container ?? undefined}
      labelledBy="live-consents-title"
    >
      <ModalHeader id="live-consents-title" closeAriaLabel={tc('close')} toggle={chiudi}>
        {t('title')}
      </ModalHeader>
      <ModalBody>
        <p className="small mb-3">{t('intro')}</p>
        <div className="d-flex flex-column gap-3">
          {conduce && (
            <section className="live-consents__voce" aria-labelledby="live-consents-host-titolo">
              <h3 id="live-consents-host-titolo" className="h6 mb-1" tabIndex={-1}>
                {t('recording.title')}
              </h3>
              <p className="mb-0 small text-secondary">
                {tGdpr(chiaveAvvisoConduce(conduce.destinazione))}
              </p>
            </section>
          )}
          {registrazione &&
            blocco(
              'live-consents-rec',
              t('recording.title'),
              registrazione.dato,
              effettoRegistrazione(registrazione),
              !registrazione.dato
                ? [testoEvento, tGdpr(chiaveConsenso(registrazione.destinazione, registrazione.partecipanti))]
                    .filter(Boolean)
                    .join(' ')
                : registrazione.ritiro !== 'conduce' && registrazione.ritiro !== 'assente'
                  ? t('recording.alreadyRecorded')
                  : null,
              registrazione.dato ? (
                confermaRitiro('live-consents-rec', 'ritiraRegistrazione', t('withdraw'))
              ) : (
                <Button
                  color="primary"
                  size="sm"
                  disabled={inCorso}
                  onClick={() => {
                    onAcconsentiRegistrazione();
                    restaQui('live-consents-rec');
                  }}
                  aria-describedby="live-consents-rec-nota"
                >
                  {t('recording.give')}
                </Button>
              )
            )}
          {trascrizione &&
            blocco(
              'live-consents-tr',
              t('transcription.title'),
              trascrizione.dato,
              trascrizione.dato
                ? t('transcription.withdrawEffect')
                : trascrizione.serveRegistrazione
                  ? t('transcription.needsRecording')
                  : t('transcription.giveEffect'),
              trascrizione.dato
                ? null
                : [
                    tGdpr(trascrizione.testo),
                    tGdpr(
                      trascrizione.partecipanti === 'visibili'
                        ? 'multitrackOptional'
                        : 'multitrackOptionalShort'
                    ),
                  ].join(' '),
              trascrizione.dato ? (
                confermaRitiro('live-consents-tr', 'ritiraTrascrizione', t('withdraw'))
              ) : (
                <Button
                  color="primary"
                  size="sm"
                  disabled={inCorso || trascrizione.serveRegistrazione}
                  onClick={() => {
                    onAcconsentiTrascrizione();
                    restaQui('live-consents-tr');
                  }}
                  aria-describedby="live-consents-tr-effetto live-consents-tr-nota"
                >
                  {t('transcription.give')}
                </Button>
              )
            )}
        </div>
        <p className="small mb-0 mt-3" role="status">
          {inCorso ? t('working') : ''}
        </p>
        {errore && (
          <p className="small mb-0 text-danger" role="alert">
            {t('error')}
          </p>
        )}
        {testoCambiato && (
          <p className="small mb-0 text-danger" role="alert">
            {t('textChanged')}
          </p>
        )}
      </ModalBody>
      <ModalFooter>
        <Button color="secondary" outline onClick={chiudi}>
          {tc('close')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

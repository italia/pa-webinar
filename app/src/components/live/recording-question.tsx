// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from 'design-react-kit';

import { testoConsensoEvento, type PartecipantiNelVideo } from '@/lib/live/consent-rule';
import { chiaveConsenso, type Destinazione } from '@/lib/recording/destination';

/**
 * La domanda a chi e' fuori dalla registrazione di una chiamata rapida, quando
 * qualcuno la avvia (lib/live/recording-question): vuoi comparire? Il si' e' un
 * consenso: sopra i pulsanti c'e' il testo della casella, e la sala si ricollega
 * con un token nuovo, che porta la prova. Il no, la chiusura con Esc o con la
 * crocetta, lasciano la persona fuori per questa registrazione. I due pulsanti
 * hanno lo stesso peso: il consenso e' libero.
 *
 * Resta aperta mentre la sala si ricollega, e dice se non e' riuscita: chi ha
 * risposto si' non deve credersi nel video se non lo e'.
 */
export default function RecordingQuestion({
  aperta,
  destinazione,
  partecipanti,
  testoConsenso,
  onSi,
  onNo,
  inCorso,
  errore,
  testoCambiato,
  container,
}: {
  aperta: boolean;
  /** La destinazione in vigore: il testo a cui si acconsente. */
  destinazione: Destinazione;
  /** Come compaiono nel video i partecipanti (lib/recording/availability). */
  partecipanti: PartecipantiNelVideo;
  /** Il testo dell'ente sulla registrazione, se c'e'. */
  testoConsenso?: string | null;
  onSi: () => void;
  /** No, o nessuna risposta: la domanda si chiude per questa registrazione. */
  onNo: () => void;
  /** La sala si sta ricollegando con il consenso. */
  inCorso: boolean;
  /** Il consenso non ha riportato la persona nella registrazione. */
  errore: boolean;
  /** Il testo del consenso e' cambiato: va riletto. */
  testoCambiato: boolean;
  container?: HTMLElement | null;
}) {
  const t = useTranslations('live.recordingQuestion');
  const tl = useTranslations('live.listenOnly');
  const tc = useTranslations('common');
  const tConsensi = useTranslations('live.consents');
  const tGdpr = useTranslations('gdpr.consent');
  const idTesto = useId();
  // Errori e testi cambiati dicono l'esito di un si' dato qui, non di un
  // tentativo fatto altrove prima che la domanda si aprisse.
  const [risposto, setRisposto] = useState(false);
  useEffect(() => {
    if (!aperta) setRisposto(false);
  }, [aperta]);
  const testoEvento = testoConsensoEvento(testoConsenso, partecipanti);
  const chiudi = () => {
    if (!inCorso) onNo();
  };

  return (
    <Modal
      isOpen={aperta}
      toggle={chiudi}
      centered
      // Un clic fuori per sbaglio non e' una risposta: Esc e la crocetta si'.
      backdrop="static"
      container={container ?? undefined}
      labelledBy="live-recording-question-title"
    >
      <ModalHeader
        id="live-recording-question-title"
        closeAriaLabel={tc('close')}
        toggle={chiudi}
      >
        {t('title')}
      </ModalHeader>
      <ModalBody>
        <p className="mb-2">{t('question')}</p>
        <p className="small mb-2">{t('body')}</p>
        <p id={idTesto} className="small mb-2 text-secondary">
          {[testoEvento, tGdpr(chiaveConsenso(destinazione, partecipanti))]
            .filter(Boolean)
            .join(' ')}
        </p>
        <p className="small mb-0">{t('later', { button: tConsensi('button') })}</p>
        <p className="small mb-0 mt-2" role="status">
          {inCorso ? tl('joining') : ''}
        </p>
        {risposto && errore && (
          <p className="small mb-0 text-danger" role="alert">
            {tl('error')}
          </p>
        )}
        {risposto && testoCambiato && (
          <p className="small mb-0 text-danger" role="alert">
            {tConsensi('textChanged')}
          </p>
        )}
      </ModalBody>
      <ModalFooter>
        <Button color="primary" outline onClick={chiudi} disabled={inCorso}>
          {t('no')}
        </Button>
        <Button
          color="primary"
          outline
          onClick={() => {
            setRisposto(true);
            onSi();
          }}
          disabled={inCorso}
          aria-describedby={idTesto}
        >
          {t('yes')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

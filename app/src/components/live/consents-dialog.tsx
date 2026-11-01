'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from 'design-react-kit';

/**
 * I consensi della persona per questo evento, dalla sala: si danno e si
 * ritirano qui, in qualunque momento (art. 7.3 GDPR: ritirarli e' facile come
 * darli). Ogni cambio porta un token nuovo e la conferenza si ricollega per
 * qualche secondo; il ritiro del consenso alla registrazione, dove senza non
 * si puo' restare, riporta in sala d'attesa.
 *
 * La finestra mostra solo i consensi che l'evento chiede a questa persona;
 * cosa cambia lo dice la riga sotto ciascuno, prima di agire. Il ritiro
 * chiede una conferma: ricollega la conferenza (o la chiude), e un clic per
 * sbaglio non deve farlo.
 */

/** Cosa succede ritirando il consenso alla registrazione. */
export type EffettoRitiroRegistrazione = 'soloAscolto' | 'uscita' | 'conduce';

export interface ConsensiInSala {
  registrazione?: { dato: boolean; ritiro: EffettoRitiroRegistrazione };
  /** `serveRegistrazione`: si puo' dare solo dopo il consenso alla registrazione. */
  trascrizione?: { dato: boolean; serveRegistrazione: boolean };
}

type Azione = 'ritiraRegistrazione' | 'ritiraTrascrizione';

export default function ConsentsDialog({
  aperta,
  onChiudi,
  consensi,
  onAcconsentiRegistrazione,
  onAcconsentiTrascrizione,
  onRitira,
  inCorso,
  errore,
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
  container?: HTMLElement | null;
}) {
  const t = useTranslations('live.consents');
  const tc = useTranslations('common');
  const [conferma, setConferma] = useState<Azione | null>(null);
  const chiudi = () => {
    setConferma(null);
    onChiudi();
  };
  const { registrazione, trascrizione } = consensi;
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
      {nota && <p className="mb-2 small text-secondary">{nota}</p>}
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
          {registrazione &&
            blocco(
              'live-consents-rec',
              t('recording.title'),
              registrazione.dato,
              registrazione.dato
                ? t(`recording.withdraw.${registrazione.ritiro}`)
                : t(`recording.without.${registrazione.ritiro}`),
              registrazione.dato && registrazione.ritiro !== 'conduce'
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
              null,
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
                  aria-describedby="live-consents-tr-effetto"
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
      </ModalBody>
      <ModalFooter>
        <Button color="secondary" outline onClick={chiudi}>
          {tc('close')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

'use client';

/**
 * La valutazione di fine evento: il questionario POST_EVENT dell'evento (il
 * «Feedback generico» predefinito, o quello scelto da chi organizza), che il
 * server collega da solo agli eventi che non l'hanno ancora
 * (lib/feedback/default-questionnaire). Le risposte arrivano a chi organizza
 * senza il nome di chi risponde.
 *
 * Due forme:
 *   - `inline`: dentro la scheda di chiusura della sala (fine evento, o uscita
 *     a evento ancora in corso), senza coprire nulla;
 *   - `dialog`: una finestra, aperta dalla sala d'attesa di un evento concluso.
 *
 * Senza questionario (raccolta spenta dall'organizzazione) non mostra niente,
 * e la finestra si chiude da sola.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import QuestionnaireForm from '@/components/questionnaires/questionnaire-form';

interface PostEventFeedbackProps {
  eventSlug: string;
  /** Token di registrazione: una risposta per iscrizione. */
  accessToken?: string;
  /** Identificativo stabile del browser, per chi non ha un'iscrizione. */
  guestId?: string;
  mode: 'inline' | 'dialog';
  onClose?: () => void;
}

type Stato = 'loading' | 'absent' | 'form' | 'done' | 'already';

export default function PostEventFeedback({
  eventSlug,
  accessToken,
  guestId,
  mode,
  onClose,
}: PostEventFeedbackProps) {
  const t = useTranslations('feedback');
  const tc = useTranslations('common');
  const [stato, setStato] = useState<Stato>('loading');
  const titoloId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Il ringraziamento in una regione che esiste gia' prima del testo: i
  // lettori di schermo annunciano solo cio' che cambia dentro una regione nota.
  const [annuncio, setAnnuncio] = useState('');

  useEffect(() => {
    let annullato = false;
    fetch(`/api/events/${encodeURIComponent(eventSlug)}/questionnaires/POST_EVENT`, { cache: 'no-store' })
      .then((res) => {
        if (!annullato) setStato(res.ok ? 'form' : 'absent');
      })
      .catch(() => {
        if (!annullato) setStato('absent');
      });
    return () => {
      annullato = true;
    };
  }, [eventSlug]);

  // Nessuna valutazione da raccogliere: la finestra non resta vuota.
  useEffect(() => {
    if (stato === 'absent' && mode === 'dialog') onClose?.();
  }, [stato, mode, onClose]);

  // Finestra modale vera (<dialog>): il fuoco resta dentro, lo sfondo non si
  // usa, Esc chiude; alla chiusura il fuoco torna a chi l'aveva aperta.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (mode !== 'dialog') return;
    const d = dialogRef.current;
    if (!d) return;
    const prima = document.activeElement as HTMLElement | null;
    if (!d.open && typeof d.showModal === 'function') d.showModal();
    const onCancel = (e: Event) => {
      e.preventDefault();
      onCloseRef.current?.();
    };
    d.addEventListener('cancel', onCancel);
    return () => {
      d.removeEventListener('cancel', onCancel);
      if (d.open && typeof d.close === 'function') d.close();
      prima?.focus?.();
    };
  }, [mode]);

  const inviata = useCallback(() => {
    setStato('done');
    setAnnuncio(`${t('thankYou')} ${t('thankYouDetail')}`);
  }, [t]);
  const giaInviata = useCallback(() => {
    setStato('already');
    setAnnuncio(t('alreadyDone'));
  }, [t]);

  if (stato === 'absent') return null;

  const regione = (
    <div className="visually-hidden" role="status" aria-live="polite">
      {annuncio}
    </div>
  );
  const corpo =
    stato === 'done' || stato === 'already' ? (
      <div className="event-feedback__done">
        <CheckIcon />
        <p className="event-feedback__done-title">{stato === 'done' ? t('thankYou') : t('alreadyDone')}</p>
        {stato === 'done' && <p className="event-feedback__done-text">{t('thankYouDetail')}</p>}
      </div>
    ) : (
      <>
        <h2 className="event-feedback__title" id={titoloId}>
          {t('heading')}
        </h2>
        <p className="event-feedback__intro">{t('intro')}</p>
        {stato === 'loading' ? (
          <p className="event-feedback__loading">{tc('loading')}</p>
        ) : (
          <QuestionnaireForm
            eventSlug={eventSlug}
            placement="POST_EVENT"
            accessToken={accessToken}
            guestId={guestId}
            variant="feedback"
            hideHeader
            submitLabel={t('submit')}
            submittingLabel={t('submitting')}
            onSubmitted={inviata}
            onAlreadySubmitted={giaInviata}
          />
        )}
      </>
    );

  if (mode === 'inline') {
    return (
      <section className="event-feedback" aria-labelledby={stato === 'form' || stato === 'loading' ? titoloId : undefined}>
        {regione}
        {corpo}
      </section>
    );
  }

  return (
    <dialog
      ref={dialogRef}
      className="event-feedback event-feedback--dialog"
      aria-labelledby={stato === 'form' || stato === 'loading' ? titoloId : undefined}
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
    >
      {regione}
      <div className="event-feedback__dialog-body">
        <button
          type="button"
          className="event-feedback__close"
          aria-label={tc('close')}
          onClick={() => onClose?.()}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        {corpo}
        {(stato === 'form' || stato === 'loading') && (
          <div className="event-feedback__skip">
            <button type="button" className="btn btn-link" onClick={() => onClose?.()}>
              {t('skip')}
            </button>
          </div>
        )}
      </div>
    </dialog>
  );
}

function CheckIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#008758" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12.5l2.5 2.5L16 9" />
    </svg>
  );
}

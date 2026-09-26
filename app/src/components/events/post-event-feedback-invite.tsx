'use client';

/**
 * Invito a lasciare il feedback POST_EVENT sulla pagina pubblica dell'evento
 * concluso, per chi non ha risposto all'uscita dalla sala. La pagina lo rende
 * solo se l'evento ha un questionario POST_EVENT (lo verifica il server);
 * `onNotFound` resta come rete per un questionario tolto dopo il rendering
 * della pagina: l'invito sparisce invece di mostrare un modulo vuoto.
 *
 * Deduplica: questa superficie pubblica non ha in mano il token
 * d'iscrizione, quindi risponde come ospite (chiave: l'id ospite stabile in
 * localStorage). Chi non si è mai iscritto viene deduplicato contro la
 * propria risposta precedente da ospite. Chi si è iscritto e ha già risposto
 * all'uscita (chiave: registrationId) NON viene deduplicato fra le due
 * superfici e potrebbe rispondere di nuovo qui come ospite: limite accettato
 * finché la pagina pubblica non porta un token.
 */

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardBody } from 'design-react-kit';

import QuestionnaireForm from '@/components/questionnaires/questionnaire-form';

function readGuestId(): string {
  const fresh = () => `guest_${Math.random().toString(36).slice(2, 10)}`;
  if (typeof window === 'undefined') return fresh();
  try {
    const k = 'paw_guest_id';
    let v = window.localStorage.getItem(k);
    if (!v) {
      v = fresh();
      window.localStorage.setItem(k, v);
    }
    return v;
  } catch {
    return fresh();
  }
}

export default function PostEventFeedbackInvite({
  eventSlug,
  accessToken,
}: {
  eventSlug: string;
  accessToken?: string;
}) {
  const t = useTranslations('feedback');
  const [available, setAvailable] = useState(true);
  const [guestId] = useState(readGuestId);
  const handleNotFound = useCallback(() => setAvailable(false), []);

  if (!available) return null;

  return (
    <Card className="shadow-sm border-0 mt-4" style={{ borderRadius: '0.5rem' }}>
      <CardBody className="p-3">
        <h3 className="h6 fw-semibold mb-3" style={{ color: 'var(--app-text)' }}>
          {t('title')}
        </h3>
        <QuestionnaireForm
          eventSlug={eventSlug}
          placement="POST_EVENT"
          accessToken={accessToken}
          guestId={accessToken ? undefined : guestId}
          variant="feedback"
          hideHeader
          submitLabel={t('submit')}
          submittingLabel={t('submitting')}
          submittedMessage={t('thankYou')}
          onNotFound={handleNotFound}
        />
      </CardBody>
    </Card>
  );
}

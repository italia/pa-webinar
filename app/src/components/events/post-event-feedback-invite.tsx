'use client';

/**
 * Invito a lasciare il feedback POST_EVENT sulla pagina pubblica dell'evento
 * concluso, per chi non ha risposto all'uscita dalla sala. La pagina lo rende
 * solo se l'evento ha un questionario POST_EVENT e solo a chi il server ha
 * riconosciuto come partecipante (lib/feedback/participation): con il link
 * personale (`accessToken`, dal cookie d'accesso del browser con cui si e'
 * iscritto) o con il link della valutazione dell'email di ringraziamento
 * (`ratingToken`). In entrambi i casi risponde l'iscrizione, una volta.
 * `onNotFound` resta come rete per un questionario tolto dopo il rendering
 * della pagina: l'invito sparisce invece di mostrare un modulo vuoto.
 */

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardBody } from 'design-react-kit';

import QuestionnaireForm from '@/components/questionnaires/questionnaire-form';

export default function PostEventFeedbackInvite({
  eventSlug,
  accessToken,
  ratingToken,
}: {
  eventSlug: string;
  accessToken?: string;
  ratingToken?: string;
}) {
  const t = useTranslations('feedback');
  const [available, setAvailable] = useState(true);
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
          ratingToken={ratingToken}
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

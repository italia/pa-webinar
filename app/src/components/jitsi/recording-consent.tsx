'use client';

import { useTranslations } from 'next-intl';
import { Button, Alert, Icon } from 'design-react-kit';

interface RecordingConsentProps {
  onAccept: () => void;
  onDecline: () => void;
  customConsentText?: string | null;
}

export default function RecordingConsent({
  onAccept,
  onDecline,
  customConsentText,
}: RecordingConsentProps) {
  const t = useTranslations('live');

  return (
    <div
      className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
      style={{ zIndex: 1050, backgroundColor: 'rgba(0, 0, 0, 0.7)' }}
    >
      <div
        className="bg-white rounded shadow-lg p-5 text-center"
        style={{ maxWidth: '520px', width: '90%' }}
      >
        <Icon
          icon="it-warning-circle"
          size="xl"
          className="text-warning mb-3"
        />
        <h2 className="h4 mb-3">{t('recordingConsentTitle')}</h2>
        <p className="mb-4" style={{ whiteSpace: 'pre-wrap' }}>
          {customConsentText || t('recordingConsent')}
        </p>

        <div className="d-flex justify-content-center gap-3">
          <Button color="primary" onClick={onAccept}>
            <Icon icon="it-video" size="sm" className="me-2" />
            {t('enterRoom')}
          </Button>
          <Button color="secondary" outline onClick={onDecline}>
            {t('declineRecording')}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface RecordingBannerProps {
  visible: boolean;
}

export function RecordingBanner({ visible }: RecordingBannerProps) {
  const t = useTranslations('live');

  if (!visible) return null;

  return (
    <Alert color="warning" className="mb-0 rounded-0 text-center py-2">
      <strong>{t('recordingActive')}</strong>
    </Alert>
  );
}

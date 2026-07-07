'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Card,
  CardBody,
  FormGroup,
  Input,
} from 'design-react-kit';

import ToggleSwitch from '@/components/ui/toggle-switch';

interface PostEventConfigProps {
  event: {
    id: string;
    moderatorToken: string;
    postEventPublic: boolean;
    postEventPublicUntil: string | null;
    libraryListed: boolean;
    hasPlayableRecording: boolean;
    postEventShowQA: boolean;
    postEventShowMaterials: boolean;
    postEventShowPolls: boolean;
    postEventShowFeedback: boolean;
    postEventShowRecap: boolean;
    postEventEmailEnabled: boolean;
    feedbackEnabled: boolean;
    dataRetentionDays: number;
  };
}

export default function PostEventConfig({ event }: PostEventConfigProps) {
  const t = useTranslations('postEvent');

  const [pageVisible, setPageVisible] = useState(event.postEventPublic);
  const [libraryListed, setLibraryListed] = useState(event.libraryListed);
  const [showQA, setShowQA] = useState(event.postEventShowQA);
  const [showMaterials, setShowMaterials] = useState(event.postEventShowMaterials);
  const [showPolls, setShowPolls] = useState(event.postEventShowPolls);
  const [showFeedback, setShowFeedback] = useState(event.postEventShowFeedback);
  const [showRecap, setShowRecap] = useState(event.postEventShowRecap);
  const [emailEnabled, setEmailEnabled] = useState(event.postEventEmailEnabled);
  const [feedbackActive, setFeedbackActive] = useState(event.feedbackEnabled);
  const [visibilityMode, setVisibilityMode] = useState<'always' | 'until'>(
    event.postEventPublicUntil ? 'until' : 'always',
  );
  const [visibleUntil, setVisibleUntil] = useState(
    event.postEventPublicUntil
      ? event.postEventPublicUntil.slice(0, 10)
      : '',
  );

  const save = useCallback(
    async (data: Record<string, unknown>) => {
      await fetch(`/api/events/${event.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${event.moderatorToken}`,
        },
        body: JSON.stringify(data),
      });
    },
    [event.id, event.moderatorToken],
  );

  const handleToggle = useCallback(
    (field: string, value: boolean, setter: (v: boolean) => void) => {
      setter(value);
      save({ [field]: value });
    },
    [save],
  );

  const handleVisibilityChange = useCallback(
    (mode: 'always' | 'until') => {
      setVisibilityMode(mode);
      if (mode === 'always') {
        setVisibleUntil('');
        save({ postEventPublicUntil: null });
      }
    },
    [save],
  );

  const handleDateChange = useCallback(
    (dateStr: string) => {
      setVisibleUntil(dateStr);
      if (dateStr) {
        save({ postEventPublicUntil: new Date(dateStr + 'T23:59:59Z').toISOString() });
      }
    },
    [save],
  );

  return (
    <Card className="shadow-sm border-0 mb-4" style={{ borderRadius: 8, border: '1px solid #e8e8e8' }}>
      <CardBody className="p-4">
        <h5 className="fw-semibold mb-3" style={{ color: 'var(--app-text)' }}>
          {t('config')}
        </h5>

        <div className="d-flex flex-column gap-3">
          <div>
            <div className="d-flex justify-content-between align-items-center">
              <span style={{ fontSize: '0.9rem' }}>{t('pageVisible')}</span>
              <ToggleSwitch
                label=""
                ariaLabel={t('pageVisible')}
                checked={pageVisible}
                onChange={() => handleToggle('postEventPublic', !pageVisible, setPageVisible)}
              />
            </div>
            <small className="text-muted" style={{ fontSize: '0.78rem' }}>
              {t('pageVisibleHelp')}
            </small>
          </div>

          <div>
            <div className="d-flex justify-content-between align-items-center">
              <span style={{ fontSize: '0.9rem' }}>{t('libraryListed')}</span>
              <ToggleSwitch
                label=""
                ariaLabel={t('libraryListed')}
                checked={libraryListed}
                onChange={() =>
                  handleToggle('libraryListed', !libraryListed, setLibraryListed)
                }
              />
            </div>
            <small className="text-muted" style={{ fontSize: '0.78rem' }}>
              {t('libraryListedHelp')}
              {libraryListed && !event.hasPlayableRecording && (
                <span className="d-block text-warning mt-1">
                  {t('libraryListedNoRecording')}
                </span>
              )}
            </small>
          </div>

          <div className="d-flex justify-content-between align-items-center">
            <span style={{ fontSize: '0.9rem' }}>{t('showQA')}</span>
            <ToggleSwitch
              label=""
              checked={showQA}
              onChange={() => handleToggle('postEventShowQA', !showQA, setShowQA)}
            />
          </div>

          <div className="d-flex justify-content-between align-items-center">
            <span style={{ fontSize: '0.9rem' }}>{t('showMaterials')}</span>
            <ToggleSwitch
              label=""
              checked={showMaterials}
              onChange={() => handleToggle('postEventShowMaterials', !showMaterials, setShowMaterials)}
            />
          </div>

          <div className="d-flex justify-content-between align-items-center">
            <span style={{ fontSize: '0.9rem' }}>{t('showPolls')}</span>
            <ToggleSwitch
              label=""
              checked={showPolls}
              onChange={() => handleToggle('postEventShowPolls', !showPolls, setShowPolls)}
            />
          </div>

          <div className="d-flex justify-content-between align-items-center">
            <span style={{ fontSize: '0.9rem' }}>{t('showFeedback')}</span>
            <ToggleSwitch
              label=""
              ariaLabel={t('showFeedback')}
              checked={showFeedback}
              onChange={() => handleToggle('postEventShowFeedback', !showFeedback, setShowFeedback)}
            />
          </div>

          <div className="d-flex justify-content-between align-items-center">
            <span style={{ fontSize: '0.9rem' }}>{t('showRecap')}</span>
            <ToggleSwitch
              label=""
              ariaLabel={t('showRecap')}
              checked={showRecap}
              onChange={() => handleToggle('postEventShowRecap', !showRecap, setShowRecap)}
            />
          </div>

          <div>
            <div className="d-flex justify-content-between align-items-center">
              <span style={{ fontSize: '0.9rem' }}>{t('emailEnabled')}</span>
              <ToggleSwitch
                label=""
                ariaLabel={t('emailEnabled')}
                checked={emailEnabled}
                onChange={() =>
                  handleToggle('postEventEmailEnabled', !emailEnabled, setEmailEnabled)
                }
              />
            </div>
            <small className="text-muted" style={{ fontSize: '0.78rem' }}>
              {t('emailEnabledHelp')}
            </small>
          </div>

          <div className="d-flex justify-content-between align-items-center">
            <span style={{ fontSize: '0.9rem' }}>{t('feedbackEnabled')}</span>
            <ToggleSwitch
              label=""
              checked={feedbackActive}
              onChange={() => handleToggle('feedbackEnabled', !feedbackActive, setFeedbackActive)}
            />
          </div>
        </div>

        <hr className="my-3" />

        <div className="mb-3">
          <div className="fw-semibold mb-2" style={{ fontSize: '0.9rem', color: 'var(--app-text)' }}>
            {t('pageVisible')}
          </div>
          <div className="d-flex flex-column gap-1">
            <label className="d-flex align-items-center gap-2" style={{ cursor: 'pointer' }}>
              <input
                type="radio"
                name="visibility"
                checked={visibilityMode === 'always'}
                onChange={() => handleVisibilityChange('always')}
              />
              <span style={{ fontSize: '0.88rem' }}>{t('visibilityAlways')}</span>
            </label>
            <label className="d-flex align-items-center gap-2" style={{ cursor: 'pointer' }}>
              <input
                type="radio"
                name="visibility"
                checked={visibilityMode === 'until'}
                onChange={() => handleVisibilityChange('until')}
              />
              <span style={{ fontSize: '0.88rem' }}>{t('visibilityUntil')}</span>
            </label>
            {visibilityMode === 'until' && (
              <FormGroup className="mb-0 ms-4 mt-1" style={{ maxWidth: 220 }}>
                <Input
                  type="date"
                  value={visibleUntil}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleDateChange(e.target.value)}
                />
              </FormGroup>
            )}
          </div>
        </div>

        <Alert color="info" className="mb-0" style={{ fontSize: '0.82rem' }}>
          {t('dataRetentionNote', { days: event.dataRetentionDays })}
        </Alert>
      </CardBody>
    </Card>
  );
}

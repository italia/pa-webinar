'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Card,
  CardBody,
  Icon,
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
    postEventShowQA: boolean;
    postEventShowMaterials: boolean;
    postEventShowPolls: boolean;
    postEventShowFeedback: boolean;
    feedbackEnabled: boolean;
    dataRetentionDays: number;
  };
}

export default function PostEventConfig({ event }: PostEventConfigProps) {
  const t = useTranslations('postEvent');

  const [pageVisible, setPageVisible] = useState(event.postEventPublic);
  const [showQA, setShowQA] = useState(event.postEventShowQA);
  const [showMaterials, setShowMaterials] = useState(event.postEventShowMaterials);
  const [showPolls, setShowPolls] = useState(event.postEventShowPolls);
  const [showFeedback, setShowFeedback] = useState(event.postEventShowFeedback);
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
        <h5 className="fw-semibold mb-3" style={{ color: '#17324D' }}>
          {t('config')}
        </h5>

        <div className="d-flex flex-column gap-3">
          <div className="d-flex justify-content-between align-items-center">
            <span style={{ fontSize: '0.9rem' }}>{t('pageVisible')}</span>
            <ToggleSwitch
              label=""
              checked={pageVisible}
              onChange={() => handleToggle('postEventPublic', !pageVisible, setPageVisible)}
            />
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
              checked={showFeedback}
              onChange={() => handleToggle('postEventShowFeedback', !showFeedback, setShowFeedback)}
            />
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
          <div className="fw-semibold mb-2" style={{ fontSize: '0.9rem', color: '#17324D' }}>
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

'use client';

import { useState, useCallback, useEffect, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  Button,
  Alert,
  Input,
  TextArea,
  FormGroup,
  Label,
  Card,
  CardBody,
  Col,
  Row,
} from 'design-react-kit';

import ToggleSwitch from '@/components/ui/toggle-switch';
import LocaleTabBar from '@/components/ui/locale-tab-bar';
import { MarkdownEditor } from '@/components/ui/markdown';
import JvbCapacityPreview from '@/components/admin/jvb-capacity-preview';
import { useRouter } from '@/i18n/navigation';
import { updateEventSchema } from '@/lib/validation/schemas';
import { toDatetimeLocalInTz, fromDatetimeLocalInTz } from '@/lib/utils/date-format';
import type { JvbSizingConfig } from '@/lib/jvb-sizing';

interface FieldErrors {
  [key: string]: string | undefined;
}

interface EventData {
  id: string;
  title: Record<string, string>;
  description: Record<string, string>;
  startsAt: string;
  endsAt: string;
  maxParticipants: number;
  qaEnabled: boolean;
  chatEnabled: boolean;
  recordingEnabled: boolean;
  participantsCanUnmute: boolean;
  participantsCanStartVideo: boolean;
  participantsCanShareScreen: boolean;
  dataRetentionDays: number;
  privacyPolicyUrl: string | null;
  gdprTemplateId?: string | null;
  moderatorName: string | null;
  moderatorEmail: string | null;
  moderatorToken: string;
  speakersInfo: Record<string, string> | null;
  organizerName: string | null;
  imageUrl: string | null;
  waitingRoomAudioUrl: string | null;
  expectedSenderRatioPct: number | null;
  gracePeriodMinutes: number | null;
}

interface EditEventFormProps {
  event: EventData;
  eventTimezone: string;
  enabledLocales?: string[];
  defaultLocale?: string;
  defaultSenderRatioPct: number;
  jvbSizingConfig: JvbSizingConfig;
}

const CARD_STYLE = {
  borderRadius: 8,
  border: '1px solid #e8e8e8',
};

export default function EditEventForm({
  event,
  eventTimezone,
  enabledLocales = ['it', 'en'],
  defaultLocale: defaultLoc = 'it',
  defaultSenderRatioPct,
  jvbSizingConfig,
}: EditEventFormProps) {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const router = useRouter();
  const [contentLocale, setContentLocale] = useState(defaultLoc);

  const [form, setForm] = useState({
    title: { it: event.title?.it ?? '', en: event.title?.en ?? '' },
    description: { it: event.description?.it ?? '', en: event.description?.en ?? '' },
    startsAt: toDatetimeLocalInTz(new Date(event.startsAt), eventTimezone),
    endsAt: toDatetimeLocalInTz(new Date(event.endsAt), eventTimezone),
    maxParticipants: event.maxParticipants,
    qaEnabled: event.qaEnabled,
    chatEnabled: event.chatEnabled,
    recordingEnabled: event.recordingEnabled,
    participantsCanUnmute: event.participantsCanUnmute,
    participantsCanStartVideo: event.participantsCanStartVideo,
    participantsCanShareScreen: event.participantsCanShareScreen,
    dataRetentionDays: event.dataRetentionDays,
    privacyPolicyUrl: event.privacyPolicyUrl ?? '',
    gdprTemplateId: event.gdprTemplateId ?? '',
    moderatorName: event.moderatorName ?? '',
    moderatorEmail: event.moderatorEmail ?? '',
    speakersInfo: { it: event.speakersInfo?.it ?? '', en: event.speakersInfo?.en ?? '' },
    organizerName: event.organizerName ?? '',
    imageUrl: event.imageUrl ?? '',
    waitingRoomAudioUrl: event.waitingRoomAudioUrl ?? '',
    expectedSenderRatioPct: event.expectedSenderRatioPct,
    gracePeriodMinutes: event.gracePeriodMinutes,
  });

  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState('');
  const [success, setSuccess] = useState('');

  const [gdprTemplates, setGdprTemplates] = useState<
    { id: string; name: string; isDefault: boolean }[]
  >([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/gdpr-templates', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((data) => { if (!cancelled) setGdprTemplates(data.rows ?? []); })
      .catch(() => { /* templates optional */ });
    return () => { cancelled = true; };
  }, []);

  const setField = useCallback(
    <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
      setErrors((prev) => ({ ...prev, [key]: undefined }));
    },
    [],
  );

  type LocalizedFormField = 'title' | 'description' | 'speakersInfo';
  const setLocalizedField = useCallback(
    (field: LocalizedFormField, locale: string, value: string) => {
      setForm((prev) => ({
        ...prev,
        [field]: { ...prev[field], [locale]: value },
      }));
      setErrors((prev) => ({ ...prev, [`${field}.${locale}`]: undefined, [field]: undefined }));
    },
    [],
  );

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setServerError('');
      setSuccess('');

      const titleObj: Record<string, string> = { it: form.title.it };
      if (form.title.en) titleObj.en = form.title.en;
      const descObj: Record<string, string> = { it: form.description.it };
      if (form.description.en) descObj.en = form.description.en;
      const speakersObj: Record<string, string> = {};
      if (form.speakersInfo.it) speakersObj.it = form.speakersInfo.it;
      if (form.speakersInfo.en) speakersObj.en = form.speakersInfo.en;

      const payload = {
        title: titleObj,
        description: descObj,
        startsAt: fromDatetimeLocalInTz(form.startsAt, eventTimezone).toISOString(),
        endsAt: fromDatetimeLocalInTz(form.endsAt, eventTimezone).toISOString(),
        maxParticipants: form.maxParticipants,
        qaEnabled: form.qaEnabled,
        chatEnabled: form.chatEnabled,
        recordingEnabled: form.recordingEnabled,
        participantsCanUnmute: form.participantsCanUnmute,
        participantsCanStartVideo: form.participantsCanStartVideo,
        participantsCanShareScreen: form.participantsCanShareScreen,
        dataRetentionDays: form.dataRetentionDays,
        privacyPolicyUrl: form.privacyPolicyUrl || undefined,
        gdprTemplateId: form.gdprTemplateId || null,
        moderatorName: form.moderatorName || undefined,
        moderatorEmail: form.moderatorEmail || undefined,
        speakersInfo: Object.keys(speakersObj).length > 0 ? speakersObj : undefined,
        organizerName: form.organizerName || undefined,
        imageUrl: form.imageUrl || undefined,
        expectedSenderRatioPct: form.expectedSenderRatioPct,
        gracePeriodMinutes: form.gracePeriodMinutes,
        waitingRoomAudioUrl: form.waitingRoomAudioUrl || undefined,
      };

      const result = updateEventSchema.safeParse(payload);
      if (!result.success) {
        const fieldErrors: FieldErrors = {};
        for (const issue of result.error.issues) {
          const key = issue.path.join('.');
          if (key && !fieldErrors[key]) {
            fieldErrors[key] = issue.message;
          }
        }
        setErrors(fieldErrors);
        return;
      }

      setSubmitting(true);
      try {
        const res = await fetch(`/api/events/${event.id}?token=${event.moderatorToken}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const data = await res.json();
          setServerError(data.error ?? tc('error'));
          return;
        }

        const data = await res.json();
        if (data.dateChanged) {
          setSuccess(`${t('eventUpdated')} ${t('dateChangedNotification')}`);
        } else {
          setSuccess(t('eventUpdated'));
        }

        setTimeout(() => {
          router.push(`/admin/events/${event.id}?token=${event.moderatorToken}`);
        }, 1500);
      } catch {
        setServerError(tc('error'));
      } finally {
        setSubmitting(false);
      }
    },
    [form, tc, t, router, event.id, event.moderatorToken],
  );

  const inputProps = (key: keyof typeof form, label: string) => ({
    id: key,
    label,
    validationText: errors[key],
    ...(errors[key] ? { valid: false, infoText: errors[key] } : {}),
  });

  const localizedInputProps = (field: string, locale: string, label: string) => {
    const errorKey = `${field}.${locale}`;
    return {
      id: errorKey,
      label,
      validationText: errors[errorKey],
      ...(errors[errorKey] ? { valid: false, infoText: errors[errorKey] } : {}),
    };
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      {serverError && (
        <Alert color="danger" className="mb-4">
          {serverError}
        </Alert>
      )}
      {success && (
        <Alert color="success" className="mb-4">
          {success}
        </Alert>
      )}

      <Card className="shadow-sm border-0 mb-4" style={CARD_STYLE}>
        <CardBody className="p-4">
          <h5 className="fw-semibold mb-3" style={{ color: '#17324D' }}>
            {t('form.sectionContent')}
          </h5>
          <LocaleTabBar
            enabledLocales={enabledLocales}
            defaultLocale={defaultLoc}
            activeLocale={contentLocale}
            onSelectLocale={setContentLocale}
            filledLocales={Object.keys(form.title).filter((l) => form.title[l as keyof typeof form.title])}
          />
          <FormGroup className="mb-3">
            <Input
              {...localizedInputProps('title', contentLocale, t('form.titleLabel'))}
              type="text"
              value={(form.title as Record<string, string>)[contentLocale] ?? ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setLocalizedField('title', contentLocale, e.target.value)
              }
              required={contentLocale === defaultLoc}
            />
          </FormGroup>
          <FormGroup className="mb-3">
            <MarkdownEditor
              id={`description.${contentLocale}`}
              label={t('form.descriptionLabel')}
              value={(form.description as Record<string, string>)[contentLocale] ?? ''}
              onChange={(v) => setLocalizedField('description', contentLocale, v)}
              rows={8}
              invalid={!!errors[`description.${contentLocale}`]}
              errorText={errors[`description.${contentLocale}`]}
            />
          </FormGroup>
        </CardBody>
      </Card>

      <Card className="shadow-sm border-0 mb-4" style={CARD_STYLE}>
        <CardBody className="p-4">
          <h5 className="fw-semibold mb-3" style={{ color: '#17324D' }}>
            {t('form.sectionSchedule')}
          </h5>
          <Row className="mb-3">
            <Col md={6}>
              <FormGroup className="mb-3">
                <Label htmlFor="startsAt">{t('form.startsAt')}</Label>
                <input
                  type="datetime-local"
                  id="startsAt"
                  className="form-control"
                  value={form.startsAt}
                  onChange={(e) => setField('startsAt', e.target.value)}
                  required
                />
                {errors.startsAt && (
                  <small className="text-danger">{errors.startsAt}</small>
                )}
              </FormGroup>
            </Col>
            <Col md={6}>
              <FormGroup className="mb-3">
                <Label htmlFor="endsAt">{t('form.endsAt')}</Label>
                <input
                  type="datetime-local"
                  id="endsAt"
                  className="form-control"
                  value={form.endsAt}
                  onChange={(e) => setField('endsAt', e.target.value)}
                  required
                />
                {errors.endsAt && (
                  <small className="text-danger">{errors.endsAt}</small>
                )}
              </FormGroup>
            </Col>
          </Row>
          <Row>
            <Col md={6}>
              <FormGroup className="mb-3">
                <Input
                  {...inputProps('maxParticipants', t('form.expectedParticipants'))}
                  type="number"
                  value={form.maxParticipants.toString()}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setField('maxParticipants', Number(e.target.value) || 0)
                  }
                  min={2}
                  max={10000}
                />
                <small className="text-muted">{t('form.expectedParticipantsHint')}</small>
              </FormGroup>
            </Col>
            <Col md={6}>
              <FormGroup className="mb-3">
                <Label htmlFor="expectedSenderRatioPct">
                  {t('form.expectedSenderRatio')}
                </Label>
                <div className="d-flex align-items-center gap-2">
                  <Input
                    id="expectedSenderRatioPct"
                    type="number"
                    value={form.expectedSenderRatioPct ?? ''}
                    placeholder={t('form.expectedSenderRatioInherit')}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      const v = e.target.value;
                      setField(
                        'expectedSenderRatioPct',
                        v === ''
                          ? null
                          : Math.max(0, Math.min(100, Number(v) || 0)),
                      );
                    }}
                    min={0}
                    max={100}
                  />
                  <span className="text-muted">%</span>
                </div>
                <small className="text-muted">{t('form.expectedSenderRatioHint')}</small>
              </FormGroup>
            </Col>
          </Row>
          <Row>
            <Col md={12}>
              <JvbCapacityPreview
                maxParticipants={form.maxParticipants}
                senderRatioPct={form.expectedSenderRatioPct}
                onSenderRatioChange={(next) =>
                  setField('expectedSenderRatioPct', next)
                }
                videoEnabled={form.participantsCanStartVideo}
                defaultSenderRatioPct={defaultSenderRatioPct}
                sizingConfig={jvbSizingConfig}
              />
            </Col>
          </Row>
          <Row>
            <Col md={6}>
              <FormGroup className="mb-3">
                <Label htmlFor="gracePeriodMinutes">{t('form.gracePeriod')}</Label>
                <select
                  id="gracePeriodMinutes"
                  className="form-control"
                  value={
                    form.gracePeriodMinutes === null
                      ? 'inherit'
                      : String(form.gracePeriodMinutes)
                  }
                  onChange={(e) => {
                    const v = e.target.value;
                    setField(
                      'gracePeriodMinutes',
                      v === 'inherit' ? null : Number(v),
                    );
                  }}
                >
                  <option value="inherit">{t('form.gracePeriodInherit')}</option>
                  <option value="0">{t('form.gracePeriodHardStop')}</option>
                  <option value="5">{t('form.gracePeriodMinutesN', { n: 5 })}</option>
                  <option value="15">{t('form.gracePeriodMinutesN', { n: 15 })}</option>
                  <option value="30">{t('form.gracePeriodMinutesN', { n: 30 })}</option>
                  <option value="60">{t('form.gracePeriodMinutesN', { n: 60 })}</option>
                  <option value="-1">{t('form.gracePeriodNever')}</option>
                </select>
                <small className="text-muted d-block mt-1">
                  {t('form.gracePeriodHint')}
                </small>
              </FormGroup>
            </Col>
            <Col md={6}>
              <FormGroup className="mb-3">
                <Input
                  {...inputProps('dataRetentionDays', t('form.dataRetentionDays'))}
                  type="number"
                  value={form.dataRetentionDays.toString()}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setField('dataRetentionDays', Number(e.target.value) || 0)
                  }
                  min={1}
                  max={365}
                />
                <small className="form-text text-muted">
                  {t('form.dataRetentionHint')}
                </small>
              </FormGroup>
            </Col>
          </Row>
        </CardBody>
      </Card>

      <Card className="shadow-sm border-0 mb-4" style={CARD_STYLE}>
        <CardBody className="p-4">
          <h5 className="fw-semibold mb-3" style={{ color: '#17324D' }}>
            {t('form.sectionSettings')}
          </h5>

          <div className="py-3">
            <div className="d-flex justify-content-between align-items-start">
              <div className="me-3">
                <div className="fw-semibold" style={{ color: '#17324D' }}>{t('form.qaEnabled')}</div>
                <div className="text-secondary" style={{ fontSize: '0.85rem' }}>{t('toggleQaDesc')}</div>
              </div>
              <ToggleSwitch label="" checked={form.qaEnabled} onChange={() => setField('qaEnabled', !form.qaEnabled)} />
            </div>
          </div>

          <div className="py-3" style={{ borderTop: '1px solid #f0f0f0' }}>
            <div className="d-flex justify-content-between align-items-start">
              <div className="me-3">
                <div className="fw-semibold" style={{ color: '#17324D' }}>{t('form.chatEnabled')}</div>
                <div className="text-secondary" style={{ fontSize: '0.85rem' }}>{t('toggleChatDesc')}</div>
              </div>
              <ToggleSwitch label="" checked={form.chatEnabled} onChange={() => setField('chatEnabled', !form.chatEnabled)} />
            </div>
          </div>

          <div className="py-3" style={{ borderTop: '1px solid #f0f0f0' }}>
            <div className="d-flex justify-content-between align-items-start">
              <div className="me-3">
                <div className="fw-semibold" style={{ color: '#17324D' }}>{t('form.recordingEnabled')}</div>
                <div className="text-secondary" style={{ fontSize: '0.85rem' }}>{t('toggleRecordingDesc')}</div>
              </div>
              <ToggleSwitch label="" checked={form.recordingEnabled} onChange={() => setField('recordingEnabled', !form.recordingEnabled)} />
            </div>
          </div>

          {gdprTemplates.length > 0 && (
            <FormGroup className="mt-3 mb-3">
              <Label htmlFor="gdprTemplateId">{t('form.privacyPolicyModeTemplate')}</Label>
              <select
                id="gdprTemplateId"
                className="form-select"
                value={form.gdprTemplateId}
                onChange={(e) => setField('gdprTemplateId', e.target.value)}
              >
                <option value="">{t('form.privacyPolicyTemplateNone')}</option>
                {gdprTemplates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name}{tpl.isDefault ? ' ★' : ''}
                  </option>
                ))}
              </select>
              <small className="form-text text-muted">
                {t('form.privacyPolicyTemplateHint')}
              </small>
            </FormGroup>
          )}

          <FormGroup className="mt-3 mb-3">
            <Input
              {...inputProps('privacyPolicyUrl', t('form.privacyPolicyUrl'))}
              type="url"
              value={form.privacyPolicyUrl}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setField('privacyPolicyUrl', e.target.value)
              }
            />
          </FormGroup>

          <FormGroup className="mb-0">
            <Input
              {...inputProps('waitingRoomAudioUrl', t('form.waitingRoomAudioUrl'))}
              type="url"
              value={form.waitingRoomAudioUrl}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setField('waitingRoomAudioUrl', e.target.value)
              }
            />
            <small className="form-text text-muted">
              {t('form.waitingRoomAudioUrlHint')}
            </small>
          </FormGroup>
        </CardBody>
      </Card>

      {/* ── Participant permissions section ── */}
      <Card className="shadow-sm border-0 mb-4" style={CARD_STYLE}>
        <CardBody className="p-4">
          <h5 className="fw-semibold mb-3" style={{ color: '#17324D' }}>
            {t('form.sectionPermissions')}
          </h5>

          <div className="py-3">
            <div className="d-flex justify-content-between align-items-start">
              <div className="me-3">
                <div className="fw-semibold" style={{ color: '#17324D' }}>
                  {t('form.participantsCanUnmute')}
                </div>
                <div className="text-secondary" style={{ fontSize: '0.85rem' }}>
                  {form.participantsCanUnmute ? t('form.permissionsOnDesc') : t('form.permissionsOffDesc')}
                </div>
              </div>
              <ToggleSwitch
                label=""
                checked={form.participantsCanUnmute}
                onChange={() => setField('participantsCanUnmute', !form.participantsCanUnmute)}
              />
            </div>
          </div>

          <div className="py-3" style={{ borderTop: '1px solid #f0f0f0' }}>
            <div className="d-flex justify-content-between align-items-start">
              <div className="me-3">
                <div className="fw-semibold" style={{ color: '#17324D' }}>
                  {t('form.participantsCanStartVideo')}
                </div>
                <div className="text-secondary" style={{ fontSize: '0.85rem' }}>
                  {form.participantsCanStartVideo ? t('form.permissionsOnDesc') : t('form.permissionsOffDesc')}
                </div>
              </div>
              <ToggleSwitch
                label=""
                checked={form.participantsCanStartVideo}
                onChange={() => setField('participantsCanStartVideo', !form.participantsCanStartVideo)}
              />
            </div>
          </div>

          <div className="py-3" style={{ borderTop: '1px solid #f0f0f0' }}>
            <div className="d-flex justify-content-between align-items-start">
              <div className="me-3">
                <div className="fw-semibold" style={{ color: '#17324D' }}>
                  {t('form.participantsCanShareScreen')}
                </div>
                <div className="text-secondary" style={{ fontSize: '0.85rem' }}>
                  {form.participantsCanShareScreen ? t('form.permissionsOnDesc') : t('form.permissionsOffDesc')}
                </div>
              </div>
              <ToggleSwitch
                label=""
                checked={form.participantsCanShareScreen}
                onChange={() => setField('participantsCanShareScreen', !form.participantsCanShareScreen)}
              />
            </div>
          </div>

          <div className="mt-2">
            <small className="form-text text-muted">
              {t('form.permissionsNote')}
            </small>
          </div>
        </CardBody>
      </Card>

      <Card className="shadow-sm border-0 mb-4" style={CARD_STYLE}>
        <CardBody className="p-4">
          <h5 className="fw-semibold mb-3" style={{ color: '#17324D' }}>
            {t('form.sectionSpeakers')}
          </h5>
          <LocaleTabBar
            enabledLocales={enabledLocales}
            defaultLocale={defaultLoc}
            activeLocale={contentLocale}
            onSelectLocale={setContentLocale}
            filledLocales={Object.keys(form.speakersInfo).filter((l) => form.speakersInfo[l as keyof typeof form.speakersInfo])}
          />
          <Row className="mb-3">
            <Col md={12}>
              <FormGroup className="mb-3">
                <TextArea
                  {...localizedInputProps('speakersInfo', contentLocale, t('form.speakersLabel'))}
                  value={(form.speakersInfo as Record<string, string>)[contentLocale] ?? ''}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setLocalizedField('speakersInfo', contentLocale, e.target.value)
                  }
                  rows={2}
                />
              </FormGroup>
            </Col>
          </Row>
          <Row>
            <Col md={6}>
              <FormGroup className="mb-3">
                <Input
                  {...inputProps('organizerName', t('form.organizerName'))}
                  type="text"
                  value={form.organizerName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setField('organizerName', e.target.value)
                  }
                />
              </FormGroup>
            </Col>
            <Col md={6}>
              <FormGroup className="mb-3">
                <Input
                  {...inputProps('imageUrl', t('form.imageUrl'))}
                  type="url"
                  value={form.imageUrl}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setField('imageUrl', e.target.value)
                  }
                />
              </FormGroup>
            </Col>
          </Row>
        </CardBody>
      </Card>

      <Card className="shadow-sm border-0 mb-4" style={CARD_STYLE}>
        <CardBody className="p-4">
          <h5 className="fw-semibold mb-3" style={{ color: '#17324D' }}>
            {t('form.sectionModerator')}
          </h5>
          <Row>
            <Col md={6}>
              <FormGroup className="mb-3">
                <Input
                  {...inputProps('moderatorName', t('form.moderatorName'))}
                  type="text"
                  value={form.moderatorName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setField('moderatorName', e.target.value)
                  }
                />
              </FormGroup>
            </Col>
            <Col md={6}>
              <FormGroup className="mb-3">
                <Input
                  {...inputProps('moderatorEmail', t('form.moderatorEmail'))}
                  type="email"
                  value={form.moderatorEmail}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setField('moderatorEmail', e.target.value)
                  }
                />
              </FormGroup>
            </Col>
          </Row>
        </CardBody>
      </Card>

      <div className="d-flex gap-3 mb-5">
        <Button
          color="primary"
          type="submit"
          disabled={submitting}
          size="lg"
          className="px-5"
        >
          {submitting ? t('form.saving') : t('form.submitEdit')}
        </Button>
        <Button
          color="secondary"
          outline
          type="button"
          onClick={() => router.back()}
          disabled={submitting}
          size="lg"
        >
          {tc('cancel')}
        </Button>
      </div>
    </form>
  );
}

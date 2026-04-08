'use client';

import { useState, useCallback, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  Button,
  Alert,
  Callout,
  CalloutTitle,
  CalloutText,
  Input,
  TextArea,
  Toggle,
  FormGroup,
  Label,
  Card,
  CardBody,
  Col,
  Row,
  Icon,
} from 'design-react-kit';

import { useRouter } from '@/i18n/navigation';
import { createEventSchema } from '@/lib/validation/schemas';
import EventConfigDiagram from '@/components/admin/event-config-diagram';

interface FieldErrors {
  [key: string]: string | undefined;
}

const CARD_STYLE = {
  borderRadius: 8,
  border: '1px solid #e8e8e8',
};

function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CreateEventForm() {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const router = useRouter();

  const defaultStart = new Date(Date.now() + 24 * 3600_000);
  const defaultEnd = new Date(defaultStart.getTime() + 2 * 3600_000);

  const [form, setForm] = useState({
    titleIt: '',
    titleEn: '',
    descriptionIt: '',
    descriptionEn: '',
    startsAt: toDatetimeLocal(defaultStart),
    endsAt: toDatetimeLocal(defaultEnd),
    maxParticipants: 300,
    qaEnabled: true,
    chatEnabled: false,
    recordingEnabled: false,
    participantsCanUnmute: false,
    participantsCanStartVideo: false,
    participantsCanShareScreen: false,
    requireOrganization: false,
    requireOrganizationRole: false,
    requireOrganizationType: false,
    dataRetentionDays: 30,
    privacyPolicyUrl: '',
    privacyPolicyText: '',
    privacyPolicyMode: 'url' as 'url' | 'text',
    moderatorName: '',
    moderatorEmail: '',
    speakersIt: '',
    speakersEn: '',
    organizerName: 'Dipartimento per la Trasformazione Digitale',
    imageUrl: '',
    waitingRoomAudioUrl: '',
  });

  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState('');

  const setField = useCallback(
    <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
      setErrors((prev) => ({ ...prev, [key]: undefined }));
    },
    [],
  );

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setServerError('');

      const payload = {
        titleIt: form.titleIt,
        titleEn: form.titleEn || undefined,
        descriptionIt: form.descriptionIt,
        descriptionEn: form.descriptionEn || undefined,
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
        maxParticipants: form.maxParticipants,
        qaEnabled: form.qaEnabled,
        chatEnabled: form.chatEnabled,
        recordingEnabled: form.recordingEnabled,
        participantsCanUnmute: form.participantsCanUnmute,
        participantsCanStartVideo: form.participantsCanStartVideo,
        participantsCanShareScreen: form.participantsCanShareScreen,
        requireOrganization: form.requireOrganization,
        requireOrganizationRole: form.requireOrganizationRole,
        requireOrganizationType: form.requireOrganizationType,
        dataRetentionDays: form.dataRetentionDays,
        privacyPolicyUrl: form.privacyPolicyMode === 'url' ? (form.privacyPolicyUrl || undefined) : undefined,
        privacyPolicyText: form.privacyPolicyMode === 'text' ? (form.privacyPolicyText || undefined) : undefined,
        moderatorName: form.moderatorName || undefined,
        moderatorEmail: form.moderatorEmail || undefined,
        speakersIt: form.speakersIt || undefined,
        speakersEn: form.speakersEn || undefined,
        organizerName: form.organizerName || undefined,
        imageUrl: form.imageUrl || undefined,
        waitingRoomAudioUrl: form.waitingRoomAudioUrl || undefined,
      };

      const result = createEventSchema.safeParse(payload);
      if (!result.success) {
        const fieldErrors: FieldErrors = {};
        for (const issue of result.error.issues) {
          const key = issue.path[0];
          if (key && !fieldErrors[key]) {
            fieldErrors[key] = issue.message;
          }
        }
        setErrors(fieldErrors);
        return;
      }

      setSubmitting(true);
      try {
        const res = await fetch('/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const data = await res.json();
          setServerError(data.error ?? tc('error'));
          return;
        }

        const created = await res.json();
        router.push(
          `/admin/eventi/${created.id}?token=${created.moderatorToken}`,
        );
      } catch {
        setServerError(tc('error'));
      } finally {
        setSubmitting(false);
      }
    },
    [form, tc, router],
  );

  const inputProps = (key: keyof typeof form, label: string) => ({
    id: key,
    label,
    validationText: errors[key],
    ...(errors[key] ? { valid: false, infoText: errors[key] } : {}),
  });

  return (
    <form onSubmit={handleSubmit} noValidate>
      {serverError && (
        <Alert color="danger" className="mb-4">
          {serverError}
        </Alert>
      )}

      {/* ── Content section ── */}
      <Card className="shadow-sm border-0 mb-4" style={CARD_STYLE}>
        <CardBody className="p-4">
          <h5 className="fw-semibold mb-3" style={{ color: '#17324D' }}>
            {t('form.sectionContent')}
          </h5>
          <Row className="mb-3">
            <Col md={6}>
              <FormGroup className="mb-3">
                <Input
                  {...inputProps('titleIt', t('form.titleIt'))}
                  type="text"
                  value={form.titleIt}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setField('titleIt', e.target.value)
                  }
                  required
                />
              </FormGroup>
            </Col>
            <Col md={6}>
              <FormGroup className="mb-3">
                <Input
                  {...inputProps('titleEn', t('form.titleEn'))}
                  type="text"
                  value={form.titleEn}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setField('titleEn', e.target.value)
                  }
                />
              </FormGroup>
            </Col>
          </Row>
          <Row>
            <Col md={6}>
              <FormGroup className="mb-3">
                <TextArea
                  {...inputProps('descriptionIt', t('form.descriptionIt'))}
                  value={form.descriptionIt}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setField('descriptionIt', e.target.value)
                  }
                  rows={4}
                  required
                />
              </FormGroup>
            </Col>
            <Col md={6}>
              <FormGroup className="mb-3">
                <TextArea
                  {...inputProps('descriptionEn', t('form.descriptionEn'))}
                  value={form.descriptionEn}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setField('descriptionEn', e.target.value)
                  }
                  rows={4}
                />
              </FormGroup>
            </Col>
          </Row>
        </CardBody>
      </Card>

      {/* ── Schedule section ── */}
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
                  {...inputProps('maxParticipants', t('form.maxParticipants'))}
                  type="number"
                  value={form.maxParticipants.toString()}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setField('maxParticipants', Number(e.target.value) || 0)
                  }
                  min={2}
                  max={500}
                />
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

          {/* ── Retention preview callout ── */}
          <Callout color="note">
            <CalloutTitle>
              <Icon icon="it-info-circle" aria-hidden />
              {t('form.retentionPreviewTitle')}
            </CalloutTitle>
            <CalloutText>
              <p className="mb-1">
                {t('form.retentionPreviewIntro', { days: form.dataRetentionDays })}
              </p>
              <ul className="mb-0" style={{ fontSize: '0.85rem' }}>
                <li>{t('form.retentionPreviewParticipants')}</li>
                <li>{t('form.retentionPreviewQa')}</li>
                <li>{t('form.retentionPreviewPolls')}</li>
                <li>{t('form.retentionPreviewRecordings')}</li>
              </ul>
              <p className="mb-0 mt-1 text-muted" style={{ fontSize: '0.85rem' }}>
                {t('form.retentionPreviewKept')}
              </p>
            </CalloutText>
          </Callout>
        </CardBody>
      </Card>

      {/* ── Settings section ── */}
      <Card className="shadow-sm border-0 mb-4" style={CARD_STYLE}>
        <CardBody className="p-4">
          <h5 className="fw-semibold mb-3" style={{ color: '#17324D' }}>
            {t('form.sectionSettings')}
          </h5>

          <div className="py-3">
            <div className="d-flex justify-content-between align-items-start">
              <div className="me-3">
                <div className="fw-semibold" style={{ color: '#17324D' }}>
                  {t('form.qaEnabled')}
                </div>
                <div className="text-secondary" style={{ fontSize: '0.85rem' }}>
                  {t('toggleQaDesc')}
                </div>
              </div>
              <Toggle
                label=""
                checked={form.qaEnabled}
                onChange={() => setField('qaEnabled', !form.qaEnabled)}
              />
            </div>
          </div>

          <div className="py-3" style={{ borderTop: '1px solid #f0f0f0' }}>
            <div className="d-flex justify-content-between align-items-start">
              <div className="me-3">
                <div className="fw-semibold" style={{ color: '#17324D' }}>
                  {t('form.chatEnabled')}
                </div>
                <div className="text-secondary" style={{ fontSize: '0.85rem' }}>
                  {t('toggleChatDesc')}
                </div>
              </div>
              <Toggle
                label=""
                checked={form.chatEnabled}
                onChange={() => setField('chatEnabled', !form.chatEnabled)}
              />
            </div>
          </div>

          <div className="py-3" style={{ borderTop: '1px solid #f0f0f0' }}>
            <div className="d-flex justify-content-between align-items-start">
              <div className="me-3">
                <div className="fw-semibold" style={{ color: '#17324D' }}>
                  {t('form.recordingEnabled')}
                </div>
                <div className="text-secondary" style={{ fontSize: '0.85rem' }}>
                  {t('toggleRecordingDesc')}
                </div>
              </div>
              <Toggle
                label=""
                checked={form.recordingEnabled}
                onChange={() => setField('recordingEnabled', !form.recordingEnabled)}
              />
            </div>
          </div>

          {/* ── Privacy policy mode toggle ── */}
          <div className="mt-3 mb-3">
            <Label className="fw-semibold mb-2 d-block" style={{ color: '#17324D' }}>
              {t('form.privacyPolicyMode')}
            </Label>
            <div className="d-flex gap-2 mb-2">
              <Button
                color={form.privacyPolicyMode === 'url' ? 'primary' : 'outline-primary'}
                size="sm"
                onClick={() => setField('privacyPolicyMode', 'url')}
                type="button"
              >
                <Icon icon="it-link" size="xs" className="me-1" />
                {t('form.privacyPolicyModeUrl')}
              </Button>
              <Button
                color={form.privacyPolicyMode === 'text' ? 'primary' : 'outline-primary'}
                size="sm"
                onClick={() => setField('privacyPolicyMode', 'text')}
                type="button"
              >
                <Icon icon="it-file" size="xs" className="me-1" />
                {t('form.privacyPolicyModeText')}
              </Button>
            </div>
            {form.privacyPolicyMode === 'url' ? (
              <FormGroup className="mb-0">
                <Input
                  {...inputProps('privacyPolicyUrl', t('form.privacyPolicyUrl'))}
                  type="url"
                  value={form.privacyPolicyUrl}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setField('privacyPolicyUrl', e.target.value)
                  }
                />
              </FormGroup>
            ) : (
              <FormGroup className="mb-0">
                <TextArea
                  {...inputProps('privacyPolicyText', t('form.privacyPolicyText'))}
                  value={form.privacyPolicyText}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setField('privacyPolicyText', e.target.value)
                  }
                  rows={6}
                />
                <small className="form-text text-muted">
                  {t('form.privacyPolicyTextHint')}
                </small>
              </FormGroup>
            )}
          </div>

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
              <Toggle
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
              <Toggle
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
              <Toggle
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

      {/* ── Registration profiling section ── */}
      <Card className="shadow-sm border-0 mb-4" style={CARD_STYLE}>
        <CardBody className="p-4">
          <h5 className="fw-semibold mb-3" style={{ color: '#17324D' }}>
            {t('form.sectionRegistrationFields')}
          </h5>

          <div className="py-3">
            <div className="d-flex justify-content-between align-items-start">
              <div className="me-3">
                <div className="fw-semibold" style={{ color: '#17324D' }}>
                  {t('form.requireOrganization')}
                </div>
                <div className="text-secondary" style={{ fontSize: '0.85rem' }}>
                  {t('form.requireOrganizationDesc')}
                </div>
              </div>
              <Toggle
                label=""
                checked={form.requireOrganization}
                onChange={() => setField('requireOrganization', !form.requireOrganization)}
              />
            </div>
          </div>

          <div className="py-3" style={{ borderTop: '1px solid #f0f0f0' }}>
            <div className="d-flex justify-content-between align-items-start">
              <div className="me-3">
                <div className="fw-semibold" style={{ color: '#17324D' }}>
                  {t('form.requireOrganizationRole')}
                </div>
                <div className="text-secondary" style={{ fontSize: '0.85rem' }}>
                  {t('form.requireOrganizationRoleDesc')}
                </div>
              </div>
              <Toggle
                label=""
                checked={form.requireOrganizationRole}
                onChange={() => setField('requireOrganizationRole', !form.requireOrganizationRole)}
              />
            </div>
          </div>

          <div className="py-3" style={{ borderTop: '1px solid #f0f0f0' }}>
            <div className="d-flex justify-content-between align-items-start">
              <div className="me-3">
                <div className="fw-semibold" style={{ color: '#17324D' }}>
                  {t('form.requireOrganizationType')}
                </div>
                <div className="text-secondary" style={{ fontSize: '0.85rem' }}>
                  {t('form.requireOrganizationTypeDesc')}
                </div>
              </div>
              <Toggle
                label=""
                checked={form.requireOrganizationType}
                onChange={() => setField('requireOrganizationType', !form.requireOrganizationType)}
              />
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ── Speakers & Organizer section ── */}
      <Card className="shadow-sm border-0 mb-4" style={CARD_STYLE}>
        <CardBody className="p-4">
          <h5 className="fw-semibold mb-3" style={{ color: '#17324D' }}>
            {t('form.sectionSpeakers')}
          </h5>
          <Row className="mb-3">
            <Col md={6}>
              <FormGroup className="mb-3">
                <TextArea
                  {...inputProps('speakersIt', t('form.speakersIt'))}
                  value={form.speakersIt}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setField('speakersIt', e.target.value)
                  }
                  rows={2}
                />
              </FormGroup>
            </Col>
            <Col md={6}>
              <FormGroup className="mb-3">
                <TextArea
                  {...inputProps('speakersEn', t('form.speakersEn'))}
                  value={form.speakersEn}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setField('speakersEn', e.target.value)
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

      {/* ── Moderator section ── */}
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

      {/* ── Configuration Preview (collapsible) ── */}
      <Card className="shadow-sm border-0 mb-4" style={CARD_STYLE}>
        <CardBody className="p-4">
          <details>
            <summary className="fw-semibold mb-3" style={{ color: '#17324D', cursor: 'pointer' }}>
              {t('form.configPreview')}
            </summary>
            <div className="mt-3">
              <EventConfigDiagram
                event={{
                  maxParticipants: form.maxParticipants,
                  qaEnabled: form.qaEnabled,
                  chatEnabled: form.chatEnabled,
                  recordingEnabled: form.recordingEnabled,
                  participantsCanUnmute: form.participantsCanUnmute,
                  participantsCanStartVideo: form.participantsCanStartVideo,
                  participantsCanShareScreen: form.participantsCanShareScreen,
                  speakersIt: form.speakersIt || undefined,
                  startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : undefined,
                  endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : undefined,
                }}
                adminMode
              />
            </div>
          </details>
        </CardBody>
      </Card>

      {/* ── Submit ── */}
      <div className="d-flex gap-3 mb-5">
        <Button
          color="primary"
          type="submit"
          disabled={submitting}
          size="lg"
          className="px-5"
        >
          {submitting ? t('form.creating') : t('form.submit')}
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

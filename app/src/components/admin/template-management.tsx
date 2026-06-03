'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import {
  Button,
  Card,
  CardBody,
  Icon,
  Input,
  TextArea,
  FormGroup,
  Alert,
  Col,
  Row,
  Badge,
} from 'design-react-kit';

import ToggleSwitch from '@/components/ui/toggle-switch';
import { useConfirm } from '@/components/ui/confirm-dialog';

interface SerializedTemplate {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  qaEnabled: boolean;
  chatEnabled: boolean;
  recordingEnabled: boolean;
  participantsCanUnmute: boolean;
  participantsCanStartVideo: boolean;
  participantsCanShareScreen: boolean;
  maxParticipants: number;
  isSystem: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface TemplateManagementProps {
  templates: SerializedTemplate[];
}

interface EditingTemplate {
  name: string;
  description: string;
  icon: string;
  qaEnabled: boolean;
  chatEnabled: boolean;
  recordingEnabled: boolean;
  participantsCanUnmute: boolean;
  participantsCanStartVideo: boolean;
  participantsCanShareScreen: boolean;
  maxParticipants: number;
}

const DEFAULT_NEW: EditingTemplate = {
  name: '',
  description: '',
  icon: 'it-video',
  qaEnabled: true,
  chatEnabled: false,
  recordingEnabled: false,
  participantsCanUnmute: false,
  participantsCanStartVideo: false,
  participantsCanShareScreen: false,
  maxParticipants: 300,
};

export default function TemplateManagement({
  templates: initialTemplates,
}: TemplateManagementProps) {
  const t = useTranslations('admin.templates');
  const tc = useTranslations('common');
  const confirm = useConfirm();
  const [templates, setTemplates] =
    useState<SerializedTemplate[]>(initialTemplates);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<EditingTemplate>(DEFAULT_NEW);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const startNew = useCallback(() => {
    setForm(DEFAULT_NEW);
    setEditing('new');
    setError('');
  }, []);

  const startEdit = useCallback((tpl: SerializedTemplate) => {
    setForm({
      name: tpl.name,
      description: tpl.description ?? '',
      icon: tpl.icon,
      qaEnabled: tpl.qaEnabled,
      chatEnabled: tpl.chatEnabled,
      recordingEnabled: tpl.recordingEnabled,
      participantsCanUnmute: tpl.participantsCanUnmute,
      participantsCanStartVideo: tpl.participantsCanStartVideo,
      participantsCanShareScreen: tpl.participantsCanShareScreen,
      maxParticipants: tpl.maxParticipants,
    });
    setEditing(tpl.id);
    setError('');
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError('');
    try {
      const isNew = editing === 'new';
      const body = isNew
        ? form
        : { id: editing, ...form };

      const res = await fetch('/api/admin/templates', {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Save failed');
      }

      const saved = await res.json();
      if (isNew) {
        setTemplates((prev) => [
          ...prev,
          { ...saved, createdAt: saved.createdAt, updatedAt: saved.updatedAt },
        ]);
      } else {
        setTemplates((prev) =>
          prev.map((tpl) => (tpl.id === saved.id ? saved : tpl)),
        );
      }
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  }, [editing, form]);

  const handleDelete = useCallback(async (id: string) => {
    const ok = await confirm({
      title: tc('delete'),
      message: t('deleteConfirm'),
      confirmLabel: tc('delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/admin/templates?id=${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Delete failed');
      }
      setTemplates((prev) => prev.filter((tpl) => tpl.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }, [confirm, t, tc]);

  const setField = useCallback(
    <K extends keyof EditingTemplate>(key: K, value: EditingTemplate[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  return (
    <div>
      <div className="d-flex justify-content-end mb-4">
        <Button
          color="primary"
          onClick={startNew}
          disabled={editing !== null}
          className="d-inline-flex align-items-center gap-2"
        >
          <Icon icon="it-plus" size="sm" color="white" />
          {t('create')}
        </Button>
      </div>

      {error && (
        <Alert color="danger" className="mb-3">
          {error}
        </Alert>
      )}

      {editing === 'new' && (
        <Card className="mb-4 border shadow-sm" style={{ borderRadius: 8 }}>
          <CardBody className="p-4">
            <h5 className="fw-semibold mb-3" style={{ color: 'var(--app-text)' }}>
              {t('create')}
            </h5>
            <TemplateForm
              form={form}
              setField={setField}
              onSave={handleSave}
              onCancel={() => setEditing(null)}
              saving={saving}
              t={t}
              tc={tc}
            />
          </CardBody>
        </Card>
      )}

      <Row>
        {templates.map((tpl) => (
          <Col key={tpl.id} md={6} lg={4} className="mb-4">
            {editing === tpl.id ? (
              <Card
                className="h-100 border shadow-sm"
                style={{ borderRadius: 8 }}
              >
                <CardBody className="p-4">
                  <TemplateForm
                    form={form}
                    setField={setField}
                    onSave={handleSave}
                    onCancel={() => setEditing(null)}
                    saving={saving}
                    t={t}
                    tc={tc}
                  />
                </CardBody>
              </Card>
            ) : (
              <Card
                className="h-100 border"
                style={{ borderRadius: 8 }}
              >
                <CardBody className="p-4 d-flex flex-column">
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <Icon icon={tpl.icon} size="sm" color="primary" />
                    <h5
                      className="fw-semibold mb-0"
                      style={{ color: 'var(--app-text)' }}
                    >
                      {tpl.name}
                    </h5>
                    {tpl.isSystem && (
                      <Badge color="secondary" style={{ fontSize: '0.7rem' }}>
                        {t('system')}
                      </Badge>
                    )}
                  </div>
                  {tpl.description && (
                    <p
                      className="text-secondary mb-3"
                      style={{ fontSize: '0.85rem' }}
                    >
                      {tpl.description}
                    </p>
                  )}
                  <div
                    className="d-flex flex-wrap gap-1 mb-3"
                    style={{ fontSize: '0.75rem' }}
                  >
                    <Badge color={tpl.qaEnabled ? 'primary' : 'secondary'}>
                      Q&A
                    </Badge>
                    <Badge color={tpl.chatEnabled ? 'primary' : 'secondary'}>
                      Chat
                    </Badge>
                    <Badge
                      color={tpl.recordingEnabled ? 'primary' : 'secondary'}
                    >
                      Rec
                    </Badge>
                    <Badge
                      color={
                        tpl.participantsCanUnmute ? 'primary' : 'secondary'
                      }
                    >
                      Mic
                    </Badge>
                    <Badge
                      color={
                        tpl.participantsCanStartVideo
                          ? 'primary'
                          : 'secondary'
                      }
                    >
                      Video
                    </Badge>
                    <Badge
                      color={
                        tpl.participantsCanShareScreen
                          ? 'primary'
                          : 'secondary'
                      }
                    >
                      Screen
                    </Badge>
                  </div>
                  <div className="text-muted mb-3" style={{ fontSize: '0.8rem' }}>
                    Max: {tpl.maxParticipants}
                  </div>
                  <div className="mt-auto d-flex gap-2">
                    <Button
                      color="primary"
                      outline
                      size="sm"
                      onClick={() => startEdit(tpl)}
                      disabled={editing !== null}
                    >
                      {tc('edit')}
                    </Button>
                    {!tpl.isSystem && (
                      <Button
                        color="danger"
                        outline
                        size="sm"
                        onClick={() => handleDelete(tpl.id)}
                        disabled={editing !== null}
                      >
                        {tc('delete')}
                      </Button>
                    )}
                  </div>
                </CardBody>
              </Card>
            )}
          </Col>
        ))}
      </Row>
    </div>
  );
}

function TemplateForm({
  form,
  setField,
  onSave,
  onCancel,
  saving,
  t,
  tc,
}: {
  form: EditingTemplate;
  setField: <K extends keyof EditingTemplate>(
    key: K,
    value: EditingTemplate[K],
  ) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  t: ReturnType<typeof useTranslations>;
  tc: ReturnType<typeof useTranslations>;
}) {
  return (
    <div>
      <FormGroup className="mb-3">
        <Input
          id="tpl-name"
          label={t('nameLabel')}
          type="text"
          value={form.name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setField('name', e.target.value)
          }
          required
        />
      </FormGroup>
      <FormGroup className="mb-3">
        <TextArea
          id="tpl-desc"
          label={t('descriptionLabel')}
          value={form.description}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
            setField('description', e.target.value)
          }
          rows={2}
        />
      </FormGroup>
      <FormGroup className="mb-3">
        <Input
          id="tpl-max"
          label={t('maxParticipantsLabel')}
          type="number"
          value={form.maxParticipants.toString()}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setField('maxParticipants', Number(e.target.value) || 0)
          }
          min={2}
          max={500}
        />
      </FormGroup>

      <div className="mb-3">
        <strong className="d-block mb-2" style={{ fontSize: '0.85rem' }}>
          {t('featuresLabel')}
        </strong>
        {(
          [
            ['qaEnabled', 'Q&A'],
            ['chatEnabled', 'Chat'],
            ['recordingEnabled', t('recordingLabel')],
            ['participantsCanUnmute', t('unmute')],
            ['participantsCanStartVideo', t('video')],
            ['participantsCanShareScreen', t('screen')],
          ] as const
        ).map(([key, label]) => (
          <div
            key={key}
            className="d-flex justify-content-between align-items-center py-2"
            style={{ borderBottom: '1px solid #f0f0f0' }}
          >
            <span style={{ fontSize: '0.85rem' }}>{label}</span>
            <ToggleSwitch
              label=""
              checked={form[key] as boolean}
              onChange={() =>
                setField(key, !form[key as keyof EditingTemplate])
              }
            />
          </div>
        ))}
      </div>

      <div className="d-flex gap-2">
        <Button color="primary" size="sm" onClick={onSave} disabled={saving}>
          {saving ? tc('loading') : tc('save')}
        </Button>
        <Button
          color="secondary"
          outline
          size="sm"
          onClick={onCancel}
          disabled={saving}
        >
          {tc('cancel')}
        </Button>
      </div>
    </div>
  );
}

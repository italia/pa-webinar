'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input, Label } from 'design-react-kit';

type TemplateKey = 'confirmation' | 'reminder';
type LocaleCode = 'it' | 'en';

interface TemplateRow {
  id: string;
  key: string;
  locale: string;
  subject: string | null;
  heading: string | null;
  bodyIntro: string | null;
  ctaLabel: string | null;
  infoNote: string | null;
  footerNote: string | null;
  updatedAt: string;
}

interface Defaults {
  subject: string;
  heading: string;
  bodyIntro: string | null;
  ctaLabel: string;
  infoNote: string | null;
  footerNote: string;
}

interface DefaultsMap {
  [key: string]: Record<LocaleCode, Defaults>;
}

interface Draft {
  subject: string;
  heading: string;
  bodyIntro: string;
  ctaLabel: string;
  infoNote: string;
  footerNote: string;
}

const EMPTY_DRAFT: Draft = {
  subject: '',
  heading: '',
  bodyIntro: '',
  ctaLabel: '',
  infoNote: '',
  footerNote: '',
};

const KEYS: TemplateKey[] = ['confirmation', 'reminder'];
const LOCALES: LocaleCode[] = ['it', 'en'];

function rowToDraft(row: TemplateRow | undefined): Draft {
  if (!row) return EMPTY_DRAFT;
  return {
    subject: row.subject ?? '',
    heading: row.heading ?? '',
    bodyIntro: row.bodyIntro ?? '',
    ctaLabel: row.ctaLabel ?? '',
    infoNote: row.infoNote ?? '',
    footerNote: row.footerNote ?? '',
  };
}

export default function EmailTemplatesManagement() {
  const t = useTranslations('admin.emailTemplates');
  const tc = useTranslations('common');

  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [defaults, setDefaults] = useState<DefaultsMap>({});
  const [loading, setLoading] = useState(false);
  const [selectedKey, setSelectedKey] = useState<TemplateKey>('confirmation');
  const [selectedLocale, setSelectedLocale] = useState<LocaleCode>('it');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [rowsRes, defRes] = await Promise.all([
        fetch('/api/admin/email-templates', { cache: 'no-store' }),
        fetch('/api/admin/email-templates/defaults', { cache: 'no-store' }),
      ]);
      if (rowsRes.ok) {
        const data = await rowsRes.json();
        setRows(data.rows);
      }
      if (defRes.ok) {
        const data = await defRes.json();
        setDefaults(data.defaults);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const currentRow = useMemo(
    () => rows.find((r) => r.key === selectedKey && r.locale === selectedLocale),
    [rows, selectedKey, selectedLocale],
  );

  // Sync draft with selected row whenever selection or rows change.
  useEffect(() => {
    setDraft(rowToDraft(currentRow));
    setError(null);
    setFlash(null);
  }, [currentRow, selectedKey, selectedLocale]);

  const currentDefaults: Defaults | null = defaults[selectedKey]?.[selectedLocale] ?? null;

  const isDirty = useMemo(() => {
    const base = rowToDraft(currentRow);
    return (Object.keys(draft) as (keyof Draft)[]).some((k) => draft[k] !== base[k]);
  }, [draft, currentRow]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setFlash(null);
    try {
      const payload = {
        key: selectedKey,
        locale: selectedLocale,
        subject: draft.subject.trim() || null,
        heading: draft.heading.trim() || null,
        bodyIntro: draft.bodyIntro.trim() || null,
        ctaLabel: draft.ctaLabel.trim() || null,
        infoNote: draft.infoNote.trim() || null,
        footerNote: draft.footerNote.trim() || null,
      };
      const res = await fetch('/api/admin/email-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error ?? t('errors.saveFailed'));
        return;
      }
      setFlash(t('saved'));
      await fetchAll();
    } finally {
      setSaving(false);
    }
  }, [draft, selectedKey, selectedLocale, fetchAll, t]);

  const resetToDefault = useCallback(async () => {
    if (!confirm(t('confirmReset'))) return;
    setSaving(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch('/api/admin/email-templates', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: selectedKey, locale: selectedLocale }),
      });
      if (!res.ok) {
        setError(t('errors.resetFailed'));
        return;
      }
      setFlash(t('resetDone'));
      await fetchAll();
    } finally {
      setSaving(false);
    }
  }, [selectedKey, selectedLocale, fetchAll, t]);

  const isOverridden = !!currentRow;

  const placeholdersHelp = t('placeholdersHelp');

  return (
    <div>
      {loading && rows.length === 0 ? (
        <div className="text-muted">{tc('loading')}</div>
      ) : (
        <>
          <div
            className="d-flex flex-wrap gap-3 align-items-end mb-4 p-3 rounded"
            style={{ background: '#f5f7fb', border: '1px solid #e8e8e8' }}
          >
            <div style={{ minWidth: 180 }}>
              <Label htmlFor="email-tpl-key">{t('selectors.key')}</Label>
              <select
                id="email-tpl-key"
                className="form-select"
                value={selectedKey}
                onChange={(e) => setSelectedKey(e.target.value as TemplateKey)}
              >
                {KEYS.map((k) => (
                  <option key={k} value={k}>{t(`keys.${k}`)}</option>
                ))}
              </select>
            </div>
            <div style={{ minWidth: 140 }}>
              <Label htmlFor="email-tpl-locale">{t('selectors.locale')}</Label>
              <select
                id="email-tpl-locale"
                className="form-select"
                value={selectedLocale}
                onChange={(e) => setSelectedLocale(e.target.value as LocaleCode)}
              >
                {LOCALES.map((l) => (
                  <option key={l} value={l}>{l.toUpperCase()}</option>
                ))}
              </select>
            </div>
            <div className="ms-auto text-muted" style={{ fontSize: '0.8rem' }}>
              {isOverridden ? (
                <span style={{ color: 'var(--app-primary)' }}>● {t('overridden')}</span>
              ) : (
                <span>○ {t('usingDefault')}</span>
              )}
            </div>
          </div>

          {error && (
            <div className="alert alert-danger" role="alert">{error}</div>
          )}
          {flash && (
            <div className="alert alert-success" role="status">{flash}</div>
          )}

          <div
            className="p-3 mb-3 rounded"
            style={{ background: '#eef5ff', border: '1px solid #b8d4fd', fontSize: '0.85rem' }}
          >
            <strong>{t('placeholdersTitle')}:</strong>{' '}
            <code>{'{{eventTitle}}'}</code>, <code>{'{{eventDate}}'}</code>,{' '}
            <code>{'{{eventTime}}'}</code>, <code>{'{{eventDuration}}'}</code>,{' '}
            <code>{'{{joinUrl}}'}</code>, <code>{'{{eventPageUrl}}'}</code>,{' '}
            <code>{'{{siteName}}'}</code>, <code>{'{{offsetMinutes}}'}</code>
            <div className="mt-2 text-muted">{placeholdersHelp}</div>
          </div>

          <Field
            id="fld-subject"
            label={t('fields.subject')}
            placeholder={currentDefaults?.subject ?? ''}
            value={draft.subject}
            onChange={(v) => setDraft({ ...draft, subject: v })}
            hint={t('fields.subjectHint')}
          />
          <Field
            id="fld-heading"
            label={t('fields.heading')}
            placeholder={currentDefaults?.heading ?? ''}
            value={draft.heading}
            onChange={(v) => setDraft({ ...draft, heading: v })}
            hint={t('fields.headingHint')}
          />
          <Field
            id="fld-bodyIntro"
            label={t('fields.bodyIntro')}
            placeholder={currentDefaults?.bodyIntro ?? ''}
            value={draft.bodyIntro}
            onChange={(v) => setDraft({ ...draft, bodyIntro: v })}
            hint={t('fields.bodyIntroHint')}
            multiline
          />
          <Field
            id="fld-ctaLabel"
            label={t('fields.ctaLabel')}
            placeholder={currentDefaults?.ctaLabel ?? ''}
            value={draft.ctaLabel}
            onChange={(v) => setDraft({ ...draft, ctaLabel: v })}
            hint={t('fields.ctaLabelHint')}
          />
          <Field
            id="fld-infoNote"
            label={t('fields.infoNote')}
            placeholder={currentDefaults?.infoNote ?? ''}
            value={draft.infoNote}
            onChange={(v) => setDraft({ ...draft, infoNote: v })}
            hint={t('fields.infoNoteHint')}
            multiline
          />
          <Field
            id="fld-footerNote"
            label={t('fields.footerNote')}
            placeholder={currentDefaults?.footerNote ?? ''}
            value={draft.footerNote}
            onChange={(v) => setDraft({ ...draft, footerNote: v })}
            hint={t('fields.footerNoteHint')}
            multiline
          />

          <div className="d-flex flex-wrap gap-2 mt-4">
            <Button
              color="primary"
              onClick={save}
              disabled={saving || !isDirty}
            >
              {saving ? tc('saving') : tc('save')}
            </Button>
            <Button
              color="secondary"
              outline
              onClick={() => setDraft(rowToDraft(currentRow))}
              disabled={saving || !isDirty}
            >
              {t('revert')}
            </Button>
            {isOverridden && (
              <Button
                color="danger"
                outline
                onClick={resetToDefault}
                disabled={saving}
                className="ms-auto"
              >
                {t('resetToDefault')}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

interface FieldProps {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  hint?: string;
  multiline?: boolean;
}

function Field({ id, label, value, placeholder, onChange, hint, multiline }: FieldProps) {
  return (
    <div className="mb-3">
      <Label htmlFor={id}>{label}</Label>
      {multiline ? (
        <textarea
          id={id}
          className="form-control"
          rows={3}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          style={{ fontFamily: 'inherit', fontSize: '0.92rem' }}
        />
      ) : (
        <Input
          id={id}
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        />
      )}
      {hint && <div className="form-text text-muted small">{hint}</div>}
    </div>
  );
}

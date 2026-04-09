'use client';

import { useState, useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Card,
  CardBody,
  Col,
  FormGroup,
  Icon,
  Input,
  Label,
  Row,
  Spinner,
  Badge,
} from 'design-react-kit';

interface LanguageConfig {
  availableLocales: string[];
  localeNames: Record<string, string>;
  translationOverrides: Record<string, Record<string, string>>;
}

interface LanguageManagementProps {
  initialConfig?: LanguageConfig;
}

const COMMON_LOCALES: Record<string, string> = {
  it: 'Italiano',
  en: 'English',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
  pt: 'Português',
  nl: 'Nederlands',
  pl: 'Polski',
  ro: 'Română',
  hr: 'Hrvatski',
  sl: 'Slovenščina',
};

export default function LanguageManagement({
  initialConfig,
}: LanguageManagementProps) {
  const t = useTranslations('admin.languages');
  const tc = useTranslations('common');

  const [config, setConfig] = useState<LanguageConfig>(
    initialConfig ?? {
      availableLocales: ['it', 'en'],
      localeNames: { it: 'Italiano', en: 'English' },
      translationOverrides: {},
    },
  );
  const [loading, setLoading] = useState(!initialConfig);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [addingLocale, setAddingLocale] = useState(false);
  const [newLocaleCode, setNewLocaleCode] = useState('');
  const [newLocaleName, setNewLocaleName] = useState('');
  const [editingOverrides, setEditingOverrides] = useState<string | null>(null);
  const [overrideKey, setOverrideKey] = useState('');
  const [overrideValue, setOverrideValue] = useState('');

  useEffect(() => {
    if (initialConfig) return;
    fetch('/api/admin/languages')
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => setError('Failed to load'))
      .finally(() => setLoading(false));
  }, [initialConfig]);

  const handleSaveLocales = useCallback(async () => {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const res = await fetch('/api/admin/languages', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          availableLocales: config.availableLocales,
          localeNames: config.localeNames,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Save failed');
      }
      const updated = await res.json();
      setConfig(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  }, [config]);

  const handleAddLocale = useCallback(() => {
    if (!newLocaleCode || !newLocaleName) return;
    const code = newLocaleCode.toLowerCase().trim();
    if (config.availableLocales.includes(code)) return;

    setConfig((prev) => ({
      ...prev,
      availableLocales: [...prev.availableLocales, code],
      localeNames: { ...prev.localeNames, [code]: newLocaleName.trim() },
    }));
    setNewLocaleCode('');
    setNewLocaleName('');
    setAddingLocale(false);
  }, [newLocaleCode, newLocaleName, config.availableLocales]);

  const handleRemoveLocale = useCallback(
    (code: string) => {
      if (code === 'it') return;
      setConfig((prev) => ({
        ...prev,
        availableLocales: prev.availableLocales.filter((l) => l !== code),
        localeNames: Object.fromEntries(
          Object.entries(prev.localeNames).filter(([k]) => k !== code),
        ),
      }));
    },
    [],
  );

  const handleSaveOverride = useCallback(
    async (locale: string) => {
      if (!overrideKey || !overrideValue) return;
      setSaving(true);
      setError('');
      try {
        const res = await fetch('/api/admin/languages', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            locale,
            overrides: { [overrideKey]: overrideValue },
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? 'Save failed');
        }
        const updated = await res.json();
        setConfig(updated);
        setOverrideKey('');
        setOverrideValue('');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error');
      } finally {
        setSaving(false);
      }
    },
    [overrideKey, overrideValue],
  );

  if (loading) {
    return (
      <div className="text-center py-5">
        <Spinner active />
      </div>
    );
  }

  return (
    <div>
      {error && (
        <Alert color="danger" className="mb-3">
          {error}
        </Alert>
      )}
      {saved && (
        <Alert color="success" className="mb-3">
          {t('saved')}
        </Alert>
      )}

      <Card className="border-0 shadow-sm mb-4">
        <CardBody className="p-4">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h5 className="fw-semibold mb-0" style={{ color: '#17324D' }}>
              {t('configuredLocales')}
            </h5>
            <Button
              color="primary"
              outline
              size="sm"
              onClick={() => setAddingLocale(true)}
              disabled={addingLocale}
              className="d-inline-flex align-items-center gap-1"
            >
              <Icon icon="it-plus" size="xs" />
              {t('addLocale')}
            </Button>
          </div>

          <p className="text-muted mb-3" style={{ fontSize: '0.85rem' }}>
            {t('localesDescription')}
          </p>

          <div className="d-flex flex-column gap-2 mb-3">
            {config.availableLocales.map((code) => (
              <div
                key={code}
                className="d-flex align-items-center justify-content-between p-3 rounded"
                style={{
                  backgroundColor: '#f8f9fa',
                  border: '1px solid #e8e8e8',
                }}
              >
                <div className="d-flex align-items-center gap-2">
                  <Badge
                    color="primary"
                    style={{ fontSize: '0.8rem', minWidth: 28 }}
                  >
                    {code.toUpperCase()}
                  </Badge>
                  <span className="fw-semibold">
                    {config.localeNames[code] ?? code}
                  </span>
                  {code === 'it' && (
                    <Badge color="secondary" style={{ fontSize: '0.7rem' }}>
                      {t('default')}
                    </Badge>
                  )}
                </div>
                <div className="d-flex align-items-center gap-2">
                  <Button
                    color="link"
                    size="sm"
                    className="p-1"
                    onClick={() =>
                      setEditingOverrides(
                        editingOverrides === code ? null : code,
                      )
                    }
                    title={t('editTranslations')}
                  >
                    <Icon icon="it-pencil" size="xs" />
                  </Button>
                  {code !== 'it' && (
                    <Button
                      color="danger"
                      outline
                      size="sm"
                      className="p-1"
                      onClick={() => handleRemoveLocale(code)}
                    >
                      <Icon icon="it-delete" size="xs" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {addingLocale && (
            <div
              className="p-3 rounded mb-3"
              style={{ border: '1px dashed #0066CC', backgroundColor: '#f0f7ff' }}
            >
              <Row>
                <Col md={4}>
                  <FormGroup className="mb-2">
                    <Label htmlFor="new-locale-code" className="small">
                      {t('localeCode')}
                    </Label>
                    <select
                      className="form-select form-select-sm"
                      id="new-locale-code"
                      value={newLocaleCode}
                      onChange={(e) => {
                        setNewLocaleCode(e.target.value);
                        const name = COMMON_LOCALES[e.target.value];
                        if (name) {
                          setNewLocaleName(name);
                        }
                      }}
                    >
                      <option value="">{t('selectLocale')}</option>
                      {Object.entries(COMMON_LOCALES)
                        .filter(
                          ([code]) =>
                            !config.availableLocales.includes(code),
                        )
                        .map(([code, name]) => (
                          <option key={code} value={code}>
                            {code} — {name}
                          </option>
                        ))}
                    </select>
                  </FormGroup>
                </Col>
                <Col md={4}>
                  <FormGroup className="mb-2">
                    <Label htmlFor="new-locale-name" className="small">
                      {t('localeName')}
                    </Label>
                    <Input
                      id="new-locale-name"
                      value={newLocaleName}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setNewLocaleName(e.target.value)
                      }
                      bsSize="sm"
                    />
                  </FormGroup>
                </Col>
                <Col md={4} className="d-flex align-items-end gap-2 mb-2">
                  <Button
                    color="primary"
                    size="sm"
                    onClick={handleAddLocale}
                    disabled={!newLocaleCode || !newLocaleName}
                  >
                    {t('add')}
                  </Button>
                  <Button
                    color="secondary"
                    outline
                    size="sm"
                    onClick={() => {
                      setAddingLocale(false);
                      setNewLocaleCode('');
                      setNewLocaleName('');
                    }}
                  >
                    {tc('cancel')}
                  </Button>
                </Col>
              </Row>
            </div>
          )}

          <div className="d-flex gap-2 align-items-center">
            <Button
              color="primary"
              onClick={handleSaveLocales}
              disabled={saving}
              className="d-inline-flex align-items-center gap-2"
            >
              {saving ? <Spinner active small /> : null}
              {tc('save')}
            </Button>
            <small className="text-muted">{t('saveNote')}</small>
          </div>
        </CardBody>
      </Card>

      {editingOverrides && (
        <Card className="border-0 shadow-sm mb-4">
          <CardBody className="p-4">
            <h5 className="fw-semibold mb-3" style={{ color: '#17324D' }}>
              {t('translationOverrides', {
                locale:
                  config.localeNames[editingOverrides] ?? editingOverrides,
              })}
            </h5>
            <p className="text-muted mb-3" style={{ fontSize: '0.85rem' }}>
              {t('overridesDescription')}
            </p>

            {Object.entries(
              config.translationOverrides[editingOverrides] ?? {},
            ).map(([key, value]) => (
              <div
                key={key}
                className="d-flex align-items-center gap-2 py-2"
                style={{ borderBottom: '1px solid #f0f0f0' }}
              >
                <code
                  className="text-muted"
                  style={{ fontSize: '0.8rem', minWidth: 200 }}
                >
                  {key}
                </code>
                <span style={{ fontSize: '0.85rem' }}>{value}</span>
              </div>
            ))}

            <div className="mt-3 p-3 rounded" style={{ backgroundColor: '#f8f9fa' }}>
              <Row>
                <Col md={5}>
                  <FormGroup className="mb-2">
                    <Label htmlFor="override-key" className="small">
                      {t('keyLabel')}
                    </Label>
                    <Input
                      id="override-key"
                      value={overrideKey}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setOverrideKey(e.target.value)
                      }
                      placeholder="common.appName"
                      bsSize="sm"
                      style={{ fontFamily: 'monospace' }}
                    />
                  </FormGroup>
                </Col>
                <Col md={5}>
                  <FormGroup className="mb-2">
                    <Label htmlFor="override-value" className="small">
                      {t('valueLabel')}
                    </Label>
                    <Input
                      id="override-value"
                      value={overrideValue}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setOverrideValue(e.target.value)
                      }
                      bsSize="sm"
                    />
                  </FormGroup>
                </Col>
                <Col md={2} className="d-flex align-items-end mb-2">
                  <Button
                    color="primary"
                    size="sm"
                    onClick={() => handleSaveOverride(editingOverrides)}
                    disabled={saving || !overrideKey || !overrideValue}
                  >
                    {t('addOverride')}
                  </Button>
                </Col>
              </Row>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

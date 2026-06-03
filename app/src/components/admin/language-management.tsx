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
import { locales, localeNames, type Locale } from '@/i18n/config';

interface LanguageConfig {
  defaultLocale: string;
  availableLocales: string[];
  localeNames: Record<string, string>;
  translationOverrides: Record<string, Record<string, string>>;
}

interface LanguageManagementProps {
  initialConfig?: LanguageConfig;
}

export default function LanguageManagement({
  initialConfig,
}: LanguageManagementProps) {
  const t = useTranslations('admin.languages');
  const tc = useTranslations('common');

  const [config, setConfig] = useState<LanguageConfig>(
    initialConfig ?? {
      defaultLocale: 'it',
      availableLocales: ['it', 'en'],
      localeNames: { it: 'Italiano', en: 'English' },
      translationOverrides: {},
    },
  );
  const [loading, setLoading] = useState(!initialConfig);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
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

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultLocale: config.defaultLocale,
          availableLocales: config.availableLocales,
          localeNames: config.localeNames,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Save failed');
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  }, [config]);

  const toggleLocale = useCallback((code: string) => {
    setConfig((prev) => {
      const enabled = prev.availableLocales.includes(code);
      if (code === prev.defaultLocale) return prev;

      if (enabled) {
        return {
          ...prev,
          availableLocales: prev.availableLocales.filter((l) => l !== code),
          localeNames: Object.fromEntries(
            Object.entries(prev.localeNames).filter(([k]) => k !== code),
          ),
        };
      }

      return {
        ...prev,
        availableLocales: [...prev.availableLocales, code],
        localeNames: { ...prev.localeNames, [code]: localeNames[code as Locale] ?? code },
      };
    });
  }, []);

  const setDefaultLocale = useCallback((code: string) => {
    setConfig((prev) => {
      const newAvailable = prev.availableLocales.includes(code)
        ? prev.availableLocales
        : [...prev.availableLocales, code];
      const newNames = { ...prev.localeNames };
      if (!newNames[code]) {
        newNames[code] = localeNames[code as Locale] ?? code;
      }
      return {
        ...prev,
        defaultLocale: code,
        availableLocales: newAvailable,
        localeNames: newNames,
      };
    });
  }, []);

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

  const enabledCount = config.availableLocales.length;

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

      {/* Default locale selector */}
      <Card className="border-0 shadow-sm mb-4">
        <CardBody className="p-4">
          <h5 className="fw-semibold mb-3" style={{ color: 'var(--app-text)' }}>
            {t('defaultLocaleTitle')}
          </h5>
          <p className="text-muted mb-3" style={{ fontSize: '0.85rem' }}>
            {t('defaultLocaleDescription')}
          </p>
          <FormGroup>
            <select
              className="form-select"
              style={{ maxWidth: 320 }}
              value={config.defaultLocale}
              onChange={(e) => setDefaultLocale(e.target.value)}
            >
              {locales.map((code) => (
                <option key={code} value={code}>
                  {localeNames[code]} ({code.toUpperCase()})
                </option>
              ))}
            </select>
          </FormGroup>
        </CardBody>
      </Card>

      {/* Enabled locales grid */}
      <Card className="border-0 shadow-sm mb-4">
        <CardBody className="p-4">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h5 className="fw-semibold mb-0" style={{ color: 'var(--app-text)' }}>
              {t('enabledLocales')}
            </h5>
            <Badge color="primary" style={{ fontSize: '0.85rem' }}>
              {enabledCount} / {locales.length}
            </Badge>
          </div>
          <p className="text-muted mb-3" style={{ fontSize: '0.85rem' }}>
            {t('enabledLocalesDescription')}
          </p>

          <Row>
            {locales.map((code) => {
              const isEnabled = config.availableLocales.includes(code);
              const isDefault = config.defaultLocale === code;
              return (
                <Col key={code} xs={6} sm={4} md={3} className="mb-3">
                  <div
                    className="p-3 rounded h-100 d-flex flex-column align-items-center text-center"
                    style={{
                      backgroundColor: isEnabled ? '#f0f7ff' : '#f8f9fa',
                      border: `1px solid ${isEnabled ? '#0066CC' : '#e8e8e8'}`,
                      opacity: isEnabled ? 1 : 0.7,
                      cursor: isDefault ? 'default' : 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                    onClick={() => !isDefault && toggleLocale(code)}
                    role="checkbox"
                    aria-checked={isEnabled}
                    aria-label={localeNames[code]}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === ' ' || e.key === 'Enter') {
                        e.preventDefault();
                        if (!isDefault) toggleLocale(code);
                      }
                    }}
                  >
                    <span style={{ fontSize: '1.4rem', lineHeight: 1 }} className="mb-1">
                      {code.toUpperCase()}
                    </span>
                    <span
                      className="fw-semibold"
                      style={{ fontSize: '0.8rem' }}
                    >
                      {localeNames[code]}
                    </span>
                    <div className="mt-auto pt-2 d-flex gap-1 flex-wrap justify-content-center">
                      {isDefault && (
                        <Badge color="primary" style={{ fontSize: '0.65rem' }}>
                          {t('default')}
                        </Badge>
                      )}
                      {isEnabled && !isDefault && (
                        <Icon
                          icon="it-check-circle"
                          size="sm"
                          className="text-primary"
                        />
                      )}
                    </div>
                  </div>
                </Col>
              );
            })}
          </Row>

          <div className="d-flex gap-2 align-items-center mt-3">
            <Button
              color="primary"
              onClick={handleSave}
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

      {/* Translation overrides */}
      <Card className="border-0 shadow-sm mb-4">
        <CardBody className="p-4">
          <h5 className="fw-semibold mb-3" style={{ color: 'var(--app-text)' }}>
            {t('translationOverridesTitle')}
          </h5>
          <p className="text-muted mb-3" style={{ fontSize: '0.85rem' }}>
            {t('translationOverridesDescription')}
          </p>

          <div className="d-flex flex-wrap gap-2 mb-3">
            {config.availableLocales.map((code) => (
              <Button
                key={code}
                color={editingOverrides === code ? 'primary' : 'outline-primary'}
                size="sm"
                onClick={() =>
                  setEditingOverrides(editingOverrides === code ? null : code)
                }
              >
                {config.localeNames[code] ?? code}
                {Object.keys(config.translationOverrides[code] ?? {}).length > 0 && (
                  <Badge
                    color="warning"
                    className="ms-1"
                    style={{ fontSize: '0.65rem' }}
                  >
                    {Object.keys(config.translationOverrides[code] ?? {}).length}
                  </Badge>
                )}
              </Button>
            ))}
          </div>

          {editingOverrides && (
            <div className="mt-3">
              <h6 className="fw-semibold mb-2">
                {t('translationOverrides', {
                  locale: config.localeNames[editingOverrides] ?? editingOverrides,
                })}
              </h6>
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
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

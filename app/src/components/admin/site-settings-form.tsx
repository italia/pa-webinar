'use client';

import { useState, useCallback } from 'react';
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
} from 'design-react-kit';
import type { SiteSetting } from '@prisma/client';
import ToggleSwitch from '@/components/ui/toggle-switch';

type Tab = 'branding' | 'header' | 'seo' | 'homepage' | 'pages' | 'footer' | 'features';

const COMMON_TIMEZONES = [
  'Europe/Rome', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
  'Europe/Madrid', 'Europe/Amsterdam', 'Europe/Brussels', 'Europe/Zurich',
  'Europe/Vienna', 'Europe/Athens', 'Europe/Bucharest', 'Europe/Helsinki',
  'Europe/Lisbon', 'Europe/Warsaw', 'Europe/Prague', 'Europe/Stockholm',
  'Europe/Oslo', 'Europe/Copenhagen', 'Europe/Dublin', 'Europe/Istanbul',
  'America/New_York', 'America/Chicago', 'America/Los_Angeles',
  'America/Sao_Paulo', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Dubai',
  'Asia/Kolkata', 'Australia/Sydney', 'Pacific/Auckland', 'UTC',
];

interface FooterLink {
  title: string;
  url: string;
  section: 'main' | 'legal';
}

interface SiteSettingsFormProps {
  initialSettings: SiteSetting;
}

export default function SiteSettingsForm({
  initialSettings,
}: SiteSettingsFormProps) {
  const t = useTranslations('admin.settings');
  const tc = useTranslations('common');
  const [activeTab, setActiveTab] = useState<Tab>('branding');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState<SiteSetting>(initialSettings);

  const updateField = useCallback(
    <K extends keyof SiteSetting>(key: K, value: SiteSetting[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
      setSaved(false);
    },
    [],
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Save failed');
      }
      const updated = await res.json();
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [settings]);

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'branding', label: t('tabs.branding'), icon: 'it-designers-italia' },
    { id: 'header', label: t('tabs.header'), icon: 'it-burger' },
    { id: 'seo', label: t('tabs.seo'), icon: 'it-search' },
    { id: 'homepage', label: t('tabs.homepage'), icon: 'it-presentation' },
    { id: 'pages', label: t('tabs.pages'), icon: 'it-files' },
    { id: 'footer', label: t('tabs.footer'), icon: 'it-link' },
    { id: 'features', label: t('tabs.features'), icon: 'it-tool' },
  ];

  return (
    <div>
      {/* Tab navigation */}
      <ul
        className="nav nav-tabs flex-nowrap mb-4"
        role="tablist"
        style={{ overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}
      >
        {tabs.map((tab) => (
          <li key={tab.id} className="nav-item flex-shrink-0" role="presentation">
            <button
              className={`nav-link d-inline-flex align-items-center gap-2 text-nowrap ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              aria-selected={activeTab === tab.id}
              type="button"
            >
              <Icon icon={tab.icon} size="sm" />
              <span className="d-none d-md-inline">{tab.label}</span>
            </button>
          </li>
        ))}
      </ul>

      {/* Tab content */}
      <Card className="border-0 shadow-sm">
        <CardBody className="p-4">
          {activeTab === 'branding' && (
            <BrandingTab settings={settings} updateField={updateField} />
          )}
          {activeTab === 'header' && (
            <HeaderTab settings={settings} updateField={updateField} />
          )}
          {activeTab === 'seo' && (
            <SeoTab settings={settings} updateField={updateField} />
          )}
          {activeTab === 'homepage' && (
            <HomepageTab settings={settings} updateField={updateField} />
          )}
          {activeTab === 'pages' && (
            <PagesTab settings={settings} updateField={updateField} />
          )}
          {activeTab === 'footer' && (
            <FooterTab settings={settings} updateField={updateField} />
          )}
          {activeTab === 'features' && (
            <FeaturesTab settings={settings} updateField={updateField} />
          )}
        </CardBody>
      </Card>

      {/* Save bar */}
      <div className="d-flex align-items-center gap-3 mt-4">
        <Button
          color="primary"
          onClick={handleSave}
          disabled={saving}
          className="d-inline-flex align-items-center gap-2"
        >
          {saving ? (
            <Spinner active small />
          ) : (
            <Icon icon="it-check-circle" size="sm" color="white" />
          )}
          {saving ? t('saving') : tc('save')}
        </Button>
        {saved && (
          <Alert color="success" className="mb-0 py-2 px-3">
            {t('saved')}
          </Alert>
        )}
        {error && (
          <Alert color="danger" className="mb-0 py-2 px-3">
            {error}
          </Alert>
        )}
      </div>
    </div>
  );
}

// ─── Tab components ─────────────────────────────────────────

interface TabProps {
  settings: SiteSetting;
  updateField: <K extends keyof SiteSetting>(
    key: K,
    value: SiteSetting[K],
  ) => void;
}

const WATERMARK_POSITIONS = [
  { value: 'bottom-left', labelKey: 'bottomLeft' },
  { value: 'bottom-right', labelKey: 'bottomRight' },
  { value: 'top-left', labelKey: 'topLeft' },
  { value: 'top-right', labelKey: 'topRight' },
] as const;

const WM_POS_STYLES: Record<string, React.CSSProperties> = {
  'bottom-left': { bottom: 8, left: 8 },
  'bottom-right': { bottom: 8, right: 8 },
  'top-left': { top: 8, left: 8 },
  'top-right': { top: 8, right: 8 },
};

function BrandingTab({ settings, updateField }: TabProps) {
  const t = useTranslations('admin.settings.branding');
  const tw = useTranslations('admin.settings.watermark');

  const wmUrl =
    settings.jitsiWatermarkUrl || settings.logoUrl || '/images/default-watermark.svg';

  return (
    <div>
      <Row>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="siteName">{t('siteName')}</Label>
            <Input
              id="siteName"
              value={settings.siteName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateField('siteName', e.target.value)
              }
            />
            <small className="text-muted">{t('siteNameHelp')}</small>
          </FormGroup>
        </Col>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="primaryColor">{t('primaryColor')}</Label>
            <div className="d-flex align-items-center gap-2">
              <input
                type="color"
                id="primaryColor"
                value={settings.primaryColor}
                onChange={(e) =>
                  updateField('primaryColor', e.target.value)
                }
                style={{ width: 48, height: 36, border: 'none', cursor: 'pointer' }}
              />
              <Input
                value={settings.primaryColor}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  updateField('primaryColor', e.target.value)
                }
                style={{ maxWidth: 120 }}
              />
            </div>
          </FormGroup>
        </Col>
      </Row>
      <Row>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="defaultTimezone">{t('defaultTimezone')}</Label>
            <select
              className="form-select"
              id="defaultTimezone"
              value={settings.defaultTimezone}
              onChange={(e) => updateField('defaultTimezone', e.target.value)}
            >
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
              ))}
            </select>
            <small className="text-muted">{t('defaultTimezoneHelp')}</small>
          </FormGroup>
        </Col>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="siteDescription">{t('siteDescription')}</Label>
            <Input
              type="textarea"
              id="siteDescription"
              value={settings.siteDescription}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateField('siteDescription', e.target.value)
              }
              style={{ minHeight: 60 }}
            />
          </FormGroup>
        </Col>
      </Row>
      <Row>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="organizationName">{t('organizationName')}</Label>
            <Input
              id="organizationName"
              value={settings.organizationName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateField('organizationName', e.target.value)
              }
            />
            <small className="text-muted">{t('organizationNameHelp')}</small>
          </FormGroup>
        </Col>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="organizationNameShort">
              {t('organizationNameShort')}
            </Label>
            <Input
              id="organizationNameShort"
              value={settings.organizationNameShort}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateField('organizationNameShort', e.target.value)
              }
            />
          </FormGroup>
        </Col>
      </Row>
      <FormGroup>
        <Label htmlFor="organizationUrl">{t('organizationUrl')}</Label>
        <Input
          id="organizationUrl"
          type="url"
          value={settings.organizationUrl}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            updateField('organizationUrl', e.target.value)
          }
        />
      </FormGroup>
      <Row>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="parentOrganization">
              {t('parentOrganization')}
            </Label>
            <Input
              id="parentOrganization"
              value={settings.parentOrganization}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateField('parentOrganization', e.target.value)
              }
            />
            <small className="text-muted">{t('parentOrganizationHelp')}</small>
          </FormGroup>
        </Col>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="parentOrganizationUrl">
              {t('parentOrganizationUrl')}
            </Label>
            <Input
              id="parentOrganizationUrl"
              type="url"
              value={settings.parentOrganizationUrl}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateField('parentOrganizationUrl', e.target.value)
              }
            />
          </FormGroup>
        </Col>
      </Row>
      <Row>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="logoUrl">{t('logoUrl')}</Label>
            <Input
              id="logoUrl"
              type="url"
              value={settings.logoUrl ?? ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateField('logoUrl', e.target.value || null)
              }
            />
            <small className="text-muted">{t('logoUrlHelp')}</small>
            {settings.logoUrl && (
              <div className="mt-2 p-2 bg-light rounded">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={settings.logoUrl}
                  alt="Logo preview"
                  style={{ maxHeight: 48 }}
                />
              </div>
            )}
          </FormGroup>
        </Col>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="faviconUrl">{t('faviconUrl')}</Label>
            <Input
              id="faviconUrl"
              type="url"
              value={settings.faviconUrl ?? ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateField('faviconUrl', e.target.value || null)
              }
            />
          </FormGroup>
        </Col>
      </Row>

      {/* ── Video watermark ── */}
      <hr className="my-4" />
      <h6 className="fw-semibold mb-3">{tw('title')}</h6>

      <div className="mb-3">
        <ToggleSwitch
          label={tw('enabled')}
          checked={settings.jitsiWatermarkEnabled}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            updateField('jitsiWatermarkEnabled', e.target.checked)
          }
        />
      </div>

      {settings.jitsiWatermarkEnabled && (
        <>
          <FormGroup>
            <Label htmlFor="jitsiWatermarkUrl">{tw('url')}</Label>
            <Input
              id="jitsiWatermarkUrl"
              type="url"
              value={settings.jitsiWatermarkUrl ?? ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateField('jitsiWatermarkUrl', e.target.value || null)
              }
            />
            <small className="text-muted">{tw('urlHelp')}</small>
          </FormGroup>

          <Row>
            <Col md={6}>
              <FormGroup>
                <Label htmlFor="jitsiWatermarkOpacity">
                  {tw('opacity')} ({Math.round(settings.jitsiWatermarkOpacity * 100)}%)
                </Label>
                <input
                  type="range"
                  id="jitsiWatermarkOpacity"
                  className="form-range"
                  min={0.1}
                  max={0.8}
                  step={0.05}
                  value={settings.jitsiWatermarkOpacity}
                  onChange={(e) =>
                    updateField('jitsiWatermarkOpacity', parseFloat(e.target.value))
                  }
                />
              </FormGroup>
            </Col>
            <Col md={6}>
              <FormGroup>
                <Label htmlFor="jitsiWatermarkPosition">{tw('position')}</Label>
                <select
                  className="form-select"
                  id="jitsiWatermarkPosition"
                  value={settings.jitsiWatermarkPosition}
                  onChange={(e) =>
                    updateField('jitsiWatermarkPosition', e.target.value)
                  }
                >
                  {WATERMARK_POSITIONS.map((pos) => (
                    <option key={pos.value} value={pos.value}>
                      {tw(`positions.${pos.labelKey}`)}
                    </option>
                  ))}
                </select>
              </FormGroup>
            </Col>
          </Row>

          {/* Preview */}
          <div
            className="rounded position-relative mt-2"
            style={{
              backgroundColor: '#1a1a2e',
              height: 160,
              overflow: 'hidden',
            }}
          >
            <div className="position-absolute top-50 start-50 translate-middle text-white-50 small">
              {tw('previewLabel')}
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={wmUrl}
              alt=""
              style={{
                position: 'absolute',
                ...WM_POS_STYLES[settings.jitsiWatermarkPosition] ?? WM_POS_STYLES['bottom-left'],
                width: 60,
                opacity: settings.jitsiWatermarkOpacity,
                pointerEvents: 'none',
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

function SeoTab({ settings, updateField }: TabProps) {
  const t = useTranslations('admin.settings.seo');
  return (
    <div>
      <FormGroup>
        <Label htmlFor="seoTitle">{t('title')}</Label>
        <Input
          id="seoTitle"
          value={settings.seoTitle}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            updateField('seoTitle', e.target.value)
          }
        />
        <small className="text-muted">{t('titleHelp')}</small>
      </FormGroup>
      <FormGroup>
        <Label htmlFor="seoDescription">{t('description')}</Label>
        <Input
          type="textarea"
          id="seoDescription"
          value={settings.seoDescription}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            updateField('seoDescription', e.target.value)
          }
          style={{ minHeight: 90 }}
        />
        <small className="text-muted">{t('descriptionHelp')}</small>
      </FormGroup>
      <FormGroup>
        <Label htmlFor="seoImage">{t('image')}</Label>
        <Input
          id="seoImage"
          type="url"
          value={settings.seoImage ?? ''}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            updateField('seoImage', e.target.value || null)
          }
        />
        <small className="text-muted">{t('imageHelp')}</small>
        {settings.seoImage && (
          <div className="mt-2 p-2 bg-light rounded">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={settings.seoImage}
              alt="OG image preview"
              style={{ maxHeight: 120, maxWidth: '100%' }}
            />
          </div>
        )}
      </FormGroup>
    </div>
  );
}

function HomepageTab({ settings, updateField }: TabProps) {
  const t = useTranslations('admin.settings.homepage');
  return (
    <div>
      <FormGroup tag="fieldset">
        <legend className="h6 fw-semibold mb-3">{t('modeLabel')}</legend>
        {(['LANDING', 'EVENTS_LIST', 'CUSTOM'] as const).map((mode) => (
          <FormGroup check key={mode} className="mb-2">
            <Input
              id={`mode-${mode}`}
              type="radio"
              name="homePageMode"
              checked={settings.homePageMode === mode}
              onChange={() => updateField('homePageMode', mode)}
            />
            <Label check htmlFor={`mode-${mode}`}>
              <strong>{t(`modes.${mode}.title`)}</strong>
              <br />
              <small className="text-muted">
                {t(`modes.${mode}.description`)}
              </small>
            </Label>
          </FormGroup>
        ))}
      </FormGroup>
      {settings.homePageMode === 'CUSTOM' && (
        <FormGroup className="mt-4">
          <Label htmlFor="customHomeHtml">{t('customHtmlLabel')}</Label>
          <Input
            type="textarea"
            id="customHomeHtml"
            value={settings.customHomeHtml ?? ''}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              updateField('customHomeHtml', e.target.value || null)
            }
            style={{ fontFamily: 'monospace', fontSize: '0.85rem', minHeight: 300 }}
          />
          <small className="text-muted">{t('customHtmlHelp')}</small>
        </FormGroup>
      )}
    </div>
  );
}

function PagesTab({ settings, updateField }: TabProps) {
  const t = useTranslations('admin.settings.pages');
  const [previewKey, setPreviewKey] = useState<string | null>(null);

  const privacyPolicy = (settings.privacyPolicy ?? {}) as Record<string, string>;
  const accessibility = (settings.accessibility ?? {}) as Record<string, string>;

  const updateJsonLocale = (
    field: 'privacyPolicy' | 'accessibility',
    current: Record<string, string>,
    locale: string,
    value: string,
  ) => {
    const updated = { ...current, [locale]: value };
    if (!value) delete updated[locale];
    updateField(field, (Object.keys(updated).length > 0 ? updated : null) as SiteSetting[typeof field]);
  };

  return (
    <div>
      <h6 className="fw-semibold mb-3">{t('privacyTitle')}</h6>
      <Row>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="privacyIt">{t('privacyIt')}</Label>
            <Input
              type="textarea"
              id="privacyIt"
              value={privacyPolicy.it ?? ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateJsonLocale('privacyPolicy', privacyPolicy, 'it', e.target.value)
              }
              style={{ fontFamily: 'monospace', fontSize: '0.85rem', minHeight: 200 }}
            />
            <Button
              size="sm"
              color="link"
              className="mt-1 p-0"
              onClick={() =>
                setPreviewKey(previewKey === 'privacyIt' ? null : 'privacyIt')
              }
            >
              {t('preview')}
            </Button>
            {previewKey === 'privacyIt' && privacyPolicy.it && (
              <div
                className="mt-2 p-3 border rounded bg-white"
                dangerouslySetInnerHTML={{
                  __html: privacyPolicy.it,
                }}
              />
            )}
          </FormGroup>
        </Col>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="privacyEn">{t('privacyEn')}</Label>
            <Input
              type="textarea"
              id="privacyEn"
              value={privacyPolicy.en ?? ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateJsonLocale('privacyPolicy', privacyPolicy, 'en', e.target.value)
              }
              style={{ fontFamily: 'monospace', fontSize: '0.85rem', minHeight: 200 }}
            />
            <Button
              size="sm"
              color="link"
              className="mt-1 p-0"
              onClick={() =>
                setPreviewKey(previewKey === 'privacyEn' ? null : 'privacyEn')
              }
            >
              {t('preview')}
            </Button>
            {previewKey === 'privacyEn' && privacyPolicy.en && (
              <div
                className="mt-2 p-3 border rounded bg-white"
                dangerouslySetInnerHTML={{
                  __html: privacyPolicy.en,
                }}
              />
            )}
          </FormGroup>
        </Col>
      </Row>

      <hr className="my-4" />

      <h6 className="fw-semibold mb-3">{t('accessibilityTitle')}</h6>
      <Row>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="accessibilityIt">{t('accessibilityIt')}</Label>
            <Input
              type="textarea"
              id="accessibilityIt"
              value={accessibility.it ?? ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateJsonLocale('accessibility', accessibility, 'it', e.target.value)
              }
              style={{ fontFamily: 'monospace', fontSize: '0.85rem', minHeight: 200 }}
            />
          </FormGroup>
        </Col>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="accessibilityEn">{t('accessibilityEn')}</Label>
            <Input
              type="textarea"
              id="accessibilityEn"
              value={accessibility.en ?? ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateJsonLocale('accessibility', accessibility, 'en', e.target.value)
              }
              style={{ fontFamily: 'monospace', fontSize: '0.85rem', minHeight: 200 }}
            />
          </FormGroup>
        </Col>
      </Row>
    </div>
  );
}

function FooterTab({ settings, updateField }: TabProps) {
  const t = useTranslations('admin.settings.footer');

  let links: FooterLink[] = [];
  try {
    const raw =
      typeof settings.footerLinks === 'string'
        ? JSON.parse(settings.footerLinks as string)
        : settings.footerLinks;
    if (Array.isArray(raw)) links = raw;
  } catch {
    // default to empty
  }

  const updateLinks = (newLinks: FooterLink[]) => {
    updateField('footerLinks', JSON.stringify(newLinks) as unknown as SiteSetting['footerLinks']);
  };

  const addLink = () => {
    updateLinks([...links, { title: '', url: '', section: 'legal' }]);
  };

  const removeLink = (index: number) => {
    updateLinks(links.filter((_, i) => i !== index));
  };

  const updateLink = (
    index: number,
    field: keyof FooterLink,
    value: string,
  ) => {
    const updated = links.map((l, i) =>
      i === index ? { ...l, [field]: value } : l,
    );
    updateLinks(updated);
  };

  const moveLink = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= links.length) return;
    const updated = [...links];
    const temp = updated[index]!;
    updated[index] = updated[target]!;
    updated[target] = temp;
    updateLinks(updated);
  };

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h6 className="fw-semibold mb-0">{t('linksTitle')}</h6>
        <Button size="sm" color="primary" outline onClick={addLink}>
          <Icon icon="it-plus" size="xs" className="me-1" />
          {t('addLink')}
        </Button>
      </div>
      {links.length === 0 ? (
        <p className="text-muted">{t('noLinks')}</p>
      ) : (
        links.map((link, i) => (
          <div key={i} className="border rounded p-3 mb-2">
            <Row className="align-items-end">
              <Col md={4}>
                <FormGroup className="mb-0">
                  <Label htmlFor={`link-title-${i}`} className="small">
                    {t('linkTitle')}
                  </Label>
                  <Input
                    id={`link-title-${i}`}
                    value={link.title}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      updateLink(i, 'title', e.target.value)
                    }
                    bsSize="sm"
                  />
                </FormGroup>
              </Col>
              <Col md={4}>
                <FormGroup className="mb-0">
                  <Label htmlFor={`link-url-${i}`} className="small">
                    URL
                  </Label>
                  <Input
                    id={`link-url-${i}`}
                    value={link.url}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      updateLink(i, 'url', e.target.value)
                    }
                    bsSize="sm"
                  />
                </FormGroup>
              </Col>
              <Col md={2}>
                <FormGroup className="mb-0">
                  <Label htmlFor={`link-section-${i}`} className="small">
                    {t('linkSection')}
                  </Label>
                  <select
                    className="form-select form-select-sm"
                    id={`link-section-${i}`}
                    value={link.section}
                    onChange={(e) =>
                      updateLink(i, 'section', e.target.value)
                    }
                  >
                    <option value="legal">{t('sectionLegal')}</option>
                    <option value="main">{t('sectionMain')}</option>
                  </select>
                </FormGroup>
              </Col>
              <Col md={2}>
                <div className="d-flex gap-1">
                  <Button
                    size="sm"
                    color="link"
                    className="p-1"
                    disabled={i === 0}
                    onClick={() => moveLink(i, -1)}
                    title={t('moveUp')}
                  >
                    <Icon icon="it-arrow-up" size="xs" />
                  </Button>
                  <Button
                    size="sm"
                    color="link"
                    className="p-1"
                    disabled={i === links.length - 1}
                    onClick={() => moveLink(i, 1)}
                    title={t('moveDown')}
                  >
                    <Icon icon="it-arrow-down" size="xs" />
                  </Button>
                  <Button
                    size="sm"
                    color="danger"
                    outline
                    className="p-1"
                    onClick={() => removeLink(i)}
                    title={t('removeLink')}
                  >
                    <Icon icon="it-delete" size="xs" />
                  </Button>
                </div>
              </Col>
            </Row>
          </div>
        ))
      )}
    </div>
  );
}

function HeaderTab({ settings, updateField }: TabProps) {
  const t = useTranslations('admin.settings.header');

  return (
    <div>
      <h6 className="fw-semibold mb-3">{t('slimBarTitle')}</h6>
      <p className="text-muted" style={{ fontSize: '0.85rem' }}>
        {t('slimBarDescription')}
      </p>
      <Row>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="hdr-parentOrg">{t('parentOrganization')}</Label>
            <Input
              id="hdr-parentOrg"
              value={settings.parentOrganization}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateField('parentOrganization', e.target.value)
              }
            />
            <small className="text-muted">{t('parentOrganizationHelp')}</small>
          </FormGroup>
        </Col>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="hdr-parentOrgUrl">{t('parentOrganizationUrl')}</Label>
            <Input
              id="hdr-parentOrgUrl"
              type="url"
              value={settings.parentOrganizationUrl}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateField('parentOrganizationUrl', e.target.value)
              }
            />
          </FormGroup>
        </Col>
      </Row>

      <hr className="my-4" />

      <h6 className="fw-semibold mb-3">{t('centerBarTitle')}</h6>
      <p className="text-muted" style={{ fontSize: '0.85rem' }}>
        {t('centerBarDescription')}
      </p>
      <Row>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="hdr-siteName">{t('appName')}</Label>
            <Input
              id="hdr-siteName"
              value={settings.siteName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateField('siteName', e.target.value)
              }
            />
            <small className="text-muted">{t('appNameHelp')}</small>
          </FormGroup>
        </Col>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="hdr-orgShort">{t('organizationShort')}</Label>
            <Input
              id="hdr-orgShort"
              value={settings.organizationNameShort}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateField('organizationNameShort', e.target.value)
              }
            />
          </FormGroup>
        </Col>
      </Row>
      <Row>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="hdr-logo">{t('logoUrl')}</Label>
            <Input
              id="hdr-logo"
              type="url"
              value={settings.logoUrl ?? ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateField('logoUrl', e.target.value || null)
              }
            />
            <small className="text-muted">{t('logoUrlHelp')}</small>
            {settings.logoUrl && (
              <div className="mt-2 p-2 bg-light rounded">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={settings.logoUrl}
                  alt="Logo preview"
                  style={{ maxHeight: 48 }}
                />
              </div>
            )}
          </FormGroup>
        </Col>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="hdr-orgUrl">{t('organizationUrl')}</Label>
            <Input
              id="hdr-orgUrl"
              type="url"
              value={settings.organizationUrl}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateField('organizationUrl', e.target.value)
              }
            />
          </FormGroup>
        </Col>
      </Row>
    </div>
  );
}

function FeaturesTab({ settings, updateField }: TabProps) {
  const t = useTranslations('admin.settings.features');
  return (
    <div>
      <div className="mb-4">
        <ToggleSwitch
          label={t('statusPageEnabled')}
          checked={settings.statusPageEnabled}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            updateField('statusPageEnabled', e.target.checked)
          }
        />
        <small className="text-muted d-block mt-1">
          {t('statusPageEnabledHelp')}
        </small>
      </div>
      <div className="mb-4">
        <ToggleSwitch
          label={t('guestAccessEnabled')}
          checked={settings.guestAccessEnabled}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            updateField('guestAccessEnabled', e.target.checked)
          }
        />
        <small className="text-muted d-block mt-1">
          {t('guestAccessEnabledHelp')}
        </small>
      </div>
      <div className="mb-4">
        <ToggleSwitch
          label={t('publicRegistrationEnabled')}
          checked={settings.publicRegistrationEnabled}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            updateField('publicRegistrationEnabled', e.target.checked)
          }
        />
        <small className="text-muted d-block mt-1">
          {t('publicRegistrationEnabledHelp')}
        </small>
      </div>
      <div className="mb-4">
        <ToggleSwitch
          label={t('calendarPublic')}
          checked={settings.calendarPublic ?? false}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            updateField('calendarPublic', e.target.checked)
          }
        />
        <small className="text-muted d-block mt-1">
          {t('calendarPublicHelp')}
        </small>
      </div>
      <hr className="my-4" />
      <Row>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="githubUrl">{t('githubUrl')}</Label>
            <Input
              id="githubUrl"
              type="url"
              value={settings.githubUrl ?? ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateField('githubUrl', e.target.value || null)
              }
            />
          </FormGroup>
        </Col>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="supportEmail">{t('supportEmail')}</Label>
            <Input
              id="supportEmail"
              type="email"
              value={settings.supportEmail ?? ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateField('supportEmail', e.target.value || null)
              }
            />
          </FormGroup>
        </Col>
      </Row>
    </div>
  );
}

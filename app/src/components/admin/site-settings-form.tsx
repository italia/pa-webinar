'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
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
import FileOrUrlInput from '@/components/ui/file-or-url-input';
import { videoQualityMaxHeight } from '@/lib/jitsi/config';

type Tab = 'branding' | 'header' | 'seo' | 'homepage' | 'pages' | 'footer' | 'features' | 'scaling' | 'postprod';

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
    { id: 'scaling', label: t('tabs.scaling'), icon: 'it-chart-line' },
    { id: 'postprod', label: t('tabs.postprod'), icon: 'it-presentation' },
  ];

  return (
    <div>
      {/* Tab navigation. Wrap su più righe invece dello scroll
          orizzontale: con N tab (9 a maggio 2026), lo scroll era
          difficile da scoprire — tab oltre la fold restavano nascoste
          finché l'utente non swipava. Wrap garantisce visibilità di
          tutte le sezioni a colpo d'occhio anche su viewport mobile. */}
      <ul
        className="nav nav-tabs flex-wrap mb-4"
        role="tablist"
      >
        {tabs.map((tab) => (
          <li key={tab.id} className="nav-item" role="presentation">
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
          {activeTab === 'scaling' && (
            <ScalingTab settings={settings} updateField={updateField} />
          )}
          {activeTab === 'postprod' && (
            <PostprodTab settings={settings} updateField={updateField} />
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
          <Alert color="success" className="mb-0">
            {t('saved')}
          </Alert>
        )}
        {error && (
          <Alert color="danger" className="mb-0">
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

          <FormGroup>
            <Label htmlFor="waitingRoomEngine">Sala d&apos;attesa (default)</Label>
            <select
              className="form-select"
              id="waitingRoomEngine"
              value={settings.waitingRoomEngine}
              onChange={(e) =>
                updateField(
                  'waitingRoomEngine',
                  e.target.value as 'GARDEN' | 'GAME' | 'CLASSIC',
                )
              }
            >
              <option value="GARDEN">Giardino (normale)</option>
              <option value="GAME">Videogame (lobby Phaser)</option>
              <option value="CLASSIC">Classica (statica)</option>
            </select>
            <small className="text-muted">
              Modalità di default della sala d&apos;attesa; sovrascrivibile per
              singolo evento e con <code>?engine=</code> nell&apos;URL.
            </small>
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
            <FileOrUrlInput
              id="logoUrl"
              label={t('logoUrl')}
              assetType="image"
              value={settings.logoUrl ?? null}
              onChange={(v) => updateField('logoUrl', v)}
              helpText={t('logoUrlHelp')}
            />
          </FormGroup>
        </Col>
        <Col md={6}>
          <FormGroup>
            <FileOrUrlInput
              id="faviconUrl"
              label={t('faviconUrl')}
              assetType="image"
              value={settings.faviconUrl ?? null}
              onChange={(v) => updateField('faviconUrl', v)}
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
            <FileOrUrlInput
              id="jitsiWatermarkUrl"
              label={tw('url')}
              assetType="image"
              value={settings.jitsiWatermarkUrl ?? null}
              onChange={(v) => updateField('jitsiWatermarkUrl', v)}
              helpText={tw('urlHelp')}
            />
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
        <FileOrUrlInput
          id="seoImage"
          label={t('image')}
          assetType="image"
          value={settings.seoImage ?? null}
          onChange={(v) => updateField('seoImage', v)}
          helpText={t('imageHelp')}
        />
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
            <FileOrUrlInput
              id="hdr-logo"
              label={t('logoUrl')}
              assetType="image"
              value={settings.logoUrl ?? null}
              onChange={(v) => updateField('logoUrl', v)}
              helpText={t('logoUrlHelp')}
            />
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
      <div className="mb-4">
        <ToggleSwitch
          label={t('parseTitleKicker')}
          checked={settings.parseTitleKicker ?? false}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            updateField('parseTitleKicker', e.target.checked)
          }
        />
        <small className="text-muted d-block mt-1">
          {t('parseTitleKickerHelp')}
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

      <hr className="my-4" />
      <h3 className="h5 mb-3">{t('emailSenderTitle')}</h3>
      <p className="text-muted small mb-3">{t('emailSenderHelp')}</p>
      <Row>
        <Col md={12}>
          <FormGroup check className="mb-3">
            <Input
              id="gravatarEnabled"
              type="checkbox"
              checked={settings.gravatarEnabled ?? false}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateField('gravatarEnabled', e.target.checked)
              }
            />
            <Label check htmlFor="gravatarEnabled">{t('gravatarEnabled')}</Label>
            <div><small className="text-muted">{t('gravatarEnabledHelp')}</small></div>
          </FormGroup>
        </Col>
      </Row>
      <Row>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="emailFromName">{t('emailFromName')}</Label>
            <Input
              id="emailFromName"
              value={settings.emailFromName ?? ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateField('emailFromName', e.target.value || null)
              }
            />
            <small className="text-muted">{t('emailFromNameHelp')}</small>
          </FormGroup>
        </Col>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="emailReplyTo">{t('emailReplyTo')}</Label>
            <Input
              id="emailReplyTo"
              type="email"
              value={settings.emailReplyTo ?? ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateField('emailReplyTo', e.target.value || null)
              }
            />
            <small className="text-muted">{t('emailReplyToHelp')}</small>
          </FormGroup>
        </Col>
      </Row>

      <hr className="my-4" />
      <h3 className="h5 mb-3">{t('jvbScalingTitle')}</h3>
      <p className="text-muted small mb-3">{t('jvbScalingHelp')}</p>
      <Row>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="jvbInactiveGraceMinutes">
              {t('jvbInactiveGraceMinutes')}
            </Label>
            <Input
              id="jvbInactiveGraceMinutes"
              type="number"
              min={5}
              max={240}
              step={5}
              value={settings.jvbInactiveGraceMinutes}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                const v = parseInt(e.target.value, 10);
                if (!Number.isNaN(v)) updateField('jvbInactiveGraceMinutes', v);
              }}
            />
            <small className="text-muted d-block mt-1">
              {t('jvbInactiveGraceMinutesHelp')}
            </small>
          </FormGroup>
        </Col>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="jvbPreScaleMinutes">
              {t('jvbPreScaleMinutes')}
            </Label>
            <Input
              id="jvbPreScaleMinutes"
              type="number"
              min={1}
              max={60}
              step={1}
              value={settings.jvbPreScaleMinutes}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                const v = parseInt(e.target.value, 10);
                if (!Number.isNaN(v)) updateField('jvbPreScaleMinutes', v);
              }}
            />
            <small className="text-muted d-block mt-1">
              {t('jvbPreScaleMinutesHelp')}
            </small>
          </FormGroup>
        </Col>
      </Row>
      <Row>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="jvbEmptyCloseMinutes">
              {t('jvbEmptyCloseMinutes')}
            </Label>
            <Input
              id="jvbEmptyCloseMinutes"
              type="number"
              min={-1}
              max={240}
              step={1}
              value={settings.jvbEmptyCloseMinutes}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                const v = parseInt(e.target.value, 10);
                if (!Number.isNaN(v)) updateField('jvbEmptyCloseMinutes', v);
              }}
            />
            <small className="text-muted d-block mt-1">
              {t('jvbEmptyCloseMinutesHelp')}
            </small>
          </FormGroup>
        </Col>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="waitingRoomLeadMinutes">
              {t('waitingRoomLeadMinutes')}
            </Label>
            <Input
              id="waitingRoomLeadMinutes"
              type="number"
              min={0}
              max={1440}
              step={1}
              value={settings.waitingRoomLeadMinutes}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                const v = parseInt(e.target.value, 10);
                if (!Number.isNaN(v)) updateField('waitingRoomLeadMinutes', v);
              }}
            />
            <small className="text-muted d-block mt-1">
              {t('waitingRoomLeadMinutesHelp')}
            </small>
          </FormGroup>
        </Col>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="reactionsMode">{t('reactionsMode')}</Label>
            <select
              className="form-select"
              id="reactionsMode"
              value={settings.reactionsMode}
              onChange={(e) =>
                updateField('reactionsMode', e.target.value as 'NATIVE' | 'CUSTOM')
              }
            >
              <option value="NATIVE">{t('reactionsModeNative')}</option>
              <option value="CUSTOM">{t('reactionsModeCustom')}</option>
            </select>
            <small className="text-muted d-block mt-1">
              {t('reactionsModeHelp')}
            </small>
          </FormGroup>
        </Col>
      </Row>
      <Row>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="jvbStressWarnPercent">
              {t('jvbStressWarnPercent')}
            </Label>
            <Input
              id="jvbStressWarnPercent"
              type="number"
              min={0}
              max={100}
              step={5}
              value={settings.jvbStressWarnPercent}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                const v = parseInt(e.target.value, 10);
                if (!Number.isNaN(v)) updateField('jvbStressWarnPercent', v);
              }}
            />
            <small className="text-muted d-block mt-1">
              {t('jvbStressWarnPercentHelp')}
            </small>
          </FormGroup>
        </Col>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="jvbStressCriticalPercent">
              {t('jvbStressCriticalPercent')}
            </Label>
            <Input
              id="jvbStressCriticalPercent"
              type="number"
              min={0}
              max={100}
              step={5}
              value={settings.jvbStressCriticalPercent}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                const v = parseInt(e.target.value, 10);
                if (!Number.isNaN(v)) updateField('jvbStressCriticalPercent', v);
              }}
            />
            <small className="text-muted d-block mt-1">
              {t('jvbStressCriticalPercentHelp')}
            </small>
          </FormGroup>
        </Col>
      </Row>
      <Row>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="jvbProvisioningTimeoutMinutes">
              {t('jvbProvisioningTimeoutMinutes')}
            </Label>
            <Input
              id="jvbProvisioningTimeoutMinutes"
              type="number"
              min={1}
              max={120}
              step={1}
              value={settings.jvbProvisioningTimeoutMinutes}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                const v = parseInt(e.target.value, 10);
                if (!Number.isNaN(v)) updateField('jvbProvisioningTimeoutMinutes', v);
              }}
            />
            <small className="text-muted d-block mt-1">
              {t('jvbProvisioningTimeoutMinutesHelp')}
            </small>
          </FormGroup>
        </Col>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="statusPollIntervalSeconds">
              {t('statusPollIntervalSeconds')}
            </Label>
            <Input
              id="statusPollIntervalSeconds"
              type="number"
              min={5}
              max={600}
              step={5}
              value={settings.statusPollIntervalSeconds}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                const v = parseInt(e.target.value, 10);
                if (!Number.isNaN(v)) updateField('statusPollIntervalSeconds', v);
              }}
            />
            <small className="text-muted d-block mt-1">
              {t('statusPollIntervalSecondsHelp')}
            </small>
          </FormGroup>
        </Col>
      </Row>
    </div>
  );
}

// ─── Scaling tab ────────────────────────────────────────────
//
// Per-cluster JVB/Jibri sizing knobs. Defaults are calibrated for
// Azure F16s_v2 (16 vCPU / 32 GiB) which is what the DTD test and
// prod environments use. Any PA reusing the platform tweaks these
// here instead of forking the scaler code.

function ScalingTab({ settings, updateField }: TabProps) {
  const t = useTranslations('admin.settings.scaling');

  // Forecast preview: given the current settings, how many JVBs would
  // we need for a 100-person event with the default sender ratio? Gives
  // the admin a quick sanity check before saving.
  const previewParticipants = 100;
  const ratio = (settings.defaultSenderRatioPct ?? 30) / 100;
  const senders = Math.ceil(previewParticipants * ratio);
  const receivers = previewParticipants - senders;
  const coresNeeded =
    senders / Math.max(0.1, settings.jvbSendersPerCore ?? 3.125) +
    receivers / Math.max(0.1, settings.jvbReceiversPerCore ?? 18.75);
  const jvbsNeeded = Math.max(
    1,
    Math.min(
      Math.ceil(coresNeeded / Math.max(1, settings.jvbCpuCoresPerPod ?? 16)),
      settings.jvbMaxReplicas ?? 6,
    ),
  );

  return (
    <div>
      <Alert color="info" className="mb-4">
        <Icon icon="it-info-circle" className="me-2" />
        {t('intro')}
      </Alert>

      {/* ── Qualità video/audio ───────────────────────────────────── */}
      <h5 className="fw-semibold mb-3" style={{ color: 'var(--app-text)' }}>
        {t('videoQualitySection')}
      </h5>
      <Row className="mb-4 align-items-stretch">
        <Col md={5}>
          <FormGroup>
            <Label htmlFor="videoQuality">{t('videoQuality')}</Label>
            <Input
              id="videoQuality"
              type="select"
              value={settings.videoQuality ?? 'HIGH'}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateField('videoQuality', e.target.value as SiteSetting['videoQuality'])
              }
            >
              {/* Order high→low so the recommended default sits near the top */}
              {(['MAX', 'HIGH', 'BALANCED', 'SAVE_DATA'] as const).map((q) => (
                <option key={q} value={q}>
                  {t(`videoQualityOptions.${q}`)}
                </option>
              ))}
            </Input>
            <small className="text-muted d-block mt-1">{t('videoQualityHelp')}</small>
          </FormGroup>
        </Col>
        <Col md={7}>
          {/* Live spec preview of the selected preset */}
          <div
            className="h-100 rounded p-3 d-flex flex-column justify-content-center"
            style={{ background: 'var(--app-surface-2, #f3f5f8)', border: '1px solid var(--app-border, #d4d8dd)' }}
          >
            <div className="d-flex align-items-center gap-2 mb-1">
              <Icon icon="it-video" size="sm" />
              <span className="fw-semibold" style={{ color: 'var(--app-text)' }}>
                {t(`videoQualityOptions.${settings.videoQuality ?? 'HIGH'}`)}
              </span>
              <Badge color="primary" pill>
                {videoQualityMaxHeight(settings.videoQuality ?? 'HIGH')}p
              </Badge>
            </div>
            <small className="text-muted">
              {t(`videoQualityDesc.${settings.videoQuality ?? 'HIGH'}`)}
            </small>
          </div>
        </Col>
      </Row>

      <h5 className="fw-semibold mb-3" style={{ color: 'var(--app-text)' }}>
        {t('jvbSection')}
      </h5>
      <Row>
        <Col md={4}>
          <FormGroup>
            <Label htmlFor="jvbCpuCoresPerPod">{t('jvbCpuCoresPerPod')}</Label>
            <Input
              id="jvbCpuCoresPerPod"
              type="number"
              min={1}
              max={128}
              value={settings.jvbCpuCoresPerPod ?? 16}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateField('jvbCpuCoresPerPod', Number(e.target.value) || 16)
              }
            />
            <small className="text-muted d-block mt-1">{t('jvbCpuCoresPerPodHelp')}</small>
          </FormGroup>
        </Col>
        <Col md={4}>
          <FormGroup>
            <Label htmlFor="jvbReceiversPerCore">{t('jvbReceiversPerCore')}</Label>
            <Input
              id="jvbReceiversPerCore"
              type="number"
              step="0.01"
              min={0.1}
              max={100}
              value={settings.jvbReceiversPerCore ?? 18.75}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateField(
                  'jvbReceiversPerCore',
                  Number(e.target.value) || 18.75,
                )
              }
            />
            <small className="text-muted d-block mt-1">{t('jvbReceiversPerCoreHelp')}</small>
          </FormGroup>
        </Col>
        <Col md={4}>
          <FormGroup>
            <Label htmlFor="jvbSendersPerCore">{t('jvbSendersPerCore')}</Label>
            <Input
              id="jvbSendersPerCore"
              type="number"
              step="0.01"
              min={0.1}
              max={100}
              value={settings.jvbSendersPerCore ?? 3.125}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateField(
                  'jvbSendersPerCore',
                  Number(e.target.value) || 3.125,
                )
              }
            />
            <small className="text-muted d-block mt-1">{t('jvbSendersPerCoreHelp')}</small>
          </FormGroup>
        </Col>
      </Row>

      <Row>
        <Col md={4}>
          <FormGroup>
            <Label htmlFor="jvbMaxReplicas">{t('jvbMaxReplicas')}</Label>
            <Input
              id="jvbMaxReplicas"
              type="number"
              min={1}
              max={50}
              value={settings.jvbMaxReplicas ?? 6}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateField('jvbMaxReplicas', Number(e.target.value) || 6)
              }
            />
            <small className="text-muted d-block mt-1">{t('jvbMaxReplicasHelp')}</small>
          </FormGroup>
        </Col>
        <Col md={4}>
          <FormGroup>
            <Label htmlFor="jibriCpuCoresPerPod">{t('jibriCpuCoresPerPod')}</Label>
            <Input
              id="jibriCpuCoresPerPod"
              type="number"
              min={1}
              max={32}
              value={settings.jibriCpuCoresPerPod ?? 4}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateField('jibriCpuCoresPerPod', Number(e.target.value) || 4)
              }
            />
            <small className="text-muted d-block mt-1">{t('jibriCpuCoresPerPodHelp')}</small>
          </FormGroup>
        </Col>
        <Col md={4}>
          <FormGroup>
            <Label htmlFor="defaultSenderRatioPct">{t('defaultSenderRatioPct')}</Label>
            <div className="d-flex align-items-center gap-2">
              <Input
                id="defaultSenderRatioPct"
                type="number"
                min={0}
                max={100}
                value={settings.defaultSenderRatioPct ?? 30}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  updateField(
                    'defaultSenderRatioPct',
                    Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                  )
                }
              />
              <span className="text-muted">%</span>
            </div>
            <small className="text-muted d-block mt-1">{t('defaultSenderRatioPctHelp')}</small>
          </FormGroup>
        </Col>
      </Row>

      <Card className="border-0 shadow-sm mb-4" style={{ background: '#F5F7FB' }}>
        <CardBody className="p-3">
          <div className="fw-semibold mb-1" style={{ color: 'var(--app-text)', fontSize: '0.9rem' }}>
            {t('previewTitle')}
          </div>
          <div className="text-muted" style={{ fontSize: '0.88rem' }}>
            {t('previewBody', {
              participants: previewParticipants,
              ratio: settings.defaultSenderRatioPct ?? 30,
              senders,
              receivers,
              cores: coresNeeded.toFixed(1),
              jvbs: jvbsNeeded,
            })}
          </div>
        </CardBody>
      </Card>

      <h5 className="fw-semibold mb-3 mt-4" style={{ color: 'var(--app-text)' }}>
        {t('graceSection')}
      </h5>
      <Row>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="eventGracePeriodMinutes">{t('eventGracePeriodMinutes')}</Label>
            <Input
              id="eventGracePeriodMinutes"
              type="number"
              min={-1}
              max={240}
              value={settings.eventGracePeriodMinutes ?? 15}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateField(
                  'eventGracePeriodMinutes',
                  Number(e.target.value) || 0,
                )
              }
            />
            <small className="text-muted d-block mt-1">{t('eventGracePeriodMinutesHelp')}</small>
          </FormGroup>
        </Col>
      </Row>
    </div>
  );
}

/**
 * Tab "Postprod AI" — controlli per la pipeline di post-produzione
 * (trascrizione, sintesi, traduzione, dubbing). Kill-switch generale
 * + provider routing + retention. La pipeline è disabled di default,
 * va attivata esplicitamente qui dopo aver verificato i prerequisiti
 * (vedi docs/POSTPROD.md per la checklist completa).
 *
 * Stile visivo coerente con FeaturesTab (toggle switch + small helper
 * text) e ScalingTab (number input per i parametri operativi).
 */
function PostprodTab({ settings, updateField }: TabProps) {
  const t = useTranslations('admin.settings.postprod');

  return (
    <div>
      {/* Prerequisiti operativi. NIENTE <Icon> nell'alert: Bootstrap
          Italia ne disegna già una "i" via ::before — vedi memoria
          feedback_bootstrap-italia-alert.md. */}
      <div className="alert alert-info" role="note" style={{ fontSize: '0.88rem' }}>
        {t('prerequisitesNote')}
      </div>

      <div className="mb-4">
        <ToggleSwitch
          label={t('pipelineEnabled')}
          checked={settings.aiPipelineEnabled ?? false}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            updateField('aiPipelineEnabled', e.target.checked)
          }
        />
        <small className="text-muted d-block mt-1">
          {t('pipelineEnabledHelp')}
        </small>
      </div>

      {/* Nota tempistica: pipeline solo post-evento, no live captioning.
          Idem niente <Icon>: l'alert.alert-warning ne ha già una. */}
      <div className="alert alert-warning" role="note" style={{ fontSize: '0.88rem' }}>
        {t('timingNote')}
      </div>

      <hr className="my-4" />

      <h6 className="fw-semibold mb-3" style={{ color: 'var(--app-text)' }}>
        {t('providersSection')}
      </h6>
      <p className="text-muted mb-3" style={{ fontSize: '0.85rem' }}>
        {t('providersIntro')}
      </p>

      <Row>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="aiAsrProvider">{t('asrProvider')}</Label>
            {/* Native <select> — il wrapper <Input type="select"> di
                design-react-kit ha provocato React #137 in produzione.
                Il pattern in uso nel resto del codebase
                (recordings-dashboard, gdpr-audit-dashboard) è il
                <select> con className="form-control". Le option sono
                hardcoded perché i provider supportati sono fissati al
                deploy: per aggiungerne uno servono changes in
                lib/ai/providers.ts + Zod schema + Deployment k8s. */}
            <select
              id="aiAsrProvider"
              className="form-control"
              value={settings.aiAsrProvider ?? 'whisperx'}
              onChange={(e) =>
                updateField('aiAsrProvider', e.target.value as 'whisperx')
              }
            >
              <option value="whisperx">{t('asrOptionWhisperx')}</option>
            </select>
            <small className="text-muted d-block mt-1">
              {t('asrProviderHelp')}
            </small>
          </FormGroup>
        </Col>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="aiLlmProvider">{t('llmProvider')}</Label>
            <select
              id="aiLlmProvider"
              className="form-control"
              value={settings.aiLlmProvider ?? 'vllm'}
              onChange={(e) =>
                updateField('aiLlmProvider', e.target.value as 'vllm')
              }
            >
              <option value="vllm">{t('llmOptionVllm')}</option>
            </select>
            <small className="text-muted d-block mt-1">
              {t('llmProviderHelp')}
            </small>
          </FormGroup>
        </Col>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="aiTtsEngine">{t('ttsEngine')}</Label>
            <select
              id="aiTtsEngine"
              className="form-control"
              value={settings.aiTtsEngine ?? 'piper'}
              onChange={(e) =>
                updateField('aiTtsEngine', e.target.value as 'piper')
              }
            >
              <option value="piper">{t('ttsOptionPiper')}</option>
            </select>
            <small className="text-muted d-block mt-1">
              {t('ttsEngineHelp')}
            </small>
          </FormGroup>
        </Col>
        <Col md={6}>
          <FormGroup>
            <Label htmlFor="aiDefaultTargetLocales">
              {t('defaultTargetLocales')}
            </Label>
            <Input
              id="aiDefaultTargetLocales"
              type="text"
              placeholder="en,fr"
              value={settings.aiDefaultTargetLocales ?? 'en,fr'}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateField('aiDefaultTargetLocales', e.target.value)
              }
            />
            <small className="text-muted d-block mt-1">
              {t('defaultTargetLocalesHelp')}
            </small>
          </FormGroup>
        </Col>
      </Row>

      <hr className="my-4" />

      <h6 className="fw-semibold mb-3" style={{ color: 'var(--app-text)' }}>
        {t('limitsSection')}
      </h6>

      <Row>
        <Col md={4}>
          <FormGroup>
            <Label htmlFor="aiMaxConcurrentJobs">
              {t('maxConcurrentJobs')}
            </Label>
            <Input
              id="aiMaxConcurrentJobs"
              type="number"
              min={1}
              max={20}
              value={settings.aiMaxConcurrentJobs ?? 2}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                const v = Number(e.target.value);
                if (!Number.isNaN(v)) updateField('aiMaxConcurrentJobs', v);
              }}
            />
            <small className="text-muted d-block mt-1">
              {t('maxConcurrentJobsHelp')}
            </small>
          </FormGroup>
        </Col>
        <Col md={4}>
          <FormGroup>
            <Label htmlFor="aiJobMaxAttempts">{t('jobMaxAttempts')}</Label>
            <Input
              id="aiJobMaxAttempts"
              type="number"
              min={1}
              max={20}
              value={settings.aiJobMaxAttempts ?? 5}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                const v = Number(e.target.value);
                if (!Number.isNaN(v)) updateField('aiJobMaxAttempts', v);
              }}
            />
            <small className="text-muted d-block mt-1">
              {t('jobMaxAttemptsHelp')}
            </small>
          </FormGroup>
        </Col>
        <Col md={4}>
          <FormGroup>
            <Label htmlFor="aiArtifactRetentionDays">
              {t('artifactRetentionDays')}
            </Label>
            <Input
              id="aiArtifactRetentionDays"
              type="number"
              min={0}
              max={3650}
              value={settings.aiArtifactRetentionDays ?? 0}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                const v = Number(e.target.value);
                if (!Number.isNaN(v)) updateField('aiArtifactRetentionDays', v);
              }}
            />
            <small className="text-muted d-block mt-1">
              {t('artifactRetentionDaysHelp')}
            </small>
          </FormGroup>
        </Col>
      </Row>

      <hr className="my-4" />

      <h6 className="fw-semibold mb-3" style={{ color: 'var(--app-text)' }}>
        {t('voiceCloningSection')}
      </h6>
      {/* Nota stabile sull'esclusione del voice cloning. Stesso vincolo
          della memoria progettuale: niente <Icon> dentro l'alert. */}
      <div className="alert alert-warning" role="note" style={{ fontSize: '0.88rem' }}>
        {t('voiceCloningNote')}
      </div>

      <hr className="my-4" />

      <h6 className="fw-semibold mb-3" style={{ color: 'var(--app-text)' }}>
        {t('consentDisclosureSection')}
      </h6>
      <p className="text-muted mb-3" style={{ fontSize: '0.85rem' }}>
        {t('consentDisclosureHelp')}
      </p>
      <Row>
        {(['it', 'en', 'fr'] as const).map((loc) => {
          // JSONB per-locale (vedi PagesTab.updateJsonLocale): rimuove la
          // chiave quando il testo è vuoto così il default i18n riprende.
          const disclosure = (settings.aiConsentDisclosure ?? {}) as Record<
            string,
            string
          >;
          return (
            <Col md={4} key={loc}>
              <FormGroup>
                <Label htmlFor={`aiConsentDisclosure-${loc}`}>
                  {loc.toUpperCase()}
                </Label>
                <Input
                  id={`aiConsentDisclosure-${loc}`}
                  type="textarea"
                  value={disclosure[loc] ?? ''}
                  placeholder={t('consentDisclosurePlaceholder')}
                  maxLength={2000}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    const updated = { ...disclosure, [loc]: e.target.value };
                    if (!e.target.value) delete updated[loc];
                    updateField(
                      'aiConsentDisclosure',
                      updated as SiteSetting['aiConsentDisclosure'],
                    );
                  }}
                  style={{ fontSize: '0.85rem', minHeight: 110 }}
                />
              </FormGroup>
            </Col>
          );
        })}
      </Row>
    </div>
  );
}

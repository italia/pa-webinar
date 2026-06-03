import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

interface ServiceInventoryPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: ServiceInventoryPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'legal.serviceInventory' });
  return { title: t('metaTitle') };
}

// Minimal CycloneDX 1.6 subset — only the fields the page renders. The raw
// JSON is always exposed via the download link for consumers that need the
// full spec.
type BomProperty = { name: string; value: string };
type BomLicense =
  | { license?: { id?: string; name?: string } }
  | { expression?: string };
type BomDataFlow = { classification?: string; flow?: string };
type BomComponent = {
  'bom-ref'?: string;
  type: string;
  name: string;
  version?: string;
  description?: string;
  purl?: string;
  licenses?: BomLicense[];
  properties?: BomProperty[];
};
type BomService = {
  'bom-ref'?: string;
  name: string;
  version?: string;
  description?: string;
  provider?: { name?: string };
  authenticated?: boolean;
  'x-trust-boundary'?: boolean;
  data?: BomDataFlow[];
  properties?: BomProperty[];
};
type Bom = {
  bomFormat?: string;
  specVersion?: string;
  metadata?: {
    timestamp?: string;
    component?: {
      name?: string;
      version?: string;
      description?: string;
    };
    properties?: BomProperty[];
  };
  components?: BomComponent[];
  services?: BomService[];
};

// Resolution rules:
//   - absolute http(s) URL → fetch with ISR revalidate
//   - path starting with "/" → read from ./public on disk
// Reading public/ directly sidesteps the "no base URL for same-origin fetch
// in server components" gotcha and keeps the PoC free of headers() plumbing.
async function loadInventory(url: string): Promise<Bom | null> {
  try {
    if (/^https?:\/\//i.test(url)) {
      const res = await fetch(url, { next: { revalidate: 3600 } });
      if (!res.ok) return null;
      return (await res.json()) as Bom;
    }
    if (url.startsWith('/')) {
      const filePath = join(process.cwd(), 'public', url.replace(/^\//, ''));
      const raw = await readFile(filePath, 'utf8');
      return JSON.parse(raw) as Bom;
    }
    return null;
  } catch {
    return null;
  }
}

function getProp(props: BomProperty[] | undefined, name: string): string | undefined {
  return props?.find((p) => p.name === name)?.value;
}

type StackLayerKey = 'access' | 'app' | 'data' | 'platform';
type StackItem = { key: string; label: string };

const STACK_LAYER_COLORS: Record<StackLayerKey, string> = {
  access: 'var(--app-primary)',
  app: '#004C99',
  data: 'var(--app-text)',
  platform: 'var(--app-muted)',
};

// Build the 4 stack layers from items that carry an eventi-dtd:layer property.
// Display label falls back to the component/service name if no stack-label
// override is set — so a tenant can surface items in the stack just by tagging
// them, without editing this file.
function buildStack(bom: Bom): Record<StackLayerKey, StackItem[]> {
  const out: Record<StackLayerKey, StackItem[]> = {
    access: [], app: [], data: [], platform: [],
  };
  const collect = (items: Array<BomComponent | BomService>) => {
    for (const it of items) {
      const layer = getProp(it.properties, 'eventi-dtd:layer') as StackLayerKey | undefined;
      if (!layer || !(layer in out)) continue;
      const label = getProp(it.properties, 'eventi-dtd:stack-label') ?? it.name;
      out[layer].push({ key: it['bom-ref'] ?? label, label });
    }
  };
  collect(bom.components ?? []);
  collect(bom.services ?? []);
  return out;
}

function renderLicense(licenses?: BomLicense[]): string {
  if (!licenses || licenses.length === 0) return '—';
  return licenses
    .map((l) => {
      if ('expression' in l && l.expression) return l.expression;
      if ('license' in l && l.license) return l.license.id ?? l.license.name ?? '';
      return '';
    })
    .filter(Boolean)
    .join(', ') || '—';
}

export default async function ServiceInventoryPage() {
  const t = await getTranslations('legal.serviceInventory');
  const url = process.env.SERVICE_INVENTORY_URL ?? '';

  if (!url) {
    return (
      <div className="container py-5">
        <div className="row justify-content-center">
          <div className="col-lg-9">
            <header className="mb-4">
              <h1 className="mb-3">{t('title')}</h1>
              <p className="lead text-muted mb-0">{t('intro')}</p>
            </header>
            <div className="card shadow-sm border-0" style={{ borderRadius: 8 }}>
              <div className="card-body p-4">
                <h2 className="h4 mb-2">{t('notPublishedTitle')}</h2>
                <p className="mb-0">{t('notPublishedBody')}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const bom = await loadInventory(url);
  if (!bom) {
    return (
      <div className="container py-5">
        <div className="row justify-content-center">
          <div className="col-lg-9">
            <header className="mb-4">
              <h1 className="mb-3">{t('title')}</h1>
              <p className="lead text-muted mb-0">{t('intro')}</p>
            </header>
            <div className="card shadow-sm border-0" style={{ borderRadius: 8 }}>
              <div className="card-body p-4">
                <h2 className="h4 mb-2">{t('fetchErrorTitle')}</h2>
                <p className="mb-0">{t('fetchErrorBody')}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const meta = bom.metadata ?? {};
  const tenant = getProp(meta.properties, 'eventi-dtd:tenant') ?? meta.component?.name ?? '—';
  const provider = getProp(meta.properties, 'eventi-dtd:cloud-provider') ?? '—';
  const region = getProp(meta.properties, 'eventi-dtd:region');
  const deploymentMode = getProp(meta.properties, 'eventi-dtd:deployment-mode');
  const components = bom.components ?? [];
  const services = bom.services ?? [];

  return (
    <div className="container py-5">
      <div className="row justify-content-center">
        <div className="col-lg-10">
          <header className="mb-4">
            <h1 className="mb-3">{t('title')}</h1>
            <p className="lead text-muted mb-3">{t('intro')}</p>
          </header>

          <div className="card shadow-sm border-0 mb-4" style={{ borderRadius: 8 }}>
            <div className="card-body p-4">
              <dl className="row mb-0">
                <dt className="col-sm-4">{t('metadata.tenant')}</dt>
                <dd className="col-sm-8">{tenant}</dd>
                <dt className="col-sm-4">{t('metadata.provider')}</dt>
                <dd className="col-sm-8">{provider}</dd>
                {region && (
                  <>
                    <dt className="col-sm-4">{t('metadata.region')}</dt>
                    <dd className="col-sm-8">{region}</dd>
                  </>
                )}
                {deploymentMode && (
                  <>
                    <dt className="col-sm-4">{t('metadata.deploymentMode')}</dt>
                    <dd className="col-sm-8">{deploymentMode}</dd>
                  </>
                )}
                {meta.timestamp && (
                  <>
                    <dt className="col-sm-4">{t('metadata.generatedAt')}</dt>
                    <dd className="col-sm-8">
                      <time dateTime={meta.timestamp}>{meta.timestamp.replace('T', ' ').replace('Z', ' UTC')}</time>
                    </dd>
                  </>
                )}
                <dt className="col-sm-4">{t('metadata.format')}</dt>
                <dd className="col-sm-8">
                  {bom.bomFormat ?? 'CycloneDX'} {bom.specVersion ?? ''}
                </dd>
                <dt className="col-sm-4">{t('metadata.download')}</dt>
                <dd className="col-sm-8">
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    {url}
                  </a>
                </dd>
              </dl>
            </div>
          </div>

          <section className="mb-4">
            <h2 className="h4 mb-2">{t('sections.componentsTitle')}</h2>
            <p className="text-muted mb-3">{t('sections.componentsIntro')}</p>
            <div className="table-responsive">
              <table className="table table-sm align-middle">
                <thead>
                  <tr>
                    <th scope="col">{t('columns.name')}</th>
                    <th scope="col">{t('columns.type')}</th>
                    <th scope="col">{t('columns.version')}</th>
                    <th scope="col">{t('columns.license')}</th>
                  </tr>
                </thead>
                <tbody>
                  {components.map((c) => (
                    <tr key={c['bom-ref'] ?? `${c.name}@${c.version ?? ''}`}>
                      <td>
                        <strong>{c.name}</strong>
                        {c.description && (
                          <div className="text-muted small">{c.description}</div>
                        )}
                      </td>
                      <td><code>{c.type}</code></td>
                      <td>{c.version ?? '—'}</td>
                      <td>{renderLicense(c.licenses)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mb-4">
            <h2 className="h4 mb-2">{t('sections.servicesTitle')}</h2>
            <p className="text-muted mb-3">{t('sections.servicesIntro')}</p>
            <div className="d-flex flex-column gap-3">
              {services.map((s) => {
                const hasPersonalData = s.data?.some((d) => d.classification === 'personal-data');
                const hasRecording = s.data?.some((d) => d.classification === 'recording');
                return (
                  <div
                    key={s['bom-ref'] ?? s.name}
                    className="card border"
                    style={{ borderRadius: 8 }}
                  >
                    <div className="card-body p-3">
                      <div className="d-flex flex-wrap align-items-baseline gap-2 mb-2">
                        <strong>{s.name}</strong>
                        {s.version && <span className="text-muted small">{s.version}</span>}
                        {s.provider?.name && (
                          <span className="text-muted small">· {s.provider.name}</span>
                        )}
                      </div>
                      {s.description && <p className="mb-2">{s.description}</p>}
                      <div className="d-flex flex-wrap gap-2">
                        {s['x-trust-boundary'] && (
                          <span className="service-inventory__chip service-inventory__chip--trust">
                            {t('badges.trustBoundary')}
                          </span>
                        )}
                        {hasPersonalData && (
                          <span className="service-inventory__chip service-inventory__chip--personal-data">
                            {t('badges.personalData')}
                          </span>
                        )}
                        {hasRecording && (
                          <span className="service-inventory__chip service-inventory__chip--recording">
                            {t('badges.recording')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {(() => {
            const stack = buildStack(bom);
            const layersInOrder: StackLayerKey[] = ['access', 'app', 'data', 'platform'];
            const hasAny = layersInOrder.some((k) => stack[k].length > 0);
            if (!hasAny) return null;
            return (
              <section className="service-inventory__stack" aria-labelledby="si-stack-title">
                <h2 id="si-stack-title" className="service-inventory__stack-title">
                  {t('stack.title')}
                </h2>
                <p className="service-inventory__stack-intro">{t('stack.intro')}</p>
                <div className="service-inventory__stack-layers">
                  {layersInOrder.map((layerKey) => {
                    const items = stack[layerKey];
                    if (items.length === 0) return null;
                    return (
                      <div
                        key={layerKey}
                        className="service-inventory__stack-layer"
                        style={{ ['--layer-color' as string]: STACK_LAYER_COLORS[layerKey] }}
                      >
                        <div>
                          <span className="service-inventory__stack-layer-title">
                            {t(`stack.layers.${layerKey}.title`)}
                          </span>
                          <span className="service-inventory__stack-layer-sub">
                            {t(`stack.layers.${layerKey}.sub`)}
                          </span>
                        </div>
                        <div className="service-inventory__stack-items">
                          {layerKey === 'access' && (
                            <span className="service-inventory__stack-item">
                              {t('stack.layers.access.endUsers')}
                            </span>
                          )}
                          {items.map((it) => (
                            <span key={it.key} className="service-inventory__stack-item">
                              {it.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-muted small mt-3 mb-0">{t('stack.note')}</p>
              </section>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

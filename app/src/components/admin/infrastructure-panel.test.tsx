import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import messages from '@/i18n/messages/it.json';
import type { InfrastructureInfo } from '@/lib/infrastructure';

import InfrastructurePanel from './infrastructure-panel';

/**
 * Il pannello Infrastruttura dice quello che l'installazione è: profilo e
 * piattaforma dichiarati, la sala verificata dove gira, il ponte fisso che
 * risponde o no, la pagina di stato secondo l'impostazione.
 */

let container: HTMLDivElement;
let root: Root;

function info(over: Partial<{ [K in keyof InfrastructureInfo]: Partial<InfrastructureInfo[K]> }> = {}): InfrastructureInfo {
  const base: InfrastructureInfo = {
    deployment: { mode: 'simple', platform: 'kubernetes', version: '1.2.3', nodeEnv: 'production' },
    database: { type: 'internal', host: 'rel-postgresql', connected: true },
    jitsi: {
      domain: 'jitsi.example.test',
      reachable: true,
      status: 'operational',
      detail: null,
      publicCheckFailed: false,
      jwtConfigured: true,
    },
    jvb: {
      mode: 'fixed',
      desiredReplicas: 1,
      runningReplicas: 1,
      maxReplicas: 1,
      preScaleMinutes: 15,
      scalerEnabled: false,
    },
    jibri: { available: false, storageType: 'not-configured', storageConfigured: false },
    email: { provider: 'SMTP', configured: true },
    storage: { recordings: 'not-configured' },
    features: { statusPage: true, guestAccess: true, metricsEndpoint: true },
  };
  return {
    deployment: { ...base.deployment, ...over.deployment },
    database: { ...base.database, ...over.database },
    jitsi: { ...base.jitsi, ...over.jitsi },
    jvb: { ...base.jvb, ...over.jvb },
    jibri: { ...base.jibri, ...over.jibri },
    email: { ...base.email, ...over.email },
    storage: { ...base.storage, ...over.storage },
    features: { ...base.features, ...over.features },
  };
}

function mostra(i: InfrastructureInfo): string {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <InfrastructurePanel info={i} />
      </NextIntlClientProvider>,
    );
  });
  return container.textContent ?? '';
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('InfrastructurePanel', () => {
  it('profilo semplice su Kubernetes: niente «Docker Compose» né «Standard»', () => {
    const testo = mostra(info());
    expect(testo).toContain('Semplice');
    expect(testo).toContain('Su Kubernetes');
    expect(testo).not.toContain('Docker Compose)');
    expect(testo).toContain('1.2.3');
  });

  it('versione non dichiarata: un trattino, non 0.0.0', () => {
    const testo = mostra(info({ deployment: { version: '' } }));
    expect(testo).not.toContain('0.0.0');
    expect(testo).toContain('—');
  });

  it('verifica pubblica fallita per certificato: lo dice col codice, non «Non raggiungibile»', () => {
    const testo = mostra(
      info({
        jitsi: {
          reachable: true,
          status: 'degraded',
          detail: 'DEPTH_ZERO_SELF_SIGNED_CERT',
          publicCheckFailed: true,
        },
      }),
    );
    expect(testo).toContain('DEPTH_ZERO_SELF_SIGNED_CERT');
    expect(testo).not.toContain('Non raggiungibile');
  });

  it('ponte fisso che non risponde: lo dice', () => {
    const testo = mostra(info({ jvb: { runningReplicas: 0 } }));
    expect(testo).toContain('Modalità fissa');
    expect(testo).toContain('Il ponte video non risponde');
  });

  it('ponte non monitorato: lo dice, senza numeri', () => {
    const testo = mostra(info({ jvb: { mode: 'unmonitored', runningReplicas: null, desiredReplicas: 0 } }));
    expect(testo).toContain('JVB_HEALTH_URL');
  });

  it('con lo scaler: i bridge richiesti ora e il pre-scale dell’impostazione', () => {
    const testo = mostra(
      info({ jvb: { mode: 'scaler', scalerEnabled: true, desiredReplicas: 2, maxReplicas: 6, preScaleMinutes: 15 } }),
    );
    expect(testo).toContain('2/6');
    expect(testo).toContain('15 min');
  });

  it('pagina di stato spenta: non compare fra le funzionalità attive', () => {
    expect(mostra(info({ features: { statusPage: false } }))).not.toContain('Pagina di stato');
    expect(mostra(info({ features: { statusPage: true } }))).toContain('Pagina di stato');
  });
});

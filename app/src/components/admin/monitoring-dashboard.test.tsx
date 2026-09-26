import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

import MonitoringDashboard from './monitoring-dashboard';

/**
 * Il monitoraggio senza Prometheus: le schede della capacità mostrano i valori
 * attuali che /api/status legge dal ponte video, invece di un trattino. Senza
 * scaler il riquadro dello scale-to-zero non c'è. La serie `up` si seleziona
 * come dice il server (job e namespace), non per etichetta `app`.
 */

const fetchMock = vi.fn();
let container: HTMLDivElement;
let root: Root;

const analytics = {
  range: '7d',
  since: '2026-09-01T00:00:00.000Z',
  now: '2026-09-08T00:00:00.000Z',
  events: { total: 0, byStatus: {}, avgParticipants: null, totalParticipants: 0, mostCrowded: null },
  registrations: { total: 0, confirmed: 0 },
  callSessions: {
    total: 0,
    totalDurationSeconds: 0,
    totalRecordingBytes: '0',
    avgDurationSeconds: null,
    avgPeakParticipants: null,
  },
  buckets: [],
  recentCalls: [],
  scaleToZero: { idleEvents: 0, provisioningEvents: 0, liveEvents: 2 },
};

function rispondi(prometheus: boolean) {
  fetchMock.mockImplementation(async (url: string) => {
    const u = String(url);
    if (u.startsWith('/api/admin/metrics/query')) {
      return new Response(JSON.stringify(prometheus ? { available: true, data: { result: [] } } : { available: false }));
    }
    if (u.startsWith('/api/admin/monitoring/analytics')) return new Response(JSON.stringify(analytics));
    if (u.startsWith('/api/status')) {
      return new Response(
        JSON.stringify({
          metrics: { jvbParticipants: 7, jvbStressLevel: 0.05, jvbConferences: 2, jvbOctoSendBitrateBps: null },
        }),
      );
    }
    return new Response('{}', { status: 404 });
  });
}

async function mostra(props: { jvbScalerEnabled: boolean }): Promise<string> {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <MonitoringDashboard
          appLabel="pa-webinar"
          uptimeSelector='up{namespace="webinar",job="pa-webinar"}'
          jvbScalerEnabled={props.jvbScalerEnabled}
        />
      </NextIntlClientProvider>,
    );
  });
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  return container.textContent ?? '';
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('MonitoringDashboard', () => {
  it('senza Prometheus le schede della capacità mostrano i valori del ponte', async () => {
    rispondi(false);
    const testo = await mostra({ jvbScalerEnabled: false });
    expect(testo).toContain('Valori attuali letti dal ponte video');
    expect(testo).toMatch(/Partecipanti sul ponte video\s*7/);
    expect(testo).toMatch(/Conferenze sul ponte video\s*2/);
    expect(testo).toContain('5.0%');
  });

  it('senza scaler il riquadro dello scale-to-zero non c’è; con lo scaler sì', async () => {
    rispondi(false);
    expect(await mostra({ jvbScalerEnabled: false })).not.toContain('Stato scale-to-zero');
    act(() => root.unmount());
    root = createRoot(container);
    expect(await mostra({ jvbScalerEnabled: true })).toContain('Stato scale-to-zero');
  });

  it('con Prometheus non chiede /api/status, e seleziona `up` per job', async () => {
    rispondi(true);
    await mostra({ jvbScalerEnabled: true });
    const chiamate = fetchMock.mock.calls.map((c) => ({ url: String(c[0]), body: String((c[1] as RequestInit | undefined)?.body ?? '') }));
    expect(chiamate.some((c) => c.url.startsWith('/api/status'))).toBe(false);
    const uptime = chiamate.find((c) => c.body.includes('avg_over_time(up'));
    expect(uptime?.body).toContain('up{namespace=\\"webinar\\",job=\\"pa-webinar\\"}');
    expect(chiamate.some((c) => c.body.includes('up{app='))).toBe(false);
  });
});

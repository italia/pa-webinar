import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

vi.mock('./postprod-status-card', () => ({ default: () => null }));

import StatusDashboard from './status-dashboard';

/**
 * La scheda del ponte video della pagina di stato. Senza scaler i bridge sono
 * fissi: niente testi di scale-to-zero, niente «JVB si attiva tra», e il
 * numero dei bridge lo dice il server, non una variabile del build.
 */

const fetchMock = vi.fn();
let container: HTMLDivElement;
let root: Root;

function stato(metrics: Record<string, unknown>, upcomingEvents: unknown[] = []) {
  return {
    overall: 'operational',
    components: [],
    metrics: {
      activeEvents: 0,
      idleEvents: 0,
      provisioningEvents: 0,
      totalRegistrationsToday: 0,
      jvbDesiredReplicas: 1,
      jvbRunningReplicas: 1,
      jvbStatus: 'ready',
      jvbScalerEnabled: false,
      jvbMonitored: true,
      jvbMaxReplicas: 1,
      jvbStressLevel: null,
      jvbParticipants: null,
      jvbConferences: null,
      jvbStale: false,
      jvbOctoEnabled: false,
      jvbOctoConferences: null,
      jvbOctoEndpoints: null,
      jvbOctoSendBitrateBps: null,
      jibriStale: false,
      ...metrics,
    },
    upcomingEvents,
    config: { provisioningTimeoutMinutes: 15, pollIntervalSeconds: 30 },
    lastChecked: new Date().toISOString(),
  };
}

async function mostra(body: unknown): Promise<string> {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body)));
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <StatusDashboard />
      </NextIntlClientProvider>,
    );
  });
  for (let i = 0; i < 3; i++) {
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

const inizioTraMinuti = (m: number) => ({
  title: 'Evento',
  startsAt: new Date(Date.now() + m * 60_000).toISOString(),
  status: 'PUBLISHED',
  maxParticipants: 50,
  videoEnabled: true,
});

describe('StatusDashboard — bridge fissi', () => {
  it('ponte su: «attivo», nessun testo di scale-to-zero né «JVB si attiva tra»', async () => {
    const testo = await mostra(stato({ jvbMaxReplicas: 1 }, [inizioTraMinuti(10)]));
    expect(testo).toContain('Ponte video attivo');
    expect(testo).not.toContain('Scale-to-zero');
    expect(testo).not.toContain('JVB si attiva tra');
  });

  it('il numero dei bridge viene dal server', async () => {
    const testo = await mostra(stato({ jvbMaxReplicas: 3 }));
    expect(testo).toContain('3 bridge previsti');
    expect(testo).not.toContain('/6');
  });

  it('ponte giù: lo dice, senza promettere un’accensione automatica', async () => {
    const testo = await mostra(stato({ jvbRunningReplicas: 0, jvbStatus: 'standby' }));
    expect(testo).toContain('Il ponte video non risponde');
    expect(testo).not.toContain('si attiva automaticamente');
  });

  it('ponte non monitorato: lo dice', async () => {
    const testo = await mostra(stato({ jvbMonitored: false, jvbRunningReplicas: 0, jvbStatus: 'standby' }));
    expect(testo).toContain('Stato non monitorato');
  });

  it('i partecipanti sono quelli sul ponte video', async () => {
    const testo = await mostra(stato({ jvbParticipants: 4 }));
    expect(testo).toContain('4 partecipanti sul ponte video');
  });
});

describe('StatusDashboard — con lo scaler', () => {
  it('«JVB si attiva tra» per un inizio futuro', async () => {
    const futuro = await mostra(
      stato({ jvbScalerEnabled: true, jvbMaxReplicas: 6, jvbStatus: 'standby' }, [inizioTraMinuti(10)]),
    );
    expect(futuro).toContain('JVB si attiva tra');
  });

  it('mai «JVB si attiva tra 0 min» per un evento già iniziato', async () => {
    const passato = await mostra(
      stato({ jvbScalerEnabled: true, jvbMaxReplicas: 6, jvbStatus: 'standby' }, [inizioTraMinuti(-5)]),
    );
    expect(passato).not.toContain('JVB si attiva tra');
  });

  it('il tetto nella barra viene dal server', async () => {
    const testo = await mostra(stato({ jvbScalerEnabled: true, jvbMaxReplicas: 4 }));
    expect(testo).toContain('1/4');
  });

  it('chiede i titoli nella lingua della pagina', async () => {
    await mostra(stato({}));
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/status?locale=it');
  });
});

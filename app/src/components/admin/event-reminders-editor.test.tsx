import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

/**
 * I promemoria si scelgono fra i momenti previsti e si salvano subito; uno
 * gia' partito non si toglie, un momento gia' passato non si aggiunge, oltre
 * il quinto non se ne aggiungono.
 */
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => toast }));

import EventRemindersEditor, { type PromemoriaRiga } from './event-reminders-editor';

const p = messages.reminders.presets;
const fetchMock = vi.fn();
const onChange = vi.fn();
let container: HTMLDivElement;
let root: Root;

const elenco = (reminders: PromemoriaRiga[]) => new Response(JSON.stringify({ reminders }), { status: 200 });

const riga = (offsetMinutes: number, sentCount = 0): PromemoriaRiga => ({
  id: `r-${offsetMinutes}`,
  offsetMinutes,
  label: 'etichetta del database',
  sentCount,
  createdAt: '2026-10-01T10:00:00.000Z',
});

async function disegna(
  reminders: PromemoriaRiga[],
  startsAt = new Date(Date.now() + 2 * 86_400_000).toISOString(),
  aperto = false,
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <EventRemindersEditor
          eventSlug="evento-di-prova"
          moderatorToken="TOKEN_MODERATORE"
          startsAt={startsAt}
          reminders={reminders}
          aperto={aperto}
          onChange={onChange}
        />
      </NextIntlClientProvider>,
    );
  });
}

const casella = (testo: string) => {
  const label = Array.from(container.querySelectorAll('label')).find((l) => l.textContent?.startsWith(testo))!;
  return container.querySelector<HTMLInputElement>(`#${label.htmlFor}`)!;
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchMock.mockReset();
  onChange.mockReset();
  toast.error.mockReset();
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

describe('EventRemindersEditor', () => {
  it('accendere un momento lo crea, con il link principale', async () => {
    await disegna([riga(1440)]);
    expect(casella(p['1day']).checked).toBe(true);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(riga(60)), { status: 201 }));
    fetchMock.mockResolvedValueOnce(elenco([riga(1440), riga(60)]));
    await act(async () => {
      casella(p['1hour']).click();
    });
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/events/evento-di-prova/reminders', {
      method: 'POST',
      headers: { Authorization: 'Bearer TOKEN_MODERATORE', 'Content-Type': 'application/json' },
      body: JSON.stringify({ offsetMinutes: 60 }),
    });
    // Poi l'elenco si rilegge dal server.
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/events/evento-di-prova/reminders', {
      headers: { Authorization: 'Bearer TOKEN_MODERATORE' },
    });
    expect(onChange).toHaveBeenCalledWith([riga(1440), riga(60)]);
    // La casella resta attiva durante il salvataggio: il fuoco non si perde.
    expect(casella(p['1hour']).disabled).toBe(false);
  });

  it('spegnerlo lo cancella', async () => {
    await disegna([riga(1440), riga(60)]);
    fetchMock.mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    fetchMock.mockResolvedValueOnce(elenco([riga(1440)]));
    await act(async () => {
      casella(p['1hour']).click();
    });
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/events/evento-di-prova/reminders/r-60', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer TOKEN_MODERATORE' },
    });
    expect(onChange).toHaveBeenCalledWith([riga(1440)]);
  });

  it('uno gia\' partito non si toglie, un momento passato non si aggiunge', async () => {
    // Inizio fra due ore: «3 ore prima» e' gia' passato.
    await disegna([riga(1440, 12)], new Date(Date.now() + 2 * 3_600_000).toISOString());
    expect(casella(p['1day']).disabled).toBe(true);
    expect(casella(p['3hours']).disabled).toBe(true);
    expect(casella(p['1hour']).disabled).toBe(false);
  });

  it('con cinque promemoria gli altri momenti sono bloccati', async () => {
    await disegna([riga(10080), riga(4320), riga(1440), riga(720), riga(360)]);
    expect(casella(p['1hour']).disabled).toBe(true);
    expect(casella(p['1day']).disabled).toBe(false);
  });

  it('un rifiuto del server si dice con il suo motivo, e l\'elenco si rilegge', async () => {
    await disegna([riga(1440)]);
    // Partito nel frattempo: il server rifiuta, l'elenco riletto lo mostra.
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'REMINDER_SENT' }), { status: 409 }));
    fetchMock.mockResolvedValueOnce(elenco([riga(1440, 30)]));
    await act(async () => {
      casella(p['1day']).click();
    });
    expect(toast.error).toHaveBeenCalledWith(messages.reminders.errorSent);
    expect(onChange).toHaveBeenCalledWith([riga(1440, 30)]);

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'REMINDER_LIMIT' }), { status: 422 }));
    fetchMock.mockResolvedValueOnce(elenco([riga(1440)]));
    await act(async () => {
      casella(p['1hour']).click();
    });
    expect(toast.error).toHaveBeenLastCalledWith(messages.reminders.maxReminders.replace('{max}', '5'));
  });

  it('all\'apertura l\'elenco si rilegge dal server', async () => {
    fetchMock.mockResolvedValueOnce(elenco([riga(1440, 3)]));
    await disegna([riga(1440)], undefined, true);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onChange).toHaveBeenCalledWith([riga(1440, 3)]);
  });

  it('una casella bloccata dice perche\', una volta sola', async () => {
    await disegna([riga(10080), riga(4320), riga(1440), riga(720), riga(360)]);
    const label = casella(p['1hour']).labels![0]!;
    // Con lo spazio: è il nome che legge il lettore di schermo.
    expect(label.textContent).toBe(`${p['1hour']} (${messages.reminders.limitReached})`);
    expect(casella(p['1hour']).hasAttribute('aria-describedby')).toBe(false);
  });
});

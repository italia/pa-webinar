import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

/**
 * Il link del moderatore copiato dal cruscotto e' un indirizzo da incollare
 * altrove: i segmenti si traducono dalla mappa degli indirizzi
 * (`/it/eventi/…`), non si scrivono a mano con quelli inglesi.
 */
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  percorso: (p: string) => p,
}));
vi.mock('@/components/ui/confirm-dialog', () => ({
  useConfirm: () => vi.fn(async () => true),
}));
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));

import ModeratorsDashboard from './moderators-dashboard';

const APP = 'https://webinar.example.gov.it';
const fetchMock = vi.fn();
const writeText = vi.fn(async () => undefined);

let container: HTMLDivElement;
let root: Root;

async function attendi() {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchMock.mockReset();
  writeText.mockClear();
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        rows: [
          {
            id: 'evento-1',
            slug: 'evento-di-prova',
            title: 'Evento di prova',
            status: 'PUBLISHED',
            eventType: 'SCHEDULED',
            startsAt: '2026-10-01T09:00:00.000Z',
            endsAt: '2026-10-01T10:00:00.000Z',
            moderatorName: null,
            moderatorEmail: null,
            moderatorToken: 'TOKEN_MODERATORE',
          },
        ],
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('ModeratorsDashboard — copia del link', () => {
  it('copia l’indirizzo della sala con i segmenti della lingua', async () => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
          <ModeratorsDashboard appUrl={APP} locale="it" />
        </NextIntlClientProvider>,
      );
    });
    await attendi();
    const copia = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === messages.admin.moderators.copy,
    );
    if (!copia) throw new Error('pulsante di copia non trovato');
    await act(async () => {
      copia.click();
    });
    expect(writeText).toHaveBeenCalledWith(
      `${APP}/it/eventi/evento-di-prova/live?token=TOKEN_MODERATORE`,
    );
  });
});

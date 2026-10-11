import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, className }: { href: unknown; children: ReactNode; className?: string }) => (
    <a href={String(href)} className={className}>
      {children}
    </a>
  ),
  percorso: (p: string) => p,
}));

vi.mock('next-intl/server', () => ({ getLocale: async () => 'it' }));

import EventList from './event-list';
import EventListClient from './event-list-client';

let container: HTMLDivElement;
let root: Root;

const evento = {
  id: '1',
  slug: 'evento',
  title: { it: 'Evento' },
  description: { it: 'Un **incontro** con [il programma](https://example.org).' },
  startsAt: new Date(Date.now() + 3_600_000).toISOString(),
  endsAt: new Date(Date.now() + 7_200_000).toISOString(),
  status: 'PUBLISHED',
};

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

describe('schede degli eventi', () => {
  it('il server riduce la descrizione a testo semplice', async () => {
    const elemento = (await EventList({ events: [evento] as never })) as { props: { events: Array<{ descrizioneTesto: string }> } };
    expect(elemento.props.events[0]?.descrizioneTesto).toBe('Un incontro con il programma.');
  });

  it('la scheda mostra quel testo, non la sintassi, e non ha il badge «pubblico»', () => {
    act(() => {
      root.render(
        <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
          <EventListClient events={[{ ...evento, descrizioneTesto: 'Un incontro con il programma.' }] as never} />
        </NextIntlClientProvider>,
      );
    });
    expect(container.textContent).toContain('Un incontro con il programma.');
    expect(container.textContent).not.toContain('**');
    expect(container.textContent).not.toContain('](');
    expect(container.querySelector('.opacity-75')).toBeNull();
  });
});

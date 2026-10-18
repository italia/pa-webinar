import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, className }: { href: unknown; children: ReactNode; className?: string }) => (
    <a href={String(href)} className={className}>
      {children}
    </a>
  ),
  percorso: (p: string) => p,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => vi.fn(async () => true) }));

import AdminDashboardClient from './admin-dashboard-client';

let container: HTMLDivElement;
let root: Root;

const ora = Date.now();
const evento = (id: string, status: string, startsInMin: number, createdMinAgo: number) => ({
  id,
  title: { it: `Evento ${id}` },
  slug: `evento-${id}`,
  startsAt: new Date(ora + startsInMin * 60_000).toISOString(),
  endsAt: new Date(ora + (startsInMin + 60) * 60_000).toISOString(),
  createdAt: new Date(ora - createdMinAgo * 60_000).toISOString(),
  status,
  eventType: 'SCHEDULED',
  registrationCount: 0,
  maxParticipants: 100,
  peakParticipants: 0,
  moderatorToken: `tok-${id}`,
  coverImageUrl: null,
  imageUrl: null,
  organizerName: null,
  parseTitleKicker: null,
  moderatorCount: 0,
  speakerCount: 0,
  organizers: [],
  tags: [],
});

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

describe('elenco degli eventi — il giorno dell\'evento', () => {
  it('in corso prima, poi i prossimi dal piu\' vicino, poi i passati; in cima «Oggi e in corso»', () => {
    const eventi = [
      evento('passato', 'ENDED', -60 * 24 * 3, 1),
      evento('lontano', 'PUBLISHED', 60 * 24 * 10, 2),
      evento('diretta', 'LIVE', -10, 300),
      evento('vicino', 'PUBLISHED', 60 * 24 * 2, 3),
      // Una bozza vecchia e' nel passato, non fra i prossimi.
      evento('bozza-vecchia', 'DRAFT', -60 * 24 * 90, 4),
      // Rimasto in pausa dopo la fine: non e' «in corso» ne' «oggi».
      evento('incagliato', 'IDLE', -60 * 24 * 3, 5),
    ];
    act(() => {
      root.render(
        <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
          <AdminDashboardClient events={eventi as never} renderedAt={ora} availableTags={[]} siteDefaultParseTitleKicker={false} />
        </NextIntlClientProvider>,
      );
    });
    const griglia = container.querySelector('.row.g-4')?.textContent ?? '';
    const ordine = ['diretta', 'vicino', 'lontano', 'passato', 'incagliato', 'bozza-vecchia'];
    const indici = ordine.map((id) => griglia.indexOf(`Evento ${id}`));
    expect(indici.every((i) => i >= 0)).toBe(true);
    expect([...indici].sort((a, b) => a - b)).toEqual(indici);

    const oggi = container.querySelector('section[aria-labelledby="oggi-e-in-corso"]');
    expect(oggi?.textContent).toContain('Evento diretta');
    expect(oggi?.textContent).not.toContain('Evento incagliato');
    // Un pulsante, non un link: il token del moderatore non si vede passando.
    expect(oggi?.querySelector('a[href*="token="]')).toBeNull();
    expect(Array.from(oggi?.querySelectorAll('button') ?? []).some((b) => b.textContent === messages.admin.eventsList.menu.enterRoom)).toBe(true);
  });
});

describe('elenco degli eventi — persone ed enti della scheda', () => {
  it('conta moderatori e relatori per ruolo e mostra gli enti organizzatori', () => {
    const conPersone = {
      ...evento('persone', 'PUBLISHED', 60 * 24, 1),
      moderatorCount: 1,
      speakerCount: 3,
      organizers: [{ name: 'Ente Uno' }, { name: 'Ente Due' }],
      organizerName: 'Nome libero',
    };
    act(() => {
      root.render(
        <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
          <AdminDashboardClient events={[conPersone] as never} renderedAt={ora} availableTags={[]} siteDefaultParseTitleKicker={false} />
        </NextIntlClientProvider>,
      );
    });
    const scheda = container.querySelector('.row.g-4')?.textContent ?? '';
    // Il link principale conta come un moderatore in più.
    expect(scheda).toContain('2 moderatori · 3 relatori');
    expect(scheda).toContain('Ente Uno, Ente Due');
    expect(scheda).not.toContain('Nome libero');
  });
});

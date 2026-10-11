import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

/**
 * Gli invitati con chi si e' gia' iscritto; un elenco vuoto con l'accesso
 * «solo su invito» e' un avviso (nessuno puo' iscriversi); un errore si
 * riprova.
 */
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  percorso: (p: string) => p,
}));

import EventInvitationsPanel from './event-invitations-panel';

const m = messages.admin.invitationsPanel;
const fetchMock = vi.fn();
let container: HTMLDivElement;
let root: Root;

async function disegna(invitationOnly: boolean) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <EventInvitationsPanel eventId="evento-1" invitationOnly={invitationOnly} editHref="/admin/events/evento-1/edit?step=invites" />
      </NextIntlClientProvider>,
    );
  });
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const risposta = (rows: unknown[]) => new Response(JSON.stringify({ rows }), { status: 200 });

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

describe('EventInvitationsPanel', () => {
  it('elenca gli invitati con lo stato d\'iscrizione e il conto', async () => {
    fetchMock.mockResolvedValue(
      risposta([
        { id: 'a', name: 'Persona 1', email: 'p1@example.org', role: 'GUEST', registered: true, person: null },
        { id: 'b', name: null, email: 'p2@example.org', role: 'SPEAKER', registered: false, person: null },
      ]),
    );
    await disegna(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/events/evento-1/invitations');
    const righe = Array.from(container.querySelectorAll('tbody tr')).map((tr) => tr.textContent);
    expect(righe[0]).toContain('Persona 1');
    expect(righe[0]).toContain(m.registered);
    expect(righe[1]).toContain(m.notRegistered);
    expect(righe[1]).toContain(m.roleSpeaker);
    expect(container.textContent).toContain('Iscritti: 1 su 2');
    expect(container.textContent).toContain(m.introInvitationOnly);
    expect(container.querySelector('a[href="/admin/events/evento-1/edit?step=invites"]')?.textContent).toBe(m.edit);
  });

  it('senza invitati e con l\'accesso solo su invito avvisa che nessuno puo\' iscriversi', async () => {
    fetchMock.mockResolvedValue(risposta([]));
    await disegna(true);
    expect(container.querySelector('.alert-warning')?.textContent).toBe(m.emptyInvitationOnly);
    await disegna(false);
    expect(container.textContent).toContain(m.empty);
  });

  it('un errore si dice e si riprova', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    await disegna(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(m.loadError);
    fetchMock.mockResolvedValueOnce(risposta([]));
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[role="alert"] button')!.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

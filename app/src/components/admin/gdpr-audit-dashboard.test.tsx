// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  percorso: (p: string) => p,
}));

import GdprAuditDashboard from './gdpr-audit-dashboard';

let container: HTMLDivElement;
let root: Root;

const riga = {
  id: 'r1',
  action: 'CONSENT_WITHDRAWN',
  recordCount: 1,
  details: null,
  createdAt: '2026-01-01T00:00:00.000Z',
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
  vi.unstubAllGlobals();
});

async function mostra(rows: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ rows, actionSummary: [], since: '', limit: 200 }),
    }))
  );
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <GdprAuditDashboard />
      </NextIntlClientProvider>
    );
  });
}

describe('GdprAuditDashboard', () => {
  it('una riga con evento porta alla sua pagina', async () => {
    await mostra([{ ...riga, eventId: 'e1', eventSlug: 'evento', eventTitle: 'Evento' }]);
    const link = container.querySelector('tbody a')!;
    expect(link.getAttribute('href')).toBe('/admin/events/e1');
    expect(link.textContent).toBe('Evento');
  });

  it('una riga senza evento non ha un link', async () => {
    await mostra([{ ...riga, eventId: null, eventSlug: null, eventTitle: null }]);
    expect(container.querySelector('tbody tr')).not.toBeNull();
    expect(container.querySelector('tbody a')).toBeNull();
  });
});

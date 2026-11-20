// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

const parametri = vi.hoisted(() => ({ valore: new URLSearchParams('t=tok') }));
vi.mock('next/navigation', () => ({ useSearchParams: () => parametri.valore }));

import ErasurePage from './page';

const m = messages.gdpr.erasure;
let container: HTMLDivElement;
let root: Root;

const monta = () =>
  act(() =>
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <ErasurePage />
      </NextIntlClientProvider>
    )
  );
async function conferma(corpo: unknown, status = 200) {
  const richiesta = vi.fn(async () => new Response(JSON.stringify(corpo), { status }));
  vi.stubGlobal('fetch', richiesta);
  monta();
  await act(async () => {
    [...container.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === m.confirmButton)
      ?.click();
  });
  return richiesta;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  parametri.valore = new URLSearchParams('t=tok');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('ErasurePage', () => {
  it('prima della conferma dice cosa resta', () => {
    monta();
    expect(container.textContent).toContain(m.confirmWarning);
    expect(container.textContent).toContain(m.confirmBody);
    expect(container.textContent).toContain(m.confirmProofs);
    // Le iscrizioni, non i video: accanto c'e' il testo sul video che resta.
    expect(m.confirmBody).toContain('le iscrizioni');
    expect(m.confirmWarning).not.toContain('tutti i dati');
  });

  it('senza link chiede l’indirizzo e non promette niente sulle prove', () => {
    parametri.valore = new URLSearchParams();
    monta();
    expect(container.textContent).not.toContain(m.confirmProofs);
    expect(container.querySelector('input[type="email"]')).not.toBeNull();
  });

  it('dopo la conferma dice quante prove sono rimaste', async () => {
    const richiesta = await conferma({
      deleted: 2,
      grantsDeleted: 0,
      consentProofsKept: 3,
    });
    expect(richiesta).toHaveBeenCalledWith(
      '/api/gdpr/erasure?t=tok',
      expect.objectContaining({ method: 'POST' })
    );
    expect(container.textContent).toContain('Sono state cancellate 2 iscrizioni');
    expect(container.textContent).toContain('Sono rimaste 3 prove di consenso');
  });

  it('una prova sola ha il singolare', async () => {
    await conferma({ deleted: 0, grantsDeleted: 0, consentProofsKept: 1 });
    expect(container.textContent).toContain('È rimasta 1 prova di consenso');
  });

  it('senza prove rimaste non ne parla', async () => {
    await conferma({ deleted: 1, grantsDeleted: 1, consentProofsKept: 0 });
    expect(container.textContent).not.toContain('prova di consenso');
    expect(container.textContent).not.toContain('prove di consenso');
  });

  it('una risposta di prima, senza il campo, non rompe la pagina', async () => {
    await conferma({ deleted: 1 });
    expect(container.textContent).toContain(m.doneTitle);
  });

  it('un link scaduto lo dice', async () => {
    await conferma({}, 401);
    expect(container.textContent).toContain(m.linkInvalid);
  });
});

// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

import RegistrationCancel from './registration-cancel';

const m = messages.gdpr.export;
let container: HTMLDivElement;
let root: Root;

const monta = (onCancellata = vi.fn()) => {
  act(() =>
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <RegistrationCancel
          token="tok"
          registrationId="r1"
          locale="it"
          onCancellata={onCancellata}
        />
      </NextIntlClientProvider>
    )
  );
  return onCancellata;
};
const pulsante = (nome: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === nome);
const clic = async (nome: string) => {
  await act(async () => {
    pulsante(nome)?.click();
  });
};
const scriviCodice = (valore: string) =>
  act(() => {
    const el = container.querySelector<HTMLInputElement>(
      'input[autocomplete="one-time-code"]'
    )!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      el,
      valore
    );
    el.dispatchEvent(new Event('input', { bubbles: true }));
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
  vi.unstubAllGlobals();
});

describe('RegistrationCancel', () => {
  it('dice cosa si cancella e cosa resta prima di chiedere il codice', async () => {
    const richiesta = vi.fn();
    vi.stubGlobal('fetch', richiesta);
    monta();
    await clic(m.cancelButton);
    expect(container.textContent).toContain(m.cancelDeletes);
    expect(container.textContent).toContain(m.cancelKeeps);
    expect(richiesta).not.toHaveBeenCalled();
    await clic(messages.common.cancel);
    expect(pulsante(m.cancelButton)).toBeDefined();
  });

  it('con il codice cancella e riporta le prove rimaste', async () => {
    const richiesta = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ issuedAt: 42 }), { status: 202 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ deleted: 1, consentProofsKept: 1 }), {
          status: 200,
        })
      );
    vi.stubGlobal('fetch', richiesta);
    const onCancellata = monta();
    await clic(m.cancelButton);
    await clic(m.codeSend);
    expect(pulsante(m.codeConfirmCancel)?.disabled).toBe(true);
    scriviCodice('123456');
    await clic(m.codeConfirmCancel);
    expect(
      richiesta.mock.calls.map((c) => JSON.parse((c[1] as { body: string }).body))
    ).toEqual([
      { token: 'tok', registrationId: 'r1', locale: 'it' },
      { token: 'tok', registrationId: 'r1', locale: 'it', code: '123456', issuedAt: 42 },
    ]);
    expect(onCancellata).toHaveBeenCalledWith(1);
  });

  it('troppe richieste lo dice', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 429 }))
    );
    const onCancellata = monta();
    await clic(m.cancelButton);
    await clic(m.codeSend);
    expect(container.textContent).toContain(m.rateLimited);
    expect(onCancellata).not.toHaveBeenCalled();
  });
});

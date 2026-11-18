// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

import RegistrationEdit from './registration-edit';

const m = messages.gdpr.export;
let container: HTMLDivElement;
let root: Root;

const monta = (quante = 1, onCorretta = vi.fn()) => {
  act(() =>
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <RegistrationEdit
          token="tok"
          registrationId="r1"
          displayName="Ana Bianchi"
          organization="Comune"
          quanteIscrizioni={quante}
          locale="it"
          onCorretta={onCorretta}
        />
      </NextIntlClientProvider>
    )
  );
  return onCorretta;
};
const pulsante = (nome: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === nome);
const clic = async (nome: string) => {
  await act(async () => {
    pulsante(nome)?.click();
  });
};
const scrivi = (el: HTMLInputElement, valore: string) =>
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )!.set!;
    setter.call(el, valore);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const campo = (etichetta: string) =>
  container.querySelector<HTMLInputElement>(
    `#${CSS.escape(
      [...container.querySelectorAll('label')].find((l) => l.textContent === etichetta)!
        .htmlFor
    )}`
  )!;
const corpi = (f: ReturnType<typeof vi.fn>) =>
  f.mock.calls.map((c) => JSON.parse((c[1] as { body: string }).body));

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

describe('RegistrationEdit', () => {
  it('prima il codice, poi la correzione con gli stessi valori e il codice', async () => {
    const richiesta = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ codeSent: true, issuedAt: 1700, expiresInMinutes: 15 }),
          {
            status: 202,
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            updated: 1,
            displayName: 'Anna Bianchi',
            organization: 'Comune',
          }),
          { status: 200 }
        )
      );
    vi.stubGlobal('fetch', richiesta);
    const onCorretta = monta();

    await clic(m.editButton);
    expect(container.textContent).toContain(m.editEffect);
    scrivi(campo(m.fieldName), 'Anna Bianchi');
    await clic(m.codeSend);
    expect(container.textContent).toContain('vale 15 minuti');
    // I campi restano fermi mentre si aspetta il codice: il codice vale per quelli.
    expect(campo(m.fieldName).disabled).toBe(true);

    scrivi(
      container.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')!,
      '04a2917'
    );
    await clic(m.codeConfirmEdit);

    const [primo, secondo] = corpi(richiesta);
    expect(primo).toEqual({
      token: 'tok',
      registrationId: 'r1',
      scope: 'registration',
      displayName: 'Anna Bianchi',
      organization: 'Comune',
      locale: 'it',
    });
    expect(secondo).toEqual({ ...primo, code: '042917', issuedAt: 1700 });
    expect(onCorretta).toHaveBeenCalledWith({
      displayName: 'Anna Bianchi',
      organization: 'Comune',
      scope: 'registration',
    });
    expect(container.textContent).toContain(m.editDone);
  });

  it('con piu’ iscrizioni si sceglie a quali vale', async () => {
    const richiesta = vi.fn(async () => new Response('{}', { status: 202 }));
    vi.stubGlobal('fetch', richiesta);
    monta(3);
    await clic(m.editButton);
    const tutte = [...container.querySelectorAll('label')].find((l) =>
      l.textContent?.startsWith('Tutte le mie iscrizioni (3)')
    )!;
    act(() => (document.getElementById(tutte.htmlFor) as HTMLInputElement).click());
    await clic(m.codeSend);
    expect(corpi(richiesta)[0]).toMatchObject({ scope: 'address' });
  });

  it('un codice sbagliato lo dice e lascia riprovare', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ issuedAt: 1 }), { status: 202 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ code: 'INVALID_CODE' }), { status: 403 })
        )
    );
    const onCorretta = monta();
    await clic(m.editButton);
    await clic(m.codeSend);
    scrivi(
      container.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')!,
      '111111'
    );
    await clic(m.codeConfirmEdit);
    expect(container.textContent).toContain(m.codeInvalid);
    expect(pulsante(m.codeConfirmEdit)).toBeDefined();
    expect(onCorretta).not.toHaveBeenCalled();
  });

  it('l’ente chiesto da un evento si segnala sul campo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: 'VALIDATION_ERROR',
              details: [{ path: ['organization'], message: 'x' }],
            }),
            { status: 422 }
          )
      )
    );
    monta();
    await clic(m.editButton);
    await clic(m.codeSend);
    expect(container.textContent).toContain(m.editOrganizationRequired);
    expect(campo(m.fieldOrganization).getAttribute('aria-invalid')).toBe('true');
  });
});

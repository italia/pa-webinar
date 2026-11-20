// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

import RegistrationNickname from './registration-nickname';

const m = messages.gdpr.export;
const n = messages.live.nickname;
let container: HTMLDivElement;
let root: Root;

const monta = (nickname: string | null, modificabile: boolean, onCambiato = vi.fn()) => {
  act(() =>
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <RegistrationNickname
          token="tok"
          registrationId="r1"
          nickname={nickname}
          modificabile={modificabile}
          locale="it"
          onCambiato={onCambiato}
        />
      </NextIntlClientProvider>
    )
  );
  return onCambiato;
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
const invia = async () => {
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
};
const corpi = (f: ReturnType<typeof vi.fn>) =>
  f.mock.calls.map((c) => JSON.parse((c[1] as { body: string }).body));
const json = (corpo: unknown, status: number) =>
  new Response(JSON.stringify(corpo), { status });

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

describe('RegistrationNickname', () => {
  it("senza nickname e dove l'evento non li accetta non mostra niente", () => {
    monta(null, false);
    expect(container.textContent).toBe('');
  });

  it('prima il codice, poi il salvataggio dello stesso nickname con il codice', async () => {
    const richiesta = vi
      .fn()
      .mockResolvedValueOnce(
        json({ codeSent: true, issuedAt: 1700, expiresInMinutes: 15 }, 202)
      )
      .mockResolvedValueOnce(json({ nickname: 'Lupo', updated: true }, 200));
    vi.stubGlobal('fetch', richiesta);
    const cambiato = monta(null, true);

    await clic(m.nicknameChoose);
    scrivi(container.querySelector('input')!, 'Lupo');
    await invia();
    const codice = container.querySelector<HTMLInputElement>(
      'input[autocomplete="one-time-code"]'
    )!;
    scrivi(codice, '123456');
    await clic(m.codeConfirmNickname);

    expect(corpi(richiesta)).toEqual([
      { token: 'tok', registrationId: 'r1', nickname: 'Lupo', locale: 'it' },
      {
        token: 'tok',
        registrationId: 'r1',
        nickname: 'Lupo',
        locale: 'it',
        code: '123456',
        issuedAt: 1700,
      },
    ]);
    expect(cambiato).toHaveBeenCalledWith('Lupo');
    expect(container.textContent).toContain(m.nicknameDone);
  });

  it('un rifiuto dice il motivo e propone l’alternativa', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({ code: 'NICKNAME_TAKEN', reason: 'taken', suggestion: 'Lupo2' }, 409)
      )
    );
    monta(null, true);
    await clic(m.nicknameChoose);
    scrivi(container.querySelector('input')!, 'Lupo');
    await invia();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      n.errors.taken
    );
    await clic(n.useSuggestion.replace('{suggestion}', 'Lupo2'));
    expect(container.querySelector('input')!.value).toBe('Lupo2');
  });

  it('a opzione spenta il nickname che c’e’ si toglie soltanto', async () => {
    const richiesta = vi
      .fn()
      .mockResolvedValueOnce(
        json({ codeSent: true, issuedAt: 1700, expiresInMinutes: 15 }, 202)
      );
    vi.stubGlobal('fetch', richiesta);
    monta('Lupo', false);
    await clic(n.remove);
    expect(container.querySelector('input')).toBeNull();
    await clic(n.remove);
    expect(corpi(richiesta)[0]).toMatchObject({ nickname: null });
  });
});

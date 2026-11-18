// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useNickname } from '@/hooks/use-nickname';
import messages from '@/i18n/messages/it.json';

import { NicknameDialog } from './nickname-field';

/**
 * La finestra della sala: il nickname nuovo si controlla e, solo se passa, la
 * sala chiede un ingresso nuovo. L'alternativa a un nickname occupato riempie il
 * campo, e si applica con il pulsante.
 */
const tn = messages.live.nickname;
let container: HTMLDivElement;
let root: Root;
let onApplica: ReturnType<typeof vi.fn<(n: string | null) => Promise<boolean>>>;
let fetchMock: ReturnType<typeof vi.fn>;

const risposta = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function Finestra({ inUso }: { inUso: string | null }) {
  const stato = useNickname({
    eventSlug: 'evento',
    eventId: 'ev-1',
    token: 'TOKEN',
    iniziale: inUso,
  });
  return (
    <NicknameDialog
      aperta
      onChiudi={() => {}}
      stato={stato}
      inUso={inUso}
      anonimo={false}
      onApplica={onApplica}
      container={container}
    />
  );
}

function render(inUso: string | null) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <Finestra inUso={inUso} />
      </NextIntlClientProvider>
    );
  });
}

const pulsante = (testo: string) => {
  const b = Array.from(document.querySelectorAll('button')).find((el) =>
    el.textContent?.includes(testo)
  );
  if (!b) throw new Error(`nessun pulsante «${testo}»`);
  return b as HTMLButtonElement;
};
const campo = () => document.querySelector<HTMLInputElement>('.wr-nickname input')!;
function scrivi(valore: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )?.set;
  act(() => {
    setter?.call(campo(), valore);
    campo().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function premi(b: HTMLElement) {
  await act(async () => {
    b.click();
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  onApplica = vi.fn(async () => true);
  fetchMock = vi.fn(async (_u: string, init: RequestInit) =>
    risposta(200, {
      nickname: (JSON.parse(String(init.body)) as { nickname: string | null }).nickname,
      saved: true,
    })
  );
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

describe('NicknameDialog', () => {
  it('applica un nickname nuovo: prima il controllo, poi il rientro', async () => {
    render('Pippo');
    expect(pulsante(tn.apply).disabled).toBe(true);
    scrivi('Pluto');
    await premi(pulsante(tn.apply));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onApplica).toHaveBeenCalledWith('Pluto');
  });

  it("un nickname rifiutato non fa rientrare; l'alternativa riempie il campo", async () => {
    fetchMock.mockResolvedValueOnce(
      risposta(409, { code: 'NICKNAME_TAKEN', reason: 'taken', suggestion: 'Pluto2' })
    );
    render(null);
    scrivi('Pluto');
    await premi(pulsante(tn.apply));
    expect(onApplica).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(tn.errors.taken);
    await premi(pulsante('Pluto2'));
    expect(campo().value).toBe('Pluto2');
    // Riempire il campo non salva niente: si applica con il pulsante.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('un rifiuto che non cambia riprovando lo dice, invece di invitare a riprovare', async () => {
    fetchMock.mockResolvedValueOnce(risposta(403, { code: 'NICKNAMES_DISABLED' }));
    render('Pippo');
    scrivi('Pluto');
    await premi(pulsante(tn.apply));
    expect(onApplica).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(tn.errors.disabled);
    expect(document.body.textContent).not.toContain(tn.errors.rete);
  });

  it('togliere il nickname fa rientrare senza', async () => {
    render('Pippo');
    await premi(pulsante(tn.remove));
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      body: JSON.stringify({ nickname: null }),
    });
    expect(onApplica).toHaveBeenCalledWith(null);
  });
});

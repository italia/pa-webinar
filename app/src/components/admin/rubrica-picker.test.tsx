// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

import RubricaPicker, { RubricaAccessContext } from './rubrica-picker';

/**
 * Il selettore della rubrica: cerca fra le voci con un indirizzo, consegna
 * l'email letta dalla voce, e sparisce per chi non puo' consultarla.
 */

const t = messages.admin.rubricaPicker;
const riga = (
  id: string,
  nome: string | null,
  email: string | null = `${id}@example.org`
) => ({
  id,
  displayName: nome,
  organization: 'Ente',
  organizationRole: null,
  organizationType: null,
  email,
});

let container: HTMLDivElement;
let root: Root;
const cerca = vi.fn();

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  cerca.mockReset();
  cerca.mockResolvedValue({
    ok: true,
    json: async () => ({ rows: [riga('p1', 'Persona 1')] }),
  });
  vi.stubGlobal('fetch', cerca);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function render(ui: React.ReactNode, accesso = true) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <RubricaAccessContext.Provider value={accesso}>
          {ui}
        </RubricaAccessContext.Provider>
      </NextIntlClientProvider>
    );
  });
}

async function scrivi(testo: string) {
  const campo = container.querySelector<HTMLInputElement>('input[role="combobox"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      campo,
      testo
    );
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  return campo;
}

const opzioni = () =>
  Array.from(container.querySelectorAll<HTMLElement>('[role="option"]'));

function scegli(opzione: HTMLElement) {
  act(() => {
    opzione.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    );
  });
}

describe('RubricaPicker', () => {
  it('senza accesso alla rubrica non si mostra e non cerca', () => {
    render(<RubricaPicker onSelect={vi.fn()} />, false);
    expect(container.innerHTML).toBe('');
    expect(cerca).not.toHaveBeenCalled();
  });

  it('chiede le voci con email, una ricerca sola dopo la pausa di battitura', async () => {
    render(<RubricaPicker onSelect={vi.fn()} />);
    await scrivi('ent');
    expect(cerca).toHaveBeenCalledTimes(1);
    const [url, opzioniFetch] = cerca.mock.calls[0]! as [string, RequestInit];
    // Il testo sta nel corpo: nell'URL finirebbe nei log di accesso.
    expect(url).toBe('/api/admin/rubrica');
    expect(opzioniFetch.method).toBe('POST');
    expect(JSON.parse(opzioniFetch.body as string)).toEqual({
      q: 'ent',
      limit: 8,
      withEmail: true,
    });
  });

  it('dice quando la ricerca non ha guardato tutte le voci', async () => {
    cerca.mockResolvedValue({
      ok: true,
      json: async () => ({ rows: [], scanLimit: 5000 }),
    });
    render(<RubricaPicker onSelect={vi.fn()} />);
    await scrivi('zzz');
    expect(container.textContent).toContain(
      messages.admin.rubrica.searchPartial.replace('{limit}', '5000')
    );
  });

  it('consegna nome, ente ed email della voce e ripulisce la ricerca', async () => {
    const onSelect = vi.fn();
    render(<RubricaPicker onSelect={onSelect} />);
    const campo = await scrivi('ent');
    scegli(opzioni()[0]!);
    expect(onSelect).toHaveBeenCalledWith({
      id: 'p1',
      displayName: 'Persona 1',
      organization: 'Ente',
      email: 'p1@example.org',
    });
    expect(campo.value).toBe('');
    expect(opzioni()).toHaveLength(0);
  });

  it('nessun risultato si dice, senza una lista vuota', async () => {
    cerca.mockResolvedValue({ ok: true, json: async () => ({ rows: [] }) });
    render(<RubricaPicker onSelect={vi.fn()} />);
    await scrivi('zzz');
    expect(container.textContent).toContain(t.noResults);
  });

  it('una risposta di errore svuota i risultati', async () => {
    cerca.mockResolvedValue({ ok: false, json: async () => ({}) });
    render(<RubricaPicker onSelect={vi.fn()} />);
    await scrivi('ent');
    expect(opzioni()).toHaveLength(0);
    expect(container.textContent).toContain(t.noResults);
  });

  it('un errore di rete svuota i risultati', async () => {
    cerca.mockRejectedValue(new Error('rete'));
    render(<RubricaPicker onSelect={vi.fn()} />);
    await scrivi('ent');
    expect(opzioni()).toHaveLength(0);
  });

  it('con la tastiera si scorre e si sceglie', async () => {
    cerca.mockResolvedValue({
      ok: true,
      json: async () => ({ rows: [riga('p1', 'Persona 1'), riga('p2', 'Persona 2')] }),
    });
    const onSelect = vi.fn();
    render(<RubricaPicker onSelect={onSelect} />);
    const campo = await scrivi('ent');
    const tasto = (key: string) =>
      act(() => {
        campo.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      });
    tasto('ArrowDown');
    tasto('Enter');
    expect(onSelect.mock.calls[0]![0]).toMatchObject({ id: 'p2' });
  });

  it('a scelta multipla raccoglie e consegna tutte le persone insieme', async () => {
    cerca.mockResolvedValue({
      ok: true,
      json: async () => ({ rows: [riga('p1', 'Persona 1'), riga('p2', 'Persona 2')] }),
    });
    const onAddMany = vi.fn();
    render(<RubricaPicker mode="multi" onAddMany={onAddMany} />);
    await scrivi('ent');
    scegli(opzioni()[0]!);
    scegli(opzioni()[1]!);
    const aggiungi = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes(t.addSelected)
    )!;
    act(() => {
      aggiungi.click();
    });
    expect(onAddMany.mock.calls[0]![0].map((p: { email: string }) => p.email)).toEqual([
      'p1@example.org',
      'p2@example.org',
    ]);
  });

  it('a scelta multipla una seconda scelta sulla stessa persona la toglie', async () => {
    const onAddMany = vi.fn();
    render(<RubricaPicker mode="multi" onAddMany={onAddMany} />);
    await scrivi('ent');
    scegli(opzioni()[0]!);
    scegli(opzioni()[0]!);
    expect(
      Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes(t.addSelected)
      )!.disabled
    ).toBe(true);
  });
});

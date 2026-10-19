import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

/**
 * La foto di una persona nel wizard: si sceglie un file, si ritaglia sempre
 * nel cerchio, il ritaglio va al server e il campo riceve l'id. Il ritaglio
 * vero disegna su un canvas, che qui non c'è: lo sostituisce un ritaglio che
 * conferma subito, e si verifica ciò che arriva (il formato del riquadro,
 * il file) e ciò che ne segue.
 */
const ritaglio = vi.hoisted(() => ({ ultimo: null as null | Record<string, unknown> }));
vi.mock('@/components/ui/image-crop-dialog', () => ({
  default: function RitaglioFinto(props: {
    ritaglio: Record<string, unknown>;
    onConferma: (f: File) => void;
    onAnnulla: () => void;
  }) {
    ritaglio.ultimo = props.ritaglio;
    return (
      <div role="dialog">
        <button
          type="button"
          onClick={() =>
            props.onConferma(
              new File([new Uint8Array([0xff, 0xd8, 0xff])], 'foto.jpg', {
                type: 'image/jpeg',
              })
            )
          }
        >
          conferma-ritaglio
        </button>
        <button type="button" onClick={props.onAnnulla}>
          annulla-ritaglio
        </button>
      </div>
    );
  },
}));

import PersonPhotoField, { PersonAvatar } from './person-photo-field';

const t = messages.admin.wizard.step3;
const FOTO = '11111111-1111-4111-8111-111111111111';
const fetchMock = vi.fn();

let container: HTMLDivElement;
let root: Root;

function disegna(children: ReactNode) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        {children}
      </NextIntlClientProvider>
    );
  });
}

function pulsante(testo: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === testo
  );
}

async function clic(el: HTMLElement | undefined) {
  if (!el) throw new Error('elemento non trovato');
  await act(async () => {
    el.click();
  });
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function scegli(tipo = 'image/png') {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('campo file non trovato');
  const file = new File([new Uint8Array([1])], 'ritratto.png', { type: tipo });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function risposta(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchMock.mockReset();
  ritaglio.ultimo = null;
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

describe('PersonPhotoField', () => {
  it('senza foto: le iniziali, l’aiuto e «Aggiungi la foto» collegato all’aiuto', () => {
    disegna(
      <PersonPhotoField id="p" name="Relatrice Uno" photoId={null} onChange={vi.fn()} />
    );
    expect(container.querySelector('.person-avatar--iniziali')?.textContent).toBe('RU');
    expect(container.textContent).toContain(t.personPhotoHelp);
    const aggiungi = pulsante(t.personPhotoAdd)!;
    const aiuto = document.getElementById(aggiungi.getAttribute('aria-describedby')!);
    expect(aiuto?.textContent).toBe(t.personPhotoHelp);
    expect(pulsante(t.personPhotoRemove)).toBeUndefined();
    // Il campo file non prende il fuoco: lo apre il pulsante.
    expect(container.querySelector('input[type="file"]')?.getAttribute('tabindex')).toBe(
      '-1'
    );
  });

  it('scelto il file, il ritaglio è sempre quadrato con il cerchio; confermato, la foto va al server', async () => {
    const onChange = vi.fn();
    fetchMock.mockResolvedValue(
      risposta(201, { id: FOTO, url: `/api/avatar/person/${FOTO}` })
    );
    disegna(
      <PersonPhotoField id="p" name="Relatrice Uno" photoId={null} onChange={onChange} />
    );

    await scegli();
    expect(ritaglio.ultimo).toMatchObject({
      rapporto: 1,
      larghezza: 400,
      forma: 'cerchio',
      nome: 'foto',
    });
    await clic(pulsante('conferma-ritaglio'));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/admin/person-photos');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('image/jpeg');
    expect(onChange).toHaveBeenCalledWith(FOTO);
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      t.personPhotoDone
    );
  });

  it('un ritaglio annullato non manda niente', async () => {
    disegna(
      <PersonPhotoField id="p" name="Relatrice Uno" photoId={null} onChange={vi.fn()} />
    );
    await scegli();
    await clic(pulsante('annulla-ritaglio'));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un formato che non è una foto si dice subito, senza ritaglio', async () => {
    disegna(
      <PersonPhotoField id="p" name="Relatrice Uno" photoId={null} onChange={vi.fn()} />
    );
    await scegli('image/gif');
    expect(ritaglio.ultimo).toBeNull();
    expect(container.textContent).toContain(t.personPhotoInvalid);
  });

  it.each([
    [413, t.personPhotoTooLarge],
    [422, t.personPhotoInvalid],
    [500, t.personPhotoFailed],
  ])('il server risponde %i: lo dice, e la foto non cambia', async (status, testo) => {
    const onChange = vi.fn();
    fetchMock.mockResolvedValue(risposta(status, { code: 'X' }));
    disegna(
      <PersonPhotoField id="p" name="Relatrice Uno" photoId={null} onChange={onChange} />
    );
    await scegli();
    await clic(pulsante('conferma-ritaglio'));
    expect(onChange).not.toHaveBeenCalled();
    expect(container.textContent).toContain(testo);
  });

  it('la rete cade: lo dice', async () => {
    fetchMock.mockRejectedValue(new TypeError('rete'));
    disegna(
      <PersonPhotoField id="p" name="Relatrice Uno" photoId={null} onChange={vi.fn()} />
    );
    await scegli();
    await clic(pulsante('conferma-ritaglio'));
    expect(container.textContent).toContain(t.personPhotoFailed);
  });

  it('con la foto: la mostra con il nome come testo alternativo, si cambia e si toglie', async () => {
    const onChange = vi.fn();
    disegna(
      <PersonPhotoField id="p" name="Relatrice Uno" photoId={FOTO} onChange={onChange} />
    );
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(`/api/avatar/person/${FOTO}`);
    expect(img.getAttribute('alt')).toBe(
      t.personPhotoAlt.replace('{name}', 'Relatrice Uno')
    );
    expect(pulsante(t.personPhotoChange)).toBeDefined();
    await clic(pulsante(t.personPhotoRemove));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('nella riga di una persona: solo i pulsanti, che dicono di chi è la foto', () => {
    disegna(
      <PersonPhotoField
        id="p"
        name="Relatrice Uno"
        photoId={FOTO}
        onChange={vi.fn()}
        compact
      />
    );
    expect(container.querySelector('img')).toBeNull();
    expect(pulsante(t.personPhotoChange)?.getAttribute('aria-label')).toBe(
      t.personPhotoChangeFor.replace('{name}', 'Relatrice Uno')
    );
    expect(pulsante(t.personPhotoRemove)?.getAttribute('aria-label')).toBe(
      t.personPhotoRemoveFor.replace('{name}', 'Relatrice Uno')
    );
  });

  it('senza sessione dello staff: la foto si vede e non si cambia', () => {
    disegna(
      <PersonPhotoField
        id="p"
        name="Relatrice Uno"
        photoId={FOTO}
        onChange={vi.fn()}
        readOnly
      />
    );
    expect(container.querySelector('img')).not.toBeNull();
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.textContent).toContain(t.personPhotoStaffOnly);

    disegna(
      <PersonPhotoField
        id="p"
        name="Relatrice Uno"
        photoId={FOTO}
        onChange={vi.fn()}
        readOnly
        compact
      />
    );
    expect(container.innerHTML).toBe('');
  });
});

describe('PersonAvatar', () => {
  it('accanto al nome la foto è decorativa; senza foto, le iniziali nascoste ai lettori di schermo', () => {
    disegna(<PersonAvatar name="Relatrice Uno" photoId={FOTO} />);
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('');
    disegna(<PersonAvatar name="Relatrice Uno" photoId={null} />);
    expect(container.querySelector('span')?.getAttribute('aria-hidden')).toBe('true');
  });
});

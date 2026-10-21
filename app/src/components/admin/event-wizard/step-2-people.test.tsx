import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';
import { RubricaAccessContext } from '@/components/admin/rubrica-picker';

/**
 * La persona nuova del passo Persone: la sua foto è della bozza. Mentre va al
 * server la persona non si aggiunge, e dopo ogni aggiunta la bozza riparte da
 * un campo foto nuovo: niente messaggio della foto di prima, e un caricamento
 * rimasto indietro non finisce sulla persona successiva. Il ritaglio vero
 * disegna su un canvas: lo sostituisce uno che conferma subito.
 */
vi.mock('@/components/ui/image-crop-dialog', () => ({
  default: function RitaglioFinto(props: { onConferma: (f: File) => void }) {
    return (
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
    );
  },
}));

import StepPeople, { type StepPeopleValue } from './step-2-people';

const t = messages.admin.wizard.step3;
const FOTO = '11111111-1111-4111-8111-111111111111';
const fetchMock = vi.fn();

let container: HTMLDivElement;
let root: Root;
let ultimo: StepPeopleValue;

function Passo() {
  const [value, setValue] = useState<StepPeopleValue>({
    organizers: [],
    moderators: [],
    speakers: [],
    invitations: [],
  });
  ultimo = value;
  return (
    <StepPeople
      value={value}
      onChange={(patch) => setValue((v) => ({ ...v, ...patch }))}
      primary={{
        name: 'Organizzatrice 1',
        email: 'org@example.test',
        organization: null,
        organizationLogoUrl: null,
        publicListed: false,
        photoId: null,
      }}
    />
  );
}

async function svuota() {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function pulsante(testo: string): HTMLButtonElement {
  const b = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (x) => x.textContent?.trim() === testo
  );
  if (!b) throw new Error(`pulsante «${testo}» non trovato`);
  return b;
}

/** Il pulsante «Aggiungi» della persona nuova (l'ultimo della sezione). */
function aggiungi(): HTMLButtonElement {
  const campo = document.getElementById('person-email')!;
  const sezione = campo.closest('.row')!;
  const tutti = Array.from(sezione.querySelectorAll<HTMLButtonElement>('button')).filter(
    (b) => b.textContent?.trim() === t.add
  );
  return tutti[tutti.length - 1]!;
}

function scrivi(id: string, valore: string) {
  const input = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )!.set!;
  act(() => {
    setter.call(input, valore);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function caricaFoto() {
  const input = document.getElementById('person-photo-file') as HTMLInputElement;
  const file = new File([new Uint8Array([1])], 'ritratto.png', { type: 'image/png' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => {
    pulsante('conferma-ritaglio').click();
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <RubricaAccessContext.Provider value={false}>
          <Passo />
        </RubricaAccessContext.Provider>
      </NextIntlClientProvider>
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('StepPeople — la foto della persona nuova', () => {
  it('mentre la foto va al server «Aggiungi» aspetta; arrivata, la persona la porta', async () => {
    let rispondi: (r: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise<Response>((r) => (rispondi = r)));
    scrivi('person-name', 'Relatrice Uno');
    scrivi('person-email', 'relatrice@example.test');
    await caricaFoto();

    expect(aggiungi().disabled).toBe(true);
    // Anche un clic che arriva comunque non aggiunge una persona senza foto.
    await act(async () => {
      aggiungi().click();
    });
    expect(ultimo.speakers).toEqual([]);

    await act(async () => {
      rispondi(
        new Response(JSON.stringify({ id: FOTO, url: `/api/avatar/person/${FOTO}` }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        })
      );
    });
    await svuota();
    expect(aggiungi().disabled).toBe(false);
    await act(async () => {
      aggiungi().click();
    });
    expect(ultimo.speakers).toEqual([
      expect.objectContaining({ name: 'Relatrice Uno', photoId: FOTO }),
    ]);
  });

  it('dopo l’aggiunta la bozza riparte senza foto e senza il messaggio della foto di prima', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: FOTO, url: `/api/avatar/person/${FOTO}` }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    );
    scrivi('person-name', 'Relatrice Uno');
    scrivi('person-email', 'relatrice@example.test');
    await caricaFoto();
    await svuota();
    const sezione = () => document.getElementById('person-email')!.closest('.row')!;
    expect(sezione().textContent).toContain(t.personPhotoDone);

    await act(async () => {
      aggiungi().click();
    });
    expect(ultimo.speakers[0]?.photoId).toBe(FOTO);
    // La bozza nuova: le iniziali vuote, nessun «Foto caricata».
    expect(sezione().textContent).not.toContain(t.personPhotoDone);
    expect(sezione().querySelector('img.person-avatar')).toBeNull();

    // La persona successiva non riceve la foto della prima.
    scrivi('person-name', 'Relatore Due');
    scrivi('person-email', 'relatore@example.test');
    await act(async () => {
      aggiungi().click();
    });
    expect(ultimo.speakers[1]).toMatchObject({ name: 'Relatore Due', photoId: null });
  });
});

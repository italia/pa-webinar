import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';
import { RubricaAccessContext } from '@/components/admin/rubrica-picker';

import StepPeople, { type StepPeopleValue } from './step-2-people';

/**
 * Il logo di un ente nel passo Persone: il caricamento dura qualche istante e
 * chi compila intanto scrive il sito. Alla fine il logo si aggiunge alla
 * bozza di quel momento: il sito scritto nel frattempo resta.
 */
const URL_LOGO = `${window.location.origin}/api/assets/image/2026/10/logo.png`;

class XhrFinto {
  static ultimo: XhrFinto | null = null;
  upload = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  responseText = '';
  constructor() {
    XhrFinto.ultimo = this;
  }
  open() {}
  send() {}
  abort() {
    this.onabort?.();
  }
}

let container: HTMLDivElement;
let root: Root;

/** Il valore del passo all'ultimo disegno, e chi riceve i file in viaggio. */
let valoreFinale: StepPeopleValue | null = null;
const occupato = vi.fn();

function Passo() {
  const [value, setValue] = useState<StepPeopleValue>({
    organizers: [],
    moderators: [],
    speakers: [],
    invitations: [],
  });
  valoreFinale = value;
  return (
    <StepPeople
      value={value}
      onChange={(patch) => setValue((v) => ({ ...v, ...patch }))}
      onUploadBusy={occupato}
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
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function scrivi(input: HTMLInputElement, valore: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )!.set!;
  act(() => {
    setter.call(input, valore);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  XhrFinto.ultimo = null;
  valoreFinale = null;
  occupato.mockReset();
  vi.stubGlobal('XMLHttpRequest', XhrFinto);
  URL.createObjectURL = () => 'blob:prova';
  URL.revokeObjectURL = () => {};
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

describe('StepPeople — il logo di un ente', () => {
  it('il sito scritto mentre il logo si carica non si perde', async () => {
    const selettore = document.querySelector<HTMLInputElement>(
      'input[type="file"][id^="org-logo-file-"]'
    );
    expect(selettore).not.toBeNull();
    const file = new File([new Uint8Array([1])], 'logo.png', { type: 'image/png' });
    Object.defineProperty(selettore!, 'files', { value: [file], configurable: true });
    await act(async () => {
      selettore!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await svuota();

    scrivi(document.getElementById('org-name') as HTMLInputElement, 'Ente di prova');
    scrivi(
      document.getElementById('org-web') as HTMLInputElement,
      'https://www.ente-di-prova.example'
    );

    const xhr = XhrFinto.ultimo!;
    act(() => {
      xhr.status = 200;
      xhr.responseText = JSON.stringify({
        url: URL_LOGO,
        key: 'assets/image/2026/10/logo.png',
        mime: 'image/png',
        size: 1,
        filename: 'logo.png',
      });
      xhr.onload?.();
    });
    await svuota();

    expect((document.getElementById('org-web') as HTMLInputElement).value).toBe(
      'https://www.ente-di-prova.example'
    );
    expect((document.getElementById('org-name') as HTMLInputElement).value).toBe(
      'Ente di prova'
    );
    // Il logo e' arrivato nella bozza: lo mostra la miniatura del campo.
    expect(
      document
        .querySelector('[data-testid="org-logo"] .campo-file__miniatura img')
        ?.getAttribute('src')
    ).toBe(URL_LOGO);
  });
});

/** Sceglie un file nel selettore nascosto del campo con quell'id. */
async function scegliLogo(prefisso: string) {
  const selettore = document.querySelector<HTMLInputElement>(
    `input[type="file"][id^="${prefisso}-file-"]`
  );
  if (!selettore) throw new Error(`nessun selettore ${prefisso}`);
  const file = new File([new Uint8Array([1])], 'logo.png', { type: 'image/png' });
  Object.defineProperty(selettore, 'files', { value: [file], configurable: true });
  await act(async () => {
    selettore.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await svuota();
}

async function arrivaLogo() {
  const xhr = XhrFinto.ultimo!;
  act(() => {
    xhr.status = 200;
    xhr.responseText = JSON.stringify({
      url: URL_LOGO,
      key: 'assets/image/2026/10/logo.png',
      mime: 'image/png',
      size: 1,
      filename: 'logo.png',
    });
    xhr.onload?.();
  });
  await svuota();
}

/** Il pulsante «Aggiungi» del modulo che contiene quel campo. */
function aggiungiAccanto(idCampo: string): HTMLButtonElement {
  const riga = document.getElementById(idCampo)!.closest('.row')!;
  return Array.from(riga.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === messages.admin.wizard.step3.add
  )!;
}

describe('StepPeople — «Aggiungi» aspetta il logo in viaggio', () => {
  it('una persona nuova non parte senza il suo logo, e il logo non passa alla persona dopo', async () => {
    scrivi(document.getElementById('person-name') as HTMLInputElement, 'Relatore 1');
    scrivi(document.getElementById('person-email') as HTMLInputElement, 'relatore1@example.test');
    await scegliLogo('person-logo');
    const aggiungi = aggiungiAccanto('person-name');
    expect(aggiungi.disabled).toBe(true);
    // Il wizard lo sa: non salva e non cambia passo.
    expect(occupato).toHaveBeenLastCalledWith(true);

    await arrivaLogo();
    expect(occupato).toHaveBeenLastCalledWith(false);
    expect(aggiungi.disabled).toBe(false);
    act(() => aggiungi.click());
    const persone = [...valoreFinale!.moderators, ...valoreFinale!.speakers];
    expect(persone).toHaveLength(1);
    expect(persone[0]!.organizationLogoUrl).toBe(URL_LOGO);
    // Il modulo della persona dopo riparte vuoto, anche nel logo.
    expect(
      document.querySelector('[data-testid="person-logo"] .campo-file__miniatura img')
    ).toBeNull();
  });

  it('un ente non parte senza il suo logo', async () => {
    scrivi(document.getElementById('org-name') as HTMLInputElement, 'Ente di prova');
    await scegliLogo('org-logo');
    const aggiungi = aggiungiAccanto('org-name');
    expect(aggiungi.disabled).toBe(true);
    act(() => aggiungi.click());
    expect(valoreFinale!.organizers).toHaveLength(0);

    await arrivaLogo();
    act(() => aggiungi.click());
    expect(valoreFinale!.organizers).toEqual([
      { name: 'Ente di prova', logoUrl: URL_LOGO, websiteUrl: null },
    ]);
    // Il campo segue il modulo azzerato: il logo di prima non resta in vista.
    expect(
      document.querySelector('[data-testid="org-logo"] .campo-file__miniatura img')
    ).toBeNull();
  });
});

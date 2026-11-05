import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

import ConsentsDialog, { type ConsensiInSala } from './consents-dialog';

/**
 * «I tuoi consensi» in sala: mostra solo i consensi che l'evento chiede, dice
 * cosa succede prima di agire, e il ritiro chiede una conferma.
 */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

const azioni = () => ({
  onChiudi: vi.fn(),
  onAcconsentiRegistrazione: vi.fn(),
  onAcconsentiTrascrizione: vi.fn(),
  onRitira: vi.fn(),
});

async function disegna(
  consensi: ConsensiInSala,
  a = azioni(),
  extra: { inCorso?: boolean; errore?: boolean } = {}
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <ConsentsDialog
          aperta
          consensi={consensi}
          inCorso={false}
          errore={false}
          {...a}
          {...extra}
        />
      </NextIntlClientProvider>
    );
  });
  return a;
}

const pulsante = (testo: RegExp) =>
  [...document.querySelectorAll('button')].find((b) =>
    testo.test(b.textContent ?? '')
  ) as HTMLButtonElement | undefined;
const clic = async (b: HTMLElement | undefined) => {
  expect(b).toBeDefined();
  await act(async () => b!.click());
};

describe('ConsentsDialog', () => {
  it('ritirare la registrazione chiede conferma e dice che si resta in solo ascolto', async () => {
    const a = await disegna({
      registrazione: { dato: true, ritiro: 'soloAscolto' },
      trascrizione: { dato: true, serveRegistrazione: false },
    });
    expect(document.body.textContent).toContain(
      messages.live.consents.recording.withdraw.soloAscolto
    );
    expect(document.body.textContent).toContain(
      messages.live.consents.recording.alreadyRecorded
    );
    const ritira = [...document.querySelectorAll('button')].filter(
      (b) => b.textContent === messages.live.consents.withdraw
    );
    expect(ritira).toHaveLength(2);
    await clic(ritira[0]);
    expect(a.onRitira).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(messages.live.consents.confirmTitle);
    await clic(pulsante(new RegExp(`^${messages.live.consents.confirm}$`)));
    expect(a.onRitira).toHaveBeenCalledWith(true);
  });

  it('ritirare solo la trascrizione; «Annulla» non ritira', async () => {
    const a = await disegna({ trascrizione: { dato: true, serveRegistrazione: false } });
    expect(document.body.textContent).not.toContain(
      messages.live.consents.recording.title
    );
    await clic(pulsante(new RegExp(`^${messages.live.consents.withdraw}$`)));
    await clic(pulsante(new RegExp(`^${messages.common.cancel}$`)));
    expect(a.onRitira).not.toHaveBeenCalled();
    await clic(pulsante(new RegExp(`^${messages.live.consents.withdraw}$`)));
    await clic(pulsante(new RegExp(`^${messages.live.consents.confirm}$`)));
    expect(a.onRitira).toHaveBeenCalledWith(false);
  });

  it("dare il consenso e' un clic; la trascrizione aspetta la registrazione", async () => {
    const a = await disegna({
      registrazione: { dato: false, ritiro: 'soloAscolto' },
      trascrizione: { dato: false, serveRegistrazione: true },
    });
    expect(document.body.textContent).toContain(
      messages.live.consents.recording.without.soloAscolto
    );
    expect(document.body.textContent).toContain(
      messages.live.consents.transcription.needsRecording
    );
    expect(
      pulsante(new RegExp(messages.live.consents.transcription.give))!.disabled
    ).toBe(true);
    await clic(pulsante(new RegExp(messages.live.consents.recording.give)));
    expect(a.onAcconsentiRegistrazione).toHaveBeenCalledTimes(1);
  });

  it("chi conduce: il ritiro non lo toglie dalla sala, e nessun avviso sul video gia' registrato", async () => {
    await disegna({ registrazione: { dato: true, ritiro: 'conduce' } });
    expect(document.body.textContent).toContain(
      messages.live.consents.recording.withdraw.conduce
    );
    expect(document.body.textContent).not.toContain(
      messages.live.consents.recording.alreadyRecorded
    );
  });

  it("durante l'aggiornamento i pulsanti sono fermi; un errore si annuncia", async () => {
    await disegna(
      { trascrizione: { dato: false, serveRegistrazione: false } },
      azioni(),
      { inCorso: true, errore: true }
    );
    expect(
      pulsante(new RegExp(messages.live.consents.transcription.give))!.disabled
    ).toBe(true);
    expect(document.querySelector('[role="status"]')!.textContent).toBe(
      messages.live.consents.working
    );
    expect(document.querySelector('[role="alert"]')!.textContent).toBe(
      messages.live.consents.error
    );
  });
});

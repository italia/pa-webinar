import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';
import type { ControlloRegistrazione } from '@/hooks/use-recording-control';

import ClosingNotice from './closing-notice';
import LiveTimeStrip from './live-time-strip';

const MIN = 60_000;
const ORA = Date.UTC(2026, 9, 9, 10, 0);

const registrazione: ControlloRegistrazione = {
  azionabile: true,
  bloccato: false,
  inPausa: false,
  avvia: vi.fn(),
  ferma: vi.fn(),
  avviso: '',
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(ORA);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
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

function render(ui: React.ReactNode) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        {ui}
      </NextIntlClientProvider>,
    );
  });
  // L'orologio parte al primo effetto.
  act(() => {
    vi.advanceTimersByTime(1000);
  });
}

function strip(over: Partial<React.ComponentProps<typeof LiveTimeStrip>> = {}) {
  return (
    <LiveTimeStrip
      startsAt={new Date(ORA - 30 * MIN).toISOString()}
      endsAt={new Date(ORA + 60 * MIN).toISOString()}
      graceMinutes={60}
      recordingEnabled
      isRecording={false}
      recordingStartedAt={null}
      avvioOsservato={null}
      faseRegistratore={null}
      registrazione={registrazione}
      eventSlug="evento"
      onApriRegia={vi.fn()}
      {...over}
    />
  );
}

describe('LiveTimeStrip', () => {
  it('in onda: tempo trascorso, avanzamento e minuti alla fine', () => {
    render(strip());
    expect(container.textContent).toContain('In onda');
    expect(container.textContent).toContain('mancano 59 minuti');
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('33');
  });

  it('prima dell’orario d’inizio si è in onda, e dice quando inizia', () => {
    render(strip({ startsAt: new Date(ORA + 20 * MIN).toISOString() }));
    expect(container.textContent).toContain('In onda');
    expect(container.textContent).toContain('fra 19 minuti');
    expect(container.querySelector('.live-time-strip__onair strong')).toBeNull();
  });

  it('nel primo minuto oltre la fine non dice «0 minuti»', () => {
    render(strip({ endsAt: new Date(ORA - 20_000).toISOString() }));
    expect(container.textContent).toContain('fuori orario da meno di un minuto');
  });

  it('le fasi seguono l’ora del server, non quella del computer', () => {
    // Fine alle 10:00:30 del server; il computer è indietro di due minuti.
    render(strip({ endsAt: new Date(ORA + 30_000).toISOString(), scartoOrologio: 2 * MIN }));
    expect(container.querySelector('.live-time-strip--over, .live-time-strip--closing')).not.toBeNull();
  });

  it('la durata della registrazione è sull’ora del server', () => {
    // Il server è 40 secondi avanti: l'avvio, 10 minuti fa per il server,
    // si misura con l'ora del server, non con quella del computer.
    render(
      strip({
        isRecording: true,
        recordingStartedAt: new Date(ORA - 10 * MIN + 40_000).toISOString(),
        scartoOrologio: 40_000,
      }),
    );
    expect(container.querySelector('.live-time-strip__rec--on')?.textContent).toContain('10:01');
  });

  it('una chiamata istantanea non ha barra né fine', () => {
    render(strip({ istantanea: true }));
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(container.textContent).not.toContain('mancano');
  });

  it('a chiusura raggiunta lo dice, senza «fra 0 minuti»', () => {
    render(strip({ endsAt: new Date(ORA - 60 * MIN).toISOString(), startsAt: new Date(ORA - 120 * MIN).toISOString() }));
    expect(container.textContent).toContain('la sala si sta chiudendo');
    expect(container.textContent).not.toContain('fra 0');
  });

  it('scarta l’ora del server se è di una registrazione precedente', () => {
    render(
      strip({
        isRecording: true,
        recordingStartedAt: new Date(ORA - 50 * MIN).toISOString(),
        avvioOsservato: ORA - 2 * MIN,
      }),
    );
    const rec = container.querySelector('.live-time-strip__rec--on');
    expect(rec?.textContent).toContain('02:01');
  });

  it('usa l’ora del server quando è coerente (chi entra dopo)', () => {
    render(strip({ isRecording: true, recordingStartedAt: new Date(ORA - 10 * MIN).toISOString() }));
    expect(container.querySelector('.live-time-strip__rec--on')?.textContent).toContain('10:01');
  });

  it('l’avviso del registratore si vede nella striscia', () => {
    render(strip({ registrazione: { ...registrazione, avviso: 'La registrazione non è partita.' } }));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('La registrazione non è partita.');
  });
});

describe('ClosingNotice', () => {
  it('compare solo negli ultimi minuti prima della chiusura automatica', () => {
    render(
      <ClosingNotice
        startsAt={new Date(ORA - 120 * MIN).toISOString()}
        endsAt={new Date(ORA - 20 * MIN).toISOString()}
        graceMinutes={60}
      />,
    );
    expect(container.textContent).toBe('');

    render(
      <ClosingNotice
        startsAt={new Date(ORA - 120 * MIN).toISOString()}
        endsAt={new Date(ORA - 55 * MIN).toISOString()}
        graceMinutes={60}
      />,
    );
    expect(container.textContent).toContain('fra 5 minuti');
  });

  it('senza tetto non avvisa mai', () => {
    render(
      <ClosingNotice
        startsAt={new Date(ORA - 300 * MIN).toISOString()}
        endsAt={new Date(ORA - 200 * MIN).toISOString()}
        graceMinutes={-1}
      />,
    );
    expect(container.textContent).toBe('');
  });
});

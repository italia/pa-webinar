// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';
import {
  ISTANZA_PREDEFINITA,
  type CapacitaIstanza,
  type InputCapacita,
} from '@/lib/capacity/model';

import CapacityPanel, { RigaCapacita, type CapacityPanelProps } from './capacity-panel';

/**
 * Il pannello della capacita': si ricalcola a ogni scelta (webcam accese,
 * qualita', permessi), dice il carico del ponte con un livello e un
 * suggerimento, i ponti veri dell'istanza, e in sola lettura non cambia niente.
 */

const m = messages.admin.form.jvbPreview;

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
  vi.useRealTimers();
});

const istanza: CapacitaIstanza = {
  ...ISTANZA_PREDEFINITA,
  coresPerBridge: 15,
  instanceBridges: 1,
  numLoudest: 5,
};

const riunione: InputCapacita = {
  maxParticipants: 40,
  expectedSenderRatioPct: null,
  participantsCanStartVideo: true,
  participantsCanUnmute: true,
  presenters: 1,
  videoQuality: 'HIGH',
  recordingEnabled: true,
  liveCaptionsEnabled: false,
  durationHours: 1.5,
};

function mostra(props: Partial<CapacityPanelProps> = {}) {
  const onCameraPctChange = vi.fn();
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <CapacityPanel
          istanza={istanza}
          evento={riunione}
          participantsCanShareScreen
          onCameraPctChange={onCameraPctChange}
          {...props}
        />
      </NextIntlClientProvider>
    );
  });
  return onCameraPctChange;
}

/** Il pannello con la quota di webcam nello stato, come nel wizard. */
function Controllato({ evento }: { evento: InputCapacita }) {
  const [quota, setQuota] = useState(evento.expectedSenderRatioPct);
  return (
    <CapacityPanel
      istanza={istanza}
      evento={{ ...evento, expectedSenderRatioPct: quota }}
      participantsCanShareScreen
      onCameraPctChange={setQuota}
    />
  );
}

function mostraControllato(evento: InputCapacita = riunione) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <Controllato evento={evento} />
      </NextIntlClientProvider>
    );
  });
}

const valori = () =>
  Array.from(container.querySelectorAll('.capacita__valore')).map((n) => n.textContent);
const radio = () =>
  Array.from(container.querySelectorAll<HTMLInputElement>('input[type=radio]'));
const scegli = (valore: string) =>
  act(() =>
    radio()
      .find((r) => r.value === valore)
      ?.click()
  );

describe('CapacityPanel', () => {
  it('le webcam accese cambiano quanto riceve chi guarda e quanto manda ciascuno', () => {
    mostraControllato();
    const sito = valori();
    scegli('100');
    const tutte = valori();
    expect(tutte[0]).not.toBe(sito[0]);
    // Solo chi presenta: in primo piano, e chi ha la webcam manda di piu'.
    scegli('0');
    const presentatori = valori();
    expect(presentatori[0]).not.toBe(tutte[0]);
    expect(presentatori[1]).not.toBe(sito[1]);
  });

  it('una qualita diversa cambia la stima', () => {
    mostra();
    const alta = valori()[0];
    mostra({ evento: { ...riunione, videoQuality: 'SAVE_DATA' } });
    expect(valori()[0]).not.toBe(alta);
    expect(container.textContent).toContain('Risparmio dati (360p)');
  });

  it('dice i ponti dell istanza, non il tetto per evento del sito', () => {
    mostra();
    const riga = container.querySelector('.capacita__istanza')?.textContent ?? '';
    expect(riga).toContain('1 ponte da 15 core');
    expect(riga).not.toContain('6');
  });

  it('i profili scelgono la quota; «Come il sito» la riporta al sito', () => {
    const onChange = mostra({ evento: { ...riunione, expectedSenderRatioPct: 10 } });
    expect(radio().find((r) => r.checked)?.value).toBe('10');
    scegli('50');
    expect(onChange).toHaveBeenLastCalledWith(50);
    scegli('sito');
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('un valore salvato fuori dai profili e un «Altro valore» che si scrive', () => {
    const onChange = mostra({ evento: { ...riunione, expectedSenderRatioPct: 15 } });
    expect(radio().find((r) => r.checked)?.value).toBe('altro');
    const campo = container.querySelector<HTMLInputElement>('input[type=number]');
    expect(campo?.value).toBe('15');
    expect(container.querySelector(`label[for="${campo?.id}"]`)?.textContent).toBe(
      m.customLabel
    );
    act(() => {
      const set = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set;
      set?.call(campo, '140');
      campo?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith(100);
  });

  it('«Altro valore» resta scelto anche partendo da un profilo', () => {
    mostraControllato({ ...riunione, expectedSenderRatioPct: 50 });
    scegli('altro');
    expect(radio().find((r) => r.checked)?.value).toBe('altro');
    expect(container.querySelector<HTMLInputElement>('input[type=number]')?.value).toBe(
      '50'
    );
  });

  it('senza webcam dei partecipanti la scelta si spegne e conta chi presenta', () => {
    mostra({ evento: { ...riunione, participantsCanStartVideo: false, presenters: 3 } });
    expect(container.querySelector('fieldset')).toBeDisabled();
    expect(radio().some((r) => r.checked)).toBe(false);
    expect(container.textContent).toContain('contano solo le 3 persone che presentano');
  });

  it('il risultato si annuncia una volta, dopo una pausa, e non all apertura', () => {
    vi.useFakeTimers();
    mostraControllato();
    const regione = () => container.querySelector('[aria-live=polite]');
    act(() => vi.advanceTimersByTime(1000));
    expect(regione()?.textContent).toBe('');
    scegli('100');
    expect(regione()?.textContent).toBe('');
    act(() => vi.advanceTimersByTime(1000));
    expect(regione()?.textContent).toMatch(
      /^Stima aggiornata: circa .* per chi guarda, ponte al .*%\.$/
    );
  });

  it('il livello si dice a parole, con un suggerimento per scendere sotto la soglia', () => {
    mostra({
      evento: {
        ...riunione,
        maxParticipants: 150,
        expectedSenderRatioPct: 100,
        recordingEnabled: false,
      },
    });
    expect(container.querySelector('.capacita__livello')?.textContent).toBe(
      m.level.attenzione
    );
    expect(container.textContent).toContain(m.levelText.attenzione);
    expect(container.textContent).toContain('qualità video «Bilanciata»');
    expect(container.textContent).toContain('Spegnere metà delle webcam non aiuta');
    // La barra e' solo a vista: il valore lo dice la frase.
    expect(
      container.querySelector('.capacita__barra')?.closest('[aria-hidden=true]')
    ).not.toBeNull();
  });

  it('con i ponti collegati dice quanti ne userebbe', () => {
    mostra({
      istanza: { ...istanza, cascading: true, instanceBridges: 6 },
      evento: { ...riunione, maxParticipants: 1000, participantsCanStartVideo: false },
    });
    expect(container.textContent).toMatch(/L'evento userà \d+ ponti collegati/);
    expect(container.textContent).toContain(m.instanceCascade);
  });

  it('registrazione e sottotitoli hanno una scheda solo se accesi', () => {
    const schede = () =>
      Array.from(container.querySelectorAll('.capacita__scheda .capacita__titolo')).map(
        (n) => n.textContent
      );
    mostra();
    expect(schede()).toEqual([m.recordingTitle]);
    expect(container.textContent).toContain('da 2,6 a 6,6 GB per 1 ora e 30 minuti');
    mostra({
      istanza: { ...istanza, captionsAvailable: true },
      evento: { ...riunione, liveCaptionsEnabled: true, recordingEnabled: false },
    });
    expect(schede()).toEqual([m.captionsTitle]);
    expect(container.textContent).toContain('Sottotitoli: sì');
  });

  it('le ipotesi della stima, senza chiavi mancanti in nessun caso', () => {
    mostra();
    const ipotesi = container.querySelector('.capacita__come')?.textContent ?? '';
    expect(ipotesi).toContain('fino a 10 in tutto');
    const casi: Array<Partial<CapacityPanelProps>> = [
      {},
      { evento: { ...riunione, videoQuality: 'SAVE_DATA', durationHours: null } },
      { evento: { ...riunione, videoQuality: 'MAX', expectedSenderRatioPct: 100 } },
      {
        evento: { ...riunione, maxParticipants: 1000, participantsCanStartVideo: false },
      },
      {
        evento: {
          ...riunione,
          maxParticipants: 30,
          videoQuality: 'SAVE_DATA',
          expectedSenderRatioPct: 100,
        },
        istanza: { ...istanza, coresPerBridge: 2 },
      },
      {
        istanza: { ...istanza, cascading: true, instanceBridges: 2 },
        evento: { ...riunione, maxParticipants: 3000 },
      },
      {
        istanza: { ...istanza, numLoudest: 0, captionsAvailable: true },
        evento: { ...riunione, liveCaptionsEnabled: true },
      },
      {
        solaLettura: true,
        iscritti: 0,
        evento: { ...riunione, participantsCanStartVideo: false },
      },
    ];
    for (const caso of casi) {
      mostra(caso);
      expect(container.textContent).not.toMatch(/admin\.form|\{|\}/);
    }
  });

  it('«Cambia» porta alla qualita', () => {
    const qualita = vi.fn();
    mostra({ onCambiaQualita: qualita });
    act(() =>
      container
        .querySelector<HTMLButtonElement>(`button[aria-label="${m.changeQuality}"]`)
        ?.click()
    );
    expect(qualita).toHaveBeenCalledTimes(1);
  });

  it('in sola lettura mostra le scelte salvate senza cambiarle', () => {
    mostra({
      solaLettura: true,
      iscritti: 12,
      evento: { ...riunione, expectedSenderRatioPct: 50 },
      onCambiaQualita: vi.fn(),
      modifica: <span data-modifica>{m.readOnlyChange}</span>,
    });
    expect(container.querySelector('fieldset')).toBeNull();
    expect(container.querySelector('[aria-live]')).toBeNull();
    expect(container.querySelector(`button[aria-label="${m.changeQuality}"]`)).toBeNull();
    expect(container.textContent).toContain('Webcam accese: Metà · 50%');
    expect(container.textContent).toContain('12 iscritti finora');
    expect(container.querySelector('.capacita__modifica [data-modifica]')).not.toBeNull();
  });

  it('in sola lettura, con piu iscritti che attesi, stima sugli iscritti', () => {
    mostra({
      solaLettura: true,
      iscritti: 60,
      evento: { ...riunione, maxParticipants: 40 },
    });
    expect(container.textContent).toContain('la stima conta i 60 iscritti');
  });
});

describe('RigaCapacita', () => {
  function riga(livello: 'ampio' | 'attenzione', onDettagli?: () => void) {
    act(() => {
      root.render(
        <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
          <RigaCapacita
            capacita={{ carico: 0.6, livello, downMbps: 3.95 }}
            onDettagli={onDettagli}
          />
        </NextIntlClientProvider>
      );
    });
  }

  it('dice carico, livello e banda; da «attenzione» in su e un avviso', () => {
    const dettagli = vi.fn();
    riga('attenzione', dettagli);
    const p = container.querySelector('.capacita__riepilogo');
    expect(p?.textContent).toContain(
      'Capacità: ponte video al 60% (Attenzione) · circa 4 Mbps per chi guarda'
    );
    expect(p?.classList.contains('capacita__riepilogo--avviso')).toBe(true);
    act(() => container.querySelector<HTMLButtonElement>('button')?.click());
    expect(dettagli).toHaveBeenCalledTimes(1);
  });

  it('con margine ampio e una riga informativa', () => {
    riga('ampio');
    const p = container.querySelector('.capacita__riepilogo');
    expect(p?.classList.contains('capacita__riepilogo--avviso')).toBe(false);
    expect(container.querySelector('button')).toBeNull();
  });
});

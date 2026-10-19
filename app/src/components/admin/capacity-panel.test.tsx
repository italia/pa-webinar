// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';
import { DEFAULT_JVB_CONFIG, jvbsForEvent } from '@/lib/jvb-sizing';

import CapacityPanel, {
  capacityWarnings,
  type CapacityPanelProps,
} from './capacity-panel';

/**
 * Il pannello della capacita': i numeri sono quelli dello scaler, la quota di
 * chi parla si sceglie fra i profili, e gli avvisi sono quelli del riepilogo.
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
});

function mostra(props: Partial<CapacityPanelProps> = {}) {
  const onSenderRatioChange = vi.fn();
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <CapacityPanel
          maxParticipants={100}
          senderRatioPct={null}
          onSenderRatioChange={onSenderRatioChange}
          videoEnabled
          defaultSenderRatioPct={30}
          sizingConfig={DEFAULT_JVB_CONFIG}
          recordingEnabled
          participantsCanUnmute
          participantsCanShareScreen
          startsAt="2026-10-20T10:00"
          endsAt="2026-10-20T11:30"
          {...props}
        />
      </NextIntlClientProvider>
    );
  });
  return onSenderRatioChange;
}

const numeri = () =>
  Array.from(container.querySelectorAll('.capacita__numero')).map((n) => n.textContent);

describe('CapacityPanel', () => {
  it('divide chi parla da chi ascolta e conta i ponti come lo scaler', () => {
    mostra();
    expect(numeri()).toEqual([
      '30',
      String(jvbsForEvent(100, 30, true, DEFAULT_JVB_CONFIG)),
      '70',
    ]);
    expect(container.textContent).toContain('1 h 30 min');
    expect(container.textContent).toContain('Spazio per la registrazione');
  });

  it('un profilo scelto cambia la quota; «Valore del sito» la riporta al sito', () => {
    const onChange = mostra({ senderRatioPct: 5 });
    const radio = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type=radio]')
    );
    expect(radio.find((r) => r.checked)?.value).toBe('5');
    act(() => radio.find((r) => r.value === '60')?.click());
    expect(onChange).toHaveBeenLastCalledWith(60);
    act(() => radio.find((r) => r.value === 'sito')?.click());
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('una quota salvata fuori dai profili resta scelta e si vede', () => {
    mostra({ senderRatioPct: 15 });
    const scelto = container.querySelector<HTMLInputElement>('input[type=radio]:checked');
    expect(scelto?.value).toBe('15');
    expect(scelto?.closest('label')?.textContent).toContain(
      messages.admin.form.jvbPreview.customValue
    );
    expect(numeri()[0]).toBe('15');
  });

  it('provato un profilo, la quota personalizzata resta fra le scelte', () => {
    mostra({ senderRatioPct: 15 });
    mostra({ senderRatioPct: 5 });
    const valori = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type=radio]')
    ).map((r) => r.value);
    expect(valori).toContain('15');
    expect(
      container.querySelector<HTMLInputElement>('input[type=radio]:checked')?.value
    ).toBe('5');
  });

  it('una quota fuori dai profili arrivata dopo (bozza ripresa) diventa una scelta', () => {
    mostra({ senderRatioPct: null });
    mostra({ senderRatioPct: 45 });
    expect(
      container.querySelector<HTMLInputElement>('input[type=radio]:checked')?.value
    ).toBe('45');
  });

  it('il risultato di una scelta si annuncia', () => {
    mostra();
    expect(container.querySelector('[aria-live=polite]')?.textContent).toMatch(
      /ponte video, carico stimato/
    );
  });

  it('con il video spento nessuno parla e i profili non si scelgono', () => {
    mostra({ videoEnabled: false });
    expect(numeri()[0]).toBe('0');
    expect(container.querySelector('fieldset')).toBeDisabled();
    expect(container.textContent).toContain(messages.admin.form.jvbPreview.videoDisabled);
  });

  it('oltre la capacita lo dice, e la barra resta nel suo bordo', () => {
    mostra({ maxParticipants: 2000, senderRatioPct: 100 });
    expect(container.textContent).toContain(messages.admin.form.jvbPreview.loadOver);
    const larghezze = Array.from(
      container.querySelectorAll<HTMLElement>('.capacita__parte')
    ).map((p) => parseFloat(p.style.width));
    expect(larghezze.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5);
  });
});

describe('capacityWarnings', () => {
  const base = {
    maxParticipants: 150,
    senderRatioPct: null,
    videoEnabled: true,
    defaultSenderRatioPct: 30,
    sizingConfig: DEFAULT_JVB_CONFIG,
  };

  it('chiede la quota per un evento grande che la eredita dal sito', () => {
    expect(capacityWarnings(base).shouldWarnInherited).toBe(true);
    expect(capacityWarnings({ ...base, senderRatioPct: 5 }).shouldWarnInherited).toBe(
      false
    );
    expect(capacityWarnings({ ...base, maxParticipants: 50 }).shouldWarnInherited).toBe(
      false
    );
  });

  it('avvisa quando i ponti sono al tetto', () => {
    expect(
      capacityWarnings({ ...base, maxParticipants: 5000, senderRatioPct: 100 }).atCeiling
    ).toBe(true);
    expect(capacityWarnings(base).atCeiling).toBe(false);
  });
});

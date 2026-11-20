// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';
import { aggregaCatalogo, type RigaCatalogo } from '@/lib/analytics/catalog-stats';

import CatalogStatsPanel from './catalog-stats-panel';

const t = messages.admin.analytics.catalog;
const tc = messages.admin.catalog;

let container: HTMLDivElement;
let root: Root;

const MESI = ['2026-10', '2026-11'];

const riga = (campi: Partial<RigaCatalogo>): RigaCatalogo => ({
  eventType: 'SCHEDULED',
  formatClass: null,
  templateId: null,
  templateName: null,
  templateCurrentName: null,
  startsAt: new Date('2026-11-10T10:00:00Z'),
  peakParticipants: 0,
  sessions: 0,
  durationSec: null,
  ...campi,
});

function disegna(righe: RigaCatalogo[], onMonthsChange = vi.fn()) {
  const catalog = {
    ...aggregaCatalogo(righe, MESI, 'Europe/Rome'),
    timezone: 'Europe/Rome',
  };
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <CatalogStatsPanel
          catalog={catalog}
          months={12}
          onMonthsChange={onMonthsChange}
        />
      </NextIntlClientProvider>
    );
  });
  return onMonthsChange;
}

function pulsante(testo: string): HTMLButtonElement {
  const b = Array.from(container.querySelectorAll('button')).find(
    (el) => el.textContent?.trim() === testo
  );
  if (!b) throw new Error(`nessun pulsante «${testo}»`);
  return b;
}

/** Le intestazioni delle righe della prima tabella, cioe' la classifica. */
function classifica(): string[] {
  const tabella = container.querySelector('table');
  return Array.from(tabella?.querySelectorAll('tbody th') ?? []).map(
    (th) => th.textContent ?? ''
  );
}

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

describe('il catalogo nelle statistiche', () => {
  it('i tipi dal piu ricorrente, solo quelli con eventi, e le medie degli eventi tenuti', () => {
    disegna([
      riga({
        formatClass: 'PUBLIC',
        sessions: 1,
        peakParticipants: 120,
        durationSec: 5400,
      }),
      riga({ formatClass: 'PUBLIC' }),
      riga({ eventType: 'INSTANT', sessions: 1, peakParticipants: 4, durationSec: 900 }),
    ]);
    expect(classifica()).toEqual([tc.types.PUBLIC, tc.types.INSTANT]);
    const prima = container.querySelector('table tbody tr')!;
    expect(prima.textContent).toContain('120');
    expect(prima.textContent).toContain('90');
    // Nessun evento non catalogato: la nota non c'e'.
    expect(container.textContent).not.toContain(t.uncatalogedNote.split(':')[0]);
  });

  it('per modello: il nome, i cancellati col nome di allora, chi non ne ha', () => {
    disegna([
      riga({
        templateId: 'tpl-1',
        templateCurrentName: 'Corso',
        formatClass: 'PARTICIPATORY',
      }),
      riga({
        templateId: 'tpl-1',
        templateCurrentName: 'Corso',
        formatClass: 'PARTICIPATORY',
      }),
      riga({ templateName: 'Vecchio', formatClass: 'MEETING' }),
      riga({}),
    ]);
    click(pulsante(t.groupBy.template));
    expect(classifica()).toEqual([
      'Corso',
      t.deletedTemplate.replace('{name}', 'Vecchio'),
      tc.noTemplate,
    ]);
    // Un evento senza tipo: la nota dice quanti e dove si catalogano.
    expect(container.textContent).toContain(
      t.uncatalogedNote.replace('{count}', '1').split(':')[0]
    );
  });

  it('mese per mese, una misura alla volta', () => {
    disegna([
      riga({ formatClass: 'MEETING', startsAt: new Date('2026-10-05T10:00:00Z') }),
      riga({
        formatClass: 'MEETING',
        sessions: 1,
        peakParticipants: 6,
        durationSec: 1800,
      }),
    ]);
    const mensile = () => container.querySelectorAll('table')[1]!;
    const celle = () =>
      Array.from(mensile().querySelectorAll('tbody tr:first-child td')).map(
        (td) => td.textContent
      );
    expect(celle()).toEqual(['1', '1', '2']);

    const misura = container.querySelector<HTMLSelectElement>('#catalogo-misura')!;
    act(() => {
      misura.value = 'avgParticipants';
      misura.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // In ottobre nessun evento tenuto: niente media.
    expect(celle()).toEqual(['—', '6', '6']);
  });

  it('il periodo si sceglie in mesi', () => {
    const cambia = disegna([]);
    expect(container.textContent).toContain(t.empty);
    click(pulsante('6 mesi'));
    expect(cambia).toHaveBeenCalledWith(6);
  });
});

function click(el: HTMLElement) {
  act(() => {
    el.click();
  });
}

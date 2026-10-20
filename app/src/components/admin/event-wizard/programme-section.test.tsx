import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import messages from '@/i18n/messages/it.json';

import ProgrammeSection from './programme-section';
import type { AgendaDraft } from './programme-plan';

/**
 * Gli orari del programma nel passo «Persone»: contano solo le righe con un
 * titolo, come nel salvataggio, nel riepilogo e nella pagina pubblica.
 */
const sp = messages.admin.wizard.step3;

let container: HTMLDivElement;
let root: Root;
let n = 0;

const riga = (label: string, minutes = ''): AgendaDraft => ({
  key: `r${++n}`,
  label,
  minutes,
  speakerKey: null,
});

/** Un evento dalle 10 alle 10:45, nel fuso di Roma. */
function disegna(agenda: AgendaDraft[]) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <ProgrammeSection
          value={{
            agenda,
            agendaEnabled: true,
            startsAt: '2026-10-29T10:00',
            endsAt: '2026-10-29T10:45',
            timezone: 'Europe/Rome',
            moderatorName: 'Chi organizza',
            moderatorPublicListed: true,
            moderators: [],
            speakers: [],
          }}
          onChange={() => {}}
        />
      </NextIntlClientProvider>
    );
  });
}

const ore = () =>
  Array.from(container.querySelectorAll('.wizard-programma__ora')).map(
    (o) => o.textContent
  );
const totale = () =>
  container.querySelector('.wizard-programma__totale')?.textContent ?? '';

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

describe('ProgrammeSection: orari e totale', () => {
  it('una riga vuota in fondo non toglie il totale né l’avviso di sforamento', () => {
    disegna([riga('Uno', '10'), riga('Due', '20'), riga('Tre', '30'), riga('')]);
    expect(ore()).toEqual(['10:00', '10:10', '10:30', '–']);
    expect(totale()).toContain('1 ora');
    expect(totale()).toContain('fino alle 11:00');
    // Il programma salvato va oltre la fine di 15 minuti: lo dice.
    expect(totale()).toContain('15 minuti');
    expect(totale()).not.toContain(sp.programTotalPartial);
  });

  it('una riga vuota in mezzo non ferma gli orari dopo, e non dice che manca una durata', () => {
    disegna([riga('Uno', '10'), riga('  ', '30'), riga('Due', '20')]);
    expect(ore()).toEqual(['10:00', '–', '10:10']);
    const vuota = container.querySelectorAll('.wizard-programma__ora')[1]!;
    expect(vuota.textContent).not.toContain(sp.programTimeUnknown);
    expect(vuota.querySelector('[title]')).toBeNull();
    expect(totale()).toContain('fino alle 10:30');
  });

  it('un argomento senza durata ferma gli orari dopo, e lo dice', () => {
    disegna([riga('Uno', '10'), riga('Due'), riga('Tre', '15')]);
    const celle = container.querySelectorAll('.wizard-programma__ora');
    expect(celle[0]!.textContent).toBe('10:00');
    expect(celle[1]!.textContent).toBe('10:10');
    expect(celle[2]!.textContent).toContain(sp.programTimeUnknown);
    expect(totale()).toContain(sp.programTotalPartial);
  });

  it('solo righe vuote: nessun totale', () => {
    disegna([riga('')]);
    expect(container.querySelector('.wizard-programma__totale')).toBeNull();
  });
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import messages from '@/i18n/messages/it.json';
import type { VoceProgramma } from '@/lib/agenda/programme';

import EventProgramme from './event-programme';

/**
 * Il programma della pagina pubblica: un elenco ordinato con l'ora di ogni
 * argomento, chi interviene, la durata, e in diretta l'argomento in corso.
 */
const VOCI: VoceProgramma[] = [
  {
    id: 'a1',
    label: 'Apertura',
    plannedMinutes: 10,
    status: 'DONE',
    speaker: {
      name: 'Anna Rinaldi',
      organization: 'Ente A',
      photoUrl: '/api/avatar/person/f1',
    },
  },
  {
    id: 'a2',
    label: 'Intervento',
    plannedMinutes: null,
    status: 'CURRENT',
    speaker: { name: 'Luca Neri', organization: null, photoUrl: null },
  },
  { id: 'a3', label: 'Domande', plannedMinutes: 15, status: 'PENDING', speaker: null },
];
const INIZIO = new Date('2030-03-05T09:00:00.000Z');

let container: HTMLDivElement;
let root: Root;

function disegna(live: boolean, voci = VOCI) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <EventProgramme items={voci} startsAt={INIZIO} live={live} />
      </NextIntlClientProvider>
    );
  });
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

describe('EventProgramme', () => {
  it('un elenco ordinato, con l’ora finche’ si conosce, chi interviene e la durata', () => {
    disegna(false);
    const ol = container.querySelector('ol')!;
    expect(ol.getAttribute('role')).toBe('list');
    // Un titolo per la sezione, nessuno per argomento.
    expect(container.querySelectorAll('h2, h3, h4')).toHaveLength(1);
    const ore = Array.from(container.querySelectorAll('time')).map((t) => [
      t.textContent,
      t.getAttribute('datetime'),
    ]);
    // Dopo l'argomento senza durata l'ora non si sa piu'.
    expect(ore).toEqual([
      ['10:00', '2030-03-05T09:00:00.000Z'],
      ['10:10', '2030-03-05T09:10:00.000Z'],
    ]);
    const voci = Array.from(container.querySelectorAll('li'));
    expect(voci[0]?.textContent).toContain('Anna Rinaldi');
    expect(voci[0]?.textContent).toContain('Ente A');
    expect(voci[0]?.textContent).toContain('10 min');
    expect(voci[0]?.querySelector('img')?.getAttribute('alt')).toBe('');
    // Senza foto, le iniziali (decorative).
    expect(voci[1]?.querySelector('[aria-hidden="true"]')?.textContent).toBe('LN');
    // Fuori dalla diretta nessun argomento e' «in corso».
    expect(container.querySelector('[aria-current]')).toBeNull();
    expect(container.textContent).not.toContain(messages.events.detail.programme.now);
    // Non ogni argomento ha una durata: la nota non dice un totale.
    expect(container.querySelector('.event-programma__nota')?.textContent).toBe(
      messages.events.detail.programme.note
    );
  });

  it('in diretta l’argomento in corso lo dice, anche alle tecnologie assistive', () => {
    disegna(true);
    const adesso = container.querySelector('[aria-current="time"]')!;
    expect(adesso.textContent).toContain('Intervento');
    expect(adesso.textContent).toContain(messages.events.detail.programme.now);
    expect(container.querySelectorAll('[aria-current]')).toHaveLength(1);
    expect(
      container.querySelector('.event-programma__voce--passata')?.textContent
    ).toContain('Apertura');
  });

  it('con tutte le durate la nota dice quanto dura il programma', () => {
    disegna(
      false,
      VOCI.map((v) => ({ ...v, plannedMinutes: 30 }))
    );
    expect(container.querySelector('.event-programma__nota')?.textContent).toContain(
      '1 ora e 30 minuti'
    );
  });

  it('senza argomenti non disegna niente', () => {
    disegna(false, []);
    expect(container.innerHTML).toBe('');
  });
});

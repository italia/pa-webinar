import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import messages from '@/i18n/messages/it.json';
import { MAX_AGENDA_ITEMS } from '@/lib/agenda/status';

import StepProgramma, { type ProgrammaPatch } from './programme-section';
import type { AgendaDraft } from './programme-plan';
import type { ModeratorEntry, SpeakerEntry } from './step-2-people';

/**
 * Il passo «Programma»: gli orari (contano solo le righe con un titolo, come
 * nel salvataggio, nel riepilogo e nella pagina pubblica), le persone da cui
 * partire, la persona nuova aggiunta da qui e cio' che il passo dice.
 */
const sp = messages.admin.wizard.step3;
const tp = messages.admin.wizard.programme;

let container: HTMLDivElement;
let root: Root;
let n = 0;

const riga = (label: string, minutes = '', speakerKey: string | null = null): AgendaDraft => ({
  key: `r${++n}`,
  label,
  minutes,
  speakerKey,
});

const relatore = (name: string, email: string, publicListed = false): SpeakerEntry => ({
  name,
  email,
  personId: null,
  organization: null,
  organizationLogoUrl: null,
  publicListed,
  photoId: null,
});

type Valore = Parameters<typeof StepProgramma>[0]['value'];

/** Un evento dalle 10 alle 10:45, nel fuso di Roma. */
function valore(over: Partial<Valore> = {}): Valore {
  return {
    agenda: [],
    agendaEnabled: true,
    startsAt: '2026-10-29T10:00',
    endsAt: '2026-10-29T10:45',
    timezone: 'Europe/Rome',
    moderatorName: 'Chi organizza',
    moderatorEmail: 'chi@example.org',
    moderatorPublicListed: true,
    moderators: [] as ModeratorEntry[],
    speakers: [] as SpeakerEntry[],
    ...over,
  };
}

/** Il valore come lo tiene il wizard, dopo ogni modifica del passo. */
let ultimo: Valore;

function Contenitore({ iniziale, locked }: { iniziale: Valore; locked?: boolean }) {
  const [v, setV] = useState(iniziale);
  ultimo = v;
  return (
    <StepProgramma
      value={v}
      locked={locked}
      onChange={(patch: ProgrammaPatch) => setV((prima) => ({ ...prima, ...patch }))}
    />
  );
}

function disegna(iniziale: Valore, locked = false) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <Contenitore iniziale={iniziale} locked={locked} />
      </NextIntlClientProvider>
    );
  });
}

const ore = () =>
  Array.from(container.querySelectorAll('.wizard-programma__ora')).map((o) => o.textContent);
const totale = () => container.querySelector('.wizard-programma__totale')?.textContent ?? '';
const annuncio = () =>
  container.querySelector('p.visually-hidden[role="status"]')?.textContent?.trim() ?? '';

function pulsante(testo: string): HTMLButtonElement {
  const b = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (el) => el.textContent?.trim() === testo || el.getAttribute('aria-label') === testo
  );
  if (!b) throw new Error(`nessun pulsante «${testo}»`);
  return b;
}

function click(el: HTMLElement) {
  act(() => {
    el.click();
  });
}

function scrivi(el: HTMLInputElement, testo: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(el, testo);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function campo(etichetta: string): HTMLInputElement {
  const label = Array.from(container.querySelectorAll('label')).find(
    (l) => l.textContent?.trim() === etichetta
  );
  const el = label && container.querySelector<HTMLInputElement>(`#${CSS.escape(label.htmlFor)}`);
  if (!el) throw new Error(`nessun campo «${etichetta}»`);
  return el;
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

describe('StepProgramma: orari e totale', () => {
  it('una riga vuota in fondo non toglie il totale né l’avviso di sforamento', () => {
    disegna(valore({ agenda: [riga('Uno', '10'), riga('Due', '20'), riga('Tre', '30'), riga('')] }));
    expect(ore()).toEqual(['10:00', '10:10', '10:30', '–']);
    expect(totale()).toContain('1 ora');
    expect(totale()).toContain('fino alle 11:00');
    // Il programma salvato va oltre la fine di 15 minuti: lo dice.
    expect(totale()).toContain('15 minuti');
    expect(totale()).not.toContain(sp.programTotalPartial);
  });

  it('una riga vuota in mezzo non ferma gli orari dopo, e non dice che manca una durata', () => {
    disegna(valore({ agenda: [riga('Uno', '10'), riga('  ', '30'), riga('Due', '20')] }));
    expect(ore()).toEqual(['10:00', '–', '10:10']);
    const vuota = container.querySelectorAll('.wizard-programma__ora')[1]!;
    expect(vuota.textContent).not.toContain(sp.programTimeUnknown);
    expect(vuota.querySelector('[title]')).toBeNull();
    expect(totale()).toContain('fino alle 10:30');
  });

  it('un argomento senza durata ferma gli orari dopo, e lo dice', () => {
    disegna(valore({ agenda: [riga('Uno', '10'), riga('Due'), riga('Tre', '15')] }));
    const celle = container.querySelectorAll('.wizard-programma__ora');
    expect(celle[0]!.textContent).toBe('10:00');
    expect(celle[1]!.textContent).toBe('10:10');
    expect(celle[2]!.textContent).toContain(sp.programTimeUnknown);
    expect(totale()).toContain(sp.programTotalPartial);
  });

  it('solo righe vuote: nessun totale', () => {
    disegna(valore({ agenda: [riga('')] }));
    expect(container.querySelector('.wizard-programma__totale')).toBeNull();
  });

  it('senza argomenti lo dice, e l’introduzione dice da che ora partono', () => {
    disegna(valore());
    expect(container.textContent).toContain(tp.empty);
    expect(container.textContent).toContain(tp.intro.replace('{start}', '10:00'));
  });
});

describe('StepProgramma: dalle persone', () => {
  const persone = {
    speakers: [relatore('Anna Rossi', 'anna@example.org'), relatore('Bruno Bianchi', 'bruno@example.org')],
  };

  it('un pulsante per persona, organizzatore principale compreso; chi non ha ancora un intervento si dice', () => {
    disegna(valore(persone));
    const nomi = Array.from(container.querySelectorAll('.wizard-programma__persona-nome')).map(
      (el) => el.textContent
    );
    expect(nomi).toEqual(['Chi organizza', 'Anna Rossi', 'Bruno Bianchi']);
    expect(pulsante('Aggiungi un intervento di Anna Rossi')).toBeTruthy();
    expect(container.textContent).toContain('Ancora senza intervento: Anna Rossi e Bruno Bianchi.');
  });

  it('«+ Intervento» aggiunge una riga con la persona, porta il fuoco al suo argomento e lo dice', () => {
    disegna(valore({ ...persone, agenda: [riga('Apertura', '15', 'primary')] }));
    click(pulsante('Aggiungi un intervento di Anna Rossi'));
    expect(ultimo.agenda).toHaveLength(2);
    expect(ultimo.agenda[1]!.speakerKey).toBe('e:anna@example.org');
    expect(document.activeElement?.id).toBe('wiz-programma-1-titolo');
    expect(annuncio()).toBe('Aggiunto un intervento di Anna Rossi alle 10:15.');
    // Conta quando l'argomento ha un titolo, come nel salvataggio.
    expect(container.textContent).toContain('Ancora senza intervento: Anna Rossi e Bruno Bianchi.');
    scrivi(container.querySelector<HTMLInputElement>('#wiz-programma-1-titolo')!, 'Il servizio');
    expect(container.textContent).toContain('Ancora senza intervento: Bruno Bianchi.');
  });

  it('la riga vuota appena aggiunta si usa, invece di lasciarne una in piu’', () => {
    disegna(valore({ ...persone, agenda: [riga('Apertura', '15'), riga('')] }));
    click(pulsante('Aggiungi un intervento di Bruno Bianchi'));
    expect(ultimo.agenda).toHaveLength(2);
    expect(ultimo.agenda[1]!.speakerKey).toBe('e:bruno@example.org');
    expect(document.activeElement?.id).toBe('wiz-programma-1-titolo');
  });

  it('ad agenda spenta e senza argomenti, il primo intervento la accende e lo dice', () => {
    disegna(valore({ ...persone, agendaEnabled: false }));
    expect(container.textContent).toContain(tp.statusOff);
    click(pulsante('Aggiungi un intervento di Anna Rossi'));
    expect(ultimo.agendaEnabled).toBe(true);
    expect(annuncio()).toContain(tp.turnedOn);
    expect(container.textContent).toContain(tp.statusOn);
  });

  it('anche un argomento aggiunto a mano accende l’agenda', () => {
    disegna(valore({ agendaEnabled: false }));
    click(pulsante(sp.programAdd));
    expect(ultimo.agendaEnabled).toBe(true);
    expect(document.activeElement?.id).toBe('wiz-programma-0-titolo');
  });

  it('spenta, gli argomenti scritti si leggono soltanto e lo si dice; aggiungerne uno la riaccende', () => {
    disegna(valore({ agendaEnabled: false, agenda: [riga('Uno', '10')] }));
    expect(container.querySelector<HTMLInputElement>('#wiz-programma-0-titolo')?.readOnly).toBe(true);
    expect(container.querySelector<HTMLSelectElement>('#wiz-programma-0-chi')?.disabled).toBe(true);
    expect(container.querySelector('.wizard-programma__comandi')).toBeNull();
    // In modifica resta il programma dell'ultimo salvataggio.
    expect(container.textContent).toContain(tp.offKeptEdit);
    click(pulsante(sp.programAdd));
    expect(ultimo.agendaEnabled).toBe(true);
    expect(ultimo.agenda).toHaveLength(2);
    expect(container.querySelector<HTMLInputElement>('#wiz-programma-0-titolo')?.readOnly).toBe(false);
  });

  it('«Accendi» accende l’agenda e prepara la prima riga', () => {
    disegna(valore({ agendaEnabled: false }));
    click(pulsante(tp.turnOn));
    expect(ultimo.agendaEnabled).toBe(true);
    expect(ultimo.agenda).toHaveLength(1);
    expect(document.activeElement?.id).toBe('wiz-programma-0-titolo');
  });

  it('«Incolla un elenco» dopo «Aggiungi un argomento» non lascia una riga vuota in mezzo', () => {
    disegna(valore({ agenda: [riga('Apertura', '10')] }));
    click(pulsante(sp.programAdd));
    click(pulsante(sp.programPaste));
    const testo = container.querySelector<HTMLTextAreaElement>('.wizard-programma__incolla textarea')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    act(() => {
      setter?.call(testo, 'Uno\nDue');
      testo.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(pulsante('Aggiungi 2 argomenti'));
    expect(ultimo.agenda.map((v) => v.label)).toEqual(['Apertura', 'Uno', 'Due']);
    expect(document.activeElement?.id).toBe('wiz-programma-1-titolo');
  });

  it('«Incolla un elenco» sostituisce la riga appena aggiunta solo se e’ intatta', () => {
    disegna(valore({ agenda: [riga('', '15')] }));
    click(pulsante(sp.programPaste));
    const testo = container.querySelector<HTMLTextAreaElement>('.wizard-programma__incolla textarea')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    act(() => {
      setter?.call(testo, 'Uno\nDue');
      testo.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(pulsante('Aggiungi 2 argomenti'));
    expect(ultimo.agenda.map((v) => [v.label, v.minutes])).toEqual([
      ['', '15'],
      ['Uno', ''],
      ['Due', ''],
    ]);
  });

  it('senza persone dell’evento lo dice', () => {
    disegna(valore());
    expect(container.textContent).toContain(tp.noPeople);
  });

  it('il modulo della persona nuova, aperto prima di arrivare al massimo, non aggiunge oltre', () => {
    const quasi = Array.from({ length: MAX_AGENDA_ITEMS - 1 }, (_, i) => riga(`A${i}`, '1'));
    disegna(valore({ ...persone, agenda: quasi }));
    click(pulsante(tp.newPerson));
    click(pulsante('Aggiungi un intervento di Anna Rossi'));
    expect(ultimo.agenda).toHaveLength(MAX_AGENDA_ITEMS);
    expect(pulsante(tp.newPersonAssign).disabled).toBe(true);
  }, 15_000);

  it('al numero massimo di argomenti pulsanti e persone non aggiungono piu’', () => {
    const piene = Array.from({ length: MAX_AGENDA_ITEMS }, (_, i) => riga(`A${i}`, '1'));
    disegna(valore({ ...persone, agenda: piene }));
    expect(pulsante('Aggiungi un intervento di Anna Rossi').disabled).toBe(true);
    expect(pulsante(tp.newPerson).disabled).toBe(true);
    expect(pulsante(sp.programAdd).disabled).toBe(true);
    expect(pulsante(sp.programPaste).disabled).toBe(true);
  });
});

describe('StepProgramma: una persona nuova', () => {
  function apri() {
    click(pulsante(tp.newPerson));
    expect(pulsante(tp.newPerson).getAttribute('aria-expanded')).toBe('true');
  }
  const errore = () => container.querySelector('[role="alert"]')?.textContent ?? '';

  it('nome ed email servono; l’email deve essere valida e non gia’ usata, organizzatore principale compreso', () => {
    disegna(valore({ speakers: [relatore('Anna Rossi', 'anna@example.org')] }));
    apri();
    expect(document.activeElement).toBe(campo(`${sp.personName} *`));
    click(pulsante(tp.newPersonAssign));
    expect(errore()).toBe(sp.personRequired);
    expect(campo(`${sp.personName} *`).getAttribute('aria-invalid')).toBe('true');

    scrivi(campo(`${sp.personName} *`), 'Carla Verdi');
    scrivi(campo(`${sp.personEmail} *`), 'non-una-email');
    click(pulsante(tp.newPersonAssign));
    expect(errore()).toBe(sp.invalidEmail);

    scrivi(campo(`${sp.personEmail} *`), 'ANNA@example.org');
    click(pulsante(tp.newPersonAssign));
    expect(errore()).toBe(sp.duplicateEmail);

    scrivi(campo(`${sp.personEmail} *`), 'chi@example.org');
    click(pulsante(tp.newPersonAssign));
    expect(errore()).toBe(sp.duplicateEmail);
    expect(ultimo.speakers).toHaveLength(1);
    expect(ultimo.agenda).toHaveLength(0);
  });

  it('aggiunta: entra fra i relatori, non presentata, con un argomento suo; il fuoco va all’argomento e lo dice', () => {
    disegna(valore({ agenda: [riga('Apertura', '10', 'primary')] }));
    apri();
    scrivi(campo(`${sp.personName} *`), 'Carla Verdi');
    scrivi(campo(`${sp.personEmail} *`), 'Carla@Example.org');
    scrivi(campo(sp.personOrganization), 'Comune di Esempio');
    click(pulsante(tp.newPersonAssign));

    expect(ultimo.speakers).toEqual([
      {
        name: 'Carla Verdi',
        email: 'carla@example.org',
        personId: null,
        organization: 'Comune di Esempio',
        organizationLogoUrl: null,
        publicListed: false,
        photoId: null,
      },
    ]);
    expect(ultimo.agenda.map((v) => v.speakerKey)).toEqual(['primary', 'e:carla@example.org']);
    expect(container.querySelector('.wizard-programma__nuova')).toBeNull();
    expect(document.activeElement?.id).toBe('wiz-programma-1-titolo');
    expect(annuncio()).toBe("Carla Verdi è fra le persone dell'evento e interviene sull'argomento 2.");
  });

  it('«Annulla» chiude il modulo e riporta il fuoco al pulsante', () => {
    disegna(valore());
    apri();
    click(pulsante(messages.common.cancel));
    expect(container.querySelector('.wizard-programma__nuova')).toBeNull();
    expect(document.activeElement).toBe(pulsante(tp.newPerson));
  });
});

describe('StepProgramma: chi interviene non presentato', () => {
  it('lo dice per nome, e «Mostra il nome nella pagina» lo presenta', () => {
    disegna(
      valore({
        speakers: [relatore('Anna Rossi', 'anna@example.org', false)],
        agenda: [riga('Intervento', '20', 'e:anna@example.org')],
      })
    );
    const nota = "Anna Rossi non compare nella pagina pubblica: nel programma si vede solo l'argomento.";
    expect(container.textContent).toContain(nota);
    expect(
      container.querySelector('#wiz-programma-0-chi')?.getAttribute('aria-describedby')
    ).toBe('wiz-programma-0-nascosto');
    click(pulsante(tp.makePublic));
    expect(ultimo.speakers[0]!.publicListed).toBe(true);
    expect(container.textContent).not.toContain(nota);
    expect(document.activeElement?.id).toBe('wiz-programma-0-chi');
    expect(annuncio()).toBe('Anna Rossi ora compare nella pagina pubblica.');
  });

  it('per l’organizzatore principale cambia la sua scelta', () => {
    disegna(valore({ moderatorPublicListed: false, agenda: [riga('Apertura', '10', 'primary')] }));
    click(pulsante(tp.makePublic));
    expect(ultimo.moderatorPublicListed).toBe(true);
  });
});

describe('StepProgramma: agenda gia’ usata in sala', () => {
  it('si legge soltanto: niente persone da aggiungere, ne’ comandi', () => {
    disegna(
      valore({
        speakers: [relatore('Anna Rossi', 'anna@example.org', false)],
        agenda: [riga('Intervento', '20', 'e:anna@example.org')],
      }),
      true
    );
    expect(container.textContent).toContain(sp.programFrozen);
    expect(container.querySelector('.wizard-programma__persone')).toBeNull();
    expect(container.querySelector('.wizard-programma__comandi')).toBeNull();
    expect(() => pulsante(sp.programAdd)).toThrow();
    expect(() => pulsante(tp.makePublic)).toThrow();
    expect(container.querySelector<HTMLInputElement>('#wiz-programma-0-titolo')?.readOnly).toBe(true);
  });
});

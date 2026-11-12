// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

import EventPeopleSummary, { type PersonaConcessa } from './event-people-summary';

let container: HTMLDivElement;
let root: Root;

function render(props: {
  moderatorName?: string | null;
  eventModerators?: PersonaConcessa[];
  invitationCount?: number;
  onPeople?: () => void;
}) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <EventPeopleSummary
          moderatorName={props.moderatorName ?? null}
          eventModerators={props.eventModerators ?? []}
          invitationCount={props.invitationCount ?? 0}
          onPeople={props.onPeople ?? (() => {})}
        />
      </NextIntlClientProvider>
    );
  });
}

/** Le righe dell'elenco come «etichetta: valore». */
function righe(): string[] {
  return [...container.querySelectorAll('dl > div')].map((r) => r.textContent ?? '');
}

const summary = messages.admin.wizard.step5.summary;

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

const persona = (
  id: string,
  name: string,
  role: 'MODERATOR' | 'SPEAKER',
  extra: Partial<PersonaConcessa> = {}
): PersonaConcessa => ({ id, name, role, organizer: false, revokedAt: null, ...extra });

describe('persone dell evento nella panoramica — chi lo ha creato le ritrova', () => {
  it('gli stessi gruppi del riepilogo del wizard, e il numero di inviti', () => {
    render({
      moderatorName: 'Organizzatrice',
      eventModerators: [
        persona('a', 'Laura Bianchi', 'SPEAKER'),
        persona('b', 'Paolo Verdi', 'MODERATOR'),
        persona('c', 'Anna Rossi', 'MODERATOR', { organizer: true }),
      ],
      invitationCount: 2,
    });
    expect(righe()).toEqual([
      `${summary.primaryOrganizer}:Organizzatrice`,
      `${summary.organizersPeople}:Anna Rossi`,
      `${summary.moderators}:Paolo Verdi`,
      `${summary.speakers}:Laura Bianchi`,
      `${summary.invitations}:2`,
    ]);
  });

  it('le persone non mostrate nella pagina pubblica ci sono lo stesso', () => {
    // La panoramica non guarda «Mostra nella pagina pubblica»: e' la
    // ragione per cui esiste.
    render({ eventModerators: [persona('a', 'Laura Bianchi', 'SPEAKER')] });
    expect(righe()).toEqual([`${summary.speakers}:Laura Bianchi`]);
  });

  it('una concessione revocata non compare, e i nomi escono senza spazi ai lati', () => {
    render({
      moderatorName: ' Organizzatrice ',
      eventModerators: [
        persona('b', 'Paolo Verdi', 'MODERATOR', {
          revokedAt: '2026-11-12T09:00:00.000Z',
        }),
        persona('c', '  Carla Neri ', 'MODERATOR'),
        persona('d', '   ', 'SPEAKER'),
      ],
    });
    expect(righe()).toEqual([
      `${summary.primaryOrganizer}:Organizzatrice`,
      `${summary.moderators}:Carla Neri`,
    ]);
  });

  it('senza nessuno non dice niente', () => {
    render({ moderatorName: '  ' });
    expect(container.querySelector('[data-testid="event-people-summary"]')).toBeNull();
  });

  it('il pulsante apre la scheda Persone', () => {
    const onPeople = vi.fn();
    render({ invitationCount: 1, onPeople });
    const pulsante = container.querySelector('button')!;
    expect(pulsante.textContent).toBe(
      messages.admin.eventDetail.peopleTabLink.replace(
        '{tab}',
        messages.admin.eventDetail.tabs.people
      )
    );
    act(() => pulsante.click());
    expect(onPeople).toHaveBeenCalledTimes(1);
  });
});

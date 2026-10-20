import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EMAIL_LOCALES } from '@/lib/email/lingua';

import { icsSequence } from './generate';
import {
  calendarInvite,
  escapeIcsText,
  foldIcsLine,
  generateEventInvitation,
  invitationUid,
  type EventInvitationInput,
} from './invitation';

/**
 * L'invito personale che Gmail e Outlook mostrano come «aggiungi / accetta»:
 * METHOD:REQUEST, chi lo riceve come ATTENDEE, il suo link in LOCATION, URL
 * e DESCRIPTION, UID stabile per persona, ora locale con la sua VTIMEZONE.
 */

const EVENT_ID = '5aa07b6c-1111-4111-8111-111111111111';
const JOIN = 'https://eventi.dominio.gov.it/it/eventi/pa-digitale/live?token=tok-123';

const input = (over: Partial<EventInvitationInput> = {}): EventInvitationInput => ({
  eventId: EVENT_ID,
  updatedAt: new Date('2026-10-01T08:00:00Z'),
  title: 'PA Digitale 2026',
  description: '## Programma\n\nCon **Relatore 1**.',
  startsAt: new Date('2026-10-21T09:00:00Z'),
  endsAt: new Date('2026-10-21T10:30:00Z'),
  timezone: 'Europe/Rome',
  joinUrl: JOIN,
  eventPageUrl: 'https://eventi.dominio.gov.it/it/eventi/pa-digitale',
  organizerName: 'Ente organizzatore',
  attendeeEmail: 'persona@example.org',
  seat: 'registration',
  locale: 'it',
  now: new Date('2026-10-20T10:00:00Z'),
  ...over,
});

/** Le righe piegate riunite, come le legge un client. */
const unfold = (ics: string) => ics.replace(/\r\n /g, '');
/** Una proprieta' del VEVENT (le VTIMEZONE hanno i loro DTSTART). */
const prop = (ics: string, name: string) => {
  const testo = unfold(ics);
  const evento = name === 'METHOD' ? testo : testo.slice(testo.indexOf('BEGIN:VEVENT'));
  return evento.match(new RegExp(`^${name}([;:][^\\r\\n]*)$`, 'm'))?.[1];
};

const previous = {
  url: process.env.NEXT_PUBLIC_APP_URL,
  from: process.env.SMTP_FROM,
  secret: process.env.APP_SECRET,
};
beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://eventi.dominio.gov.it';
  process.env.SMTP_FROM = 'eventi@dominio.gov.it';
  process.env.APP_SECRET = 'segreto-di-prova-lungo-almeno-trentadue-caratteri';
});
afterEach(() => {
  for (const [key, value] of [
    ['NEXT_PUBLIC_APP_URL', previous.url],
    ['SMTP_FROM', previous.from],
    ['APP_SECRET', previous.secret],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('generateEventInvitation', () => {
  it('è un invito: METHOD:REQUEST, organizzatore di piattaforma, destinatario come ATTENDEE', () => {
    const ics = generateEventInvitation(input());
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(prop(ics, 'METHOD')).toBe(':REQUEST');
    expect(prop(ics, 'ORGANIZER')).toBe(
      ';CN="Ente organizzatore":mailto:eventi@dominio.gov.it'
    );
    expect(prop(ics, 'ATTENDEE')).toBe(
      ';CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:persona@example.org'
    );
    expect(prop(ics, 'STATUS')).toBe(':CONFIRMED');
    expect(prop(ics, 'CLASS')).toBe(':PRIVATE');
  });

  it('il link personale in LOCATION, URL e DESCRIPTION', () => {
    const ics = generateEventInvitation(input());
    expect(prop(ics, 'URL')).toBe(`:${JOIN}`);
    expect(prop(ics, 'LOCATION')).toBe(`:${JOIN}`);
    const descr = prop(ics, 'DESCRIPTION')!;
    expect(descr).toContain(`Per entrare in sala:\\n${JOIN}`);
    expect(descr).toContain('Programma\\n\\nCon Relatore 1.');
    expect(descr).toContain(
      'Pagina dell’evento: https://eventi.dominio.gov.it/it/eventi/pa-digitale'
    );
  });

  it('nessun dato personale oltre a quelli di chi riceve', () => {
    const ics = generateEventInvitation(input({ attendeeName: 'Persona Prova' }));
    const senzaUid = unfold(ics).replace(/^UID:.*$/m, '');
    const indirizzi = senzaUid.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi) ?? [];
    expect(new Set(indirizzi)).toEqual(
      new Set(['persona@example.org', 'eventi@dominio.gov.it'])
    );
    expect(prop(ics, 'ATTENDEE')).toContain('CN="Persona Prova"');
  });

  it('ora locale dell’evento con la sua VTIMEZONE', () => {
    const ics = generateEventInvitation(input());
    expect(prop(ics, 'DTSTART')).toBe(';TZID=Europe/Rome:20261021T110000');
    expect(prop(ics, 'DTEND')).toBe(';TZID=Europe/Rome:20261021T123000');
    expect(ics).toContain('BEGIN:VTIMEZONE\r\nTZID:Europe/Rome\r\n');
    // La VTIMEZONE sta prima del VEVENT che la usa.
    expect(ics.indexOf('BEGIN:VTIMEZONE')).toBeLessThan(ics.indexOf('BEGIN:VEVENT'));
  });

  it('istanti UTC quando il fuso non è sicuro, mai un TZID senza definizione', () => {
    const ics = generateEventInvitation(input({ timezone: 'UTC' }));
    expect(prop(ics, 'DTSTART')).toBe(':20261021T090000Z');
    expect(ics).not.toContain('TZID');
    expect(ics).not.toContain('VTIMEZONE');
  });

  it('SEQUENCE dall’ultima modifica, DTSTAMP dall’istante di generazione', () => {
    const ics = generateEventInvitation(input());
    expect(prop(ics, 'SEQUENCE')).toBe(
      `:${icsSequence(new Date('2026-10-01T08:00:00Z'))}`
    );
    expect(prop(ics, 'DTSTAMP')).toBe(':20261020T100000Z');
  });

  it('righe CRLF piegate a 75 ottetti, anche con caratteri non ASCII', () => {
    const ics = generateEventInvitation(
      input({
        title: 'Àccènti è «virgolette» — '.repeat(10),
        organizerName: 'Ente, sede; ufficio',
      })
    );
    for (const riga of ics.split('\r\n')) {
      expect(Buffer.byteLength(riga, 'utf8')).toBeLessThanOrEqual(75);
    }
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n');
    expect(prop(ics, 'SUMMARY')).toBe(
      `:${escapeIcsText('Àccènti è «virgolette» — '.repeat(10))}`
    );
  });

  it('testi e parametri non possono rompere il file', () => {
    const ics = generateEventInvitation(
      input({
        title: 'Titolo\r\nATTENDEE:mailto:intruso@example.org',
        organizerName: 'Ente "con" virgolette:\r\nX',
        attendeeName: 'Nome\nATTENDEE:mailto:intruso@example.org',
      })
    );
    expect(unfold(ics)).not.toMatch(/^ATTENDEE:mailto:intruso/m);
    expect(unfold(ics).match(/^ATTENDEE/gm)).toHaveLength(1);
    expect(prop(ics, 'ORGANIZER')).toBe(
      ';CN="Ente con virgolette:X":mailto:eventi@dominio.gov.it'
    );
  });

  it('i testi dell’invito in ogni lingua delle email', () => {
    for (const locale of EMAIL_LOCALES) {
      const descr = prop(generateEventInvitation(input({ locale })), 'DESCRIPTION')!;
      expect(descr.startsWith(':')).toBe(true);
      expect(descr).toContain(JOIN);
    }
    expect(
      prop(generateEventInvitation(input({ locale: 'en' })), 'DESCRIPTION')
    ).toContain('To join the room:');
  });

  it('senza il link in LOCATION per chi conduce: la pagina pubblica', () => {
    const ics = generateEventInvitation(input({ seat: 'grant', linkInLocation: false }));
    expect(prop(ics, 'LOCATION')).toBe(
      ':https://eventi.dominio.gov.it/it/eventi/pa-digitale'
    );
    expect(prop(ics, 'URL')).toBe(`:${JOIN}`);
    expect(prop(ics, 'DESCRIPTION')).toContain(JOIN);
  });

  it('la nota (link personale) sopra la descrizione', () => {
    const ics = generateEventInvitation(input({ note: 'Questo link è personale.' }));
    expect(prop(ics, 'DESCRIPTION')).toContain(
      `${JOIN}\\n\\nQuesto link è personale.\\n\\nProgramma`
    );
  });

  it('rifiuta date non valide invece di scrivere un orario sbagliato', () => {
    expect(() => generateEventInvitation(input({ endsAt: new Date('x') }))).toThrow(
      RangeError
    );
  });
});

describe('invitationUid', () => {
  it('stabile per evento, posto e indirizzo; diverso altrimenti', () => {
    const uid = invitationUid(EVENT_ID, 'registration', 'Persona@Example.org ');
    expect(uid).toMatch(
      new RegExp(
        `^${EVENT_ID}\\.registration\\.[0-9a-f]{32}@eventi\\.dominio\\.gov\\.it$`
      )
    );
    expect(invitationUid(EVENT_ID, 'registration', 'persona@example.org')).toBe(uid);
    expect(invitationUid(EVENT_ID, 'grant', 'persona@example.org')).not.toBe(uid);
    expect(invitationUid(EVENT_ID, 'registration', 'altra@example.org')).not.toBe(uid);
    expect(
      invitationUid('altro-evento', 'registration', 'persona@example.org').split('.')[2]
    ).not.toBe(uid.split('.')[2]);
  });

  it('non contiene l’indirizzo, ne’ la sua impronta usata altrove', () => {
    const uid = invitationUid(EVENT_ID, 'registration', 'persona@example.org');
    expect(uid).not.toContain('persona');
    expect(uid).not.toContain('example.org');
  });

  it('lo stesso UID in ogni invito alla stessa persona', () => {
    const a = generateEventInvitation(input());
    const b = generateEventInvitation(
      input({ title: 'Titolo cambiato', updatedAt: new Date('2026-10-02T08:00:00Z') })
    );
    expect(prop(a, 'UID')).toBe(prop(b, 'UID'));
    expect(Number(prop(b, 'SEQUENCE')!.slice(1))).toBeGreaterThan(
      Number(prop(a, 'SEQUENCE')!.slice(1))
    );
  });
});

describe('foldIcsLine', () => {
  it('lascia intatte le righe corte e piega le lunghe con uno spazio', () => {
    expect(foldIcsLine('SUMMARY:breve')).toBe('SUMMARY:breve');
    const lunga = `DESCRIPTION:${'x'.repeat(200)}`;
    const piegata = foldIcsLine(lunga);
    expect(piegata.replace(/\r\n /g, '')).toBe(lunga);
    expect(piegata.split('\r\n').every((r) => r.length <= 75)).toBe(true);
  });

  it('non spezza un carattere multibyte', () => {
    const piegata = foldIcsLine(`SUMMARY:${'é'.repeat(100)}`);
    for (const r of piegata.split('\r\n')) {
      expect(Buffer.byteLength(r, 'utf8')).toBeLessThanOrEqual(75);
      expect(r).not.toContain('�');
    }
  });
});

describe('calendarInvite', () => {
  it('l’invito pronto per la coda', () => {
    const invito = calendarInvite(input())!;
    expect(invito.method).toBe('REQUEST');
    expect(invito.content).toContain('METHOD:REQUEST');
  });

  it('undefined (e un log senza dati) se non si compone', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(calendarInvite(input({ startsAt: new Date('x') }))).toBeUndefined();
    expect(JSON.stringify(spy.mock.calls)).not.toContain('persona@example.org');
    expect(JSON.stringify(spy.mock.calls)).not.toContain('tok-123');
    spy.mockRestore();
  });
});

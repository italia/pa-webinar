import { describe, expect, it } from 'vitest';

import {
  CHIAVE_PRINCIPALE,
  agendaDalServer,
  chiavePersona,
  chiaviOrfane,
  conIdSalvati,
  concessioneDaChiave,
  erroriProgramma,
  opzioniRelatore,
  pianoCambiato,
  pianoDaInviare,
  type AgendaDraft,
} from './programme-plan';

const riga = (over: Partial<AgendaDraft> = {}): AgendaDraft => ({
  key: `k-${Math.random()}`,
  label: 'Argomento',
  minutes: '',
  speakerKey: null,
  ...over,
});

describe('chiavePersona', () => {
  it('l’indirizzo, senza maiuscole; senza indirizzo la concessione', () => {
    expect(chiavePersona({ email: ' Anna@Example.org ', grantId: 'g1' })).toBe(
      'e:anna@example.org'
    );
    expect(chiavePersona({ email: '', grantId: 'g1' })).toBe('g:g1');
    expect(chiavePersona({ email: '', grantId: null })).toBeNull();
  });
});

describe('opzioniRelatore', () => {
  it('l’organizzatore principale, poi le persone del passo nell’ordine dell’elenco', () => {
    const opzioni = opzioniRelatore({
      moderatorName: 'Chi organizza',
      moderatorPublicListed: true,
      moderators: [
        {
          name: 'Mara',
          email: 'mara@example.org',
          organizer: false,
          publicListed: false,
        },
      ],
      speakers: [{ name: 'Luca', email: 'luca@example.org', publicListed: true }],
    });
    expect(opzioni).toEqual([
      {
        key: CHIAVE_PRINCIPALE,
        name: 'Chi organizza',
        role: 'organizer',
        publicListed: true,
      },
      { key: 'e:mara@example.org', name: 'Mara', role: 'moderator', publicListed: false },
      { key: 'e:luca@example.org', name: 'Luca', role: 'speaker', publicListed: true },
    ]);
  });
});

describe('pianoDaInviare', () => {
  it('lascia le righe senza titolo, legge la durata e traduce chi interviene', () => {
    const piano = pianoDaInviare(
      [
        riga({
          id: 'a1',
          label: ' Apertura ',
          minutes: '10',
          speakerKey: CHIAVE_PRINCIPALE,
        }),
        riga({ label: '   ', minutes: '5' }),
        riga({ label: 'Intervento', minutes: '', speakerKey: 'e:luca@example.org' }),
        riga({ label: 'Saluti', minutes: '5', speakerKey: 'e:tolto@example.org' }),
      ],
      (k) => (k === 'e:luca@example.org' ? 'g-luca' : null)
    );
    expect(piano).toEqual([
      {
        id: 'a1',
        label: 'Apertura',
        plannedMinutes: 10,
        speakerGrantId: null,
        speakerPrimary: true,
      },
      {
        label: 'Intervento',
        plannedMinutes: null,
        speakerGrantId: 'g-luca',
        speakerPrimary: false,
      },
      // Una persona senza concessione: l'argomento resta, senza nome.
      { label: 'Saluti', plannedMinutes: 5, speakerGrantId: null, speakerPrimary: false },
    ]);
  });
});

describe('concessioneDaChiave', () => {
  const concessioni = [
    { id: 'g-vecchia', email: 'anna@example.org' },
    { id: 'g-senza', email: null },
    // Il cambio di ruolo: la concessione nuova, e la vecchia ancora li'
    // finche' la revoca non riesce.
    { id: 'g-nuova', email: 'Anna@example.org', replaces: 'g-vecchia' },
    { id: 'g-ruolo', email: null, replaces: 'g-senza-ruolo' },
  ];

  it('per indirizzo vale l’ultima concessione creata', () => {
    expect(concessioneDaChiave('e:anna@example.org', concessioni)).toBe('g-nuova');
    expect(concessioneDaChiave('e:nessuno@example.org', concessioni)).toBeNull();
  });

  it('per id, o la concessione che l’ha sostituita', () => {
    expect(concessioneDaChiave('g:g-senza', concessioni)).toBe('g-senza');
    expect(concessioneDaChiave('g:g-senza-ruolo', concessioni)).toBe('g-ruolo');
    expect(concessioneDaChiave('g:sparita', concessioni)).toBeNull();
    expect(concessioneDaChiave(CHIAVE_PRINCIPALE, concessioni)).toBeNull();
  });
});

describe('agendaDalServer e pianoCambiato', () => {
  const concessioni = [
    { id: 'g-luca', email: 'luca@example.org' },
    { id: 'g-senza', email: null },
  ];
  const salvato = [
    {
      id: 'a1',
      label: 'Apertura',
      plannedMinutes: 10,
      speakerGrantId: null,
      speakerPrimary: true,
    },
    {
      id: 'a2',
      label: 'Intervento',
      plannedMinutes: null,
      speakerGrantId: 'g-luca',
      speakerPrimary: false,
    },
    {
      id: 'a3',
      label: 'Chiusura',
      plannedMinutes: 5,
      speakerGrantId: 'g-senza',
      speakerPrimary: false,
    },
    // Una persona revocata non e' fra le concessioni: nessuno.
    {
      id: 'a4',
      label: 'Saluti',
      plannedMinutes: 5,
      speakerGrantId: 'g-revocata',
      speakerPrimary: false,
    },
  ];

  it('le righe del modulo dal programma salvato', () => {
    expect(
      agendaDalServer(salvato, concessioni).map((r) => [r.id, r.minutes, r.speakerKey])
    ).toEqual([
      ['a1', '10', CHIAVE_PRINCIPALE],
      ['a2', '', 'e:luca@example.org'],
      ['a3', '5', 'g:g-senza'],
      ['a4', '5', null],
    ]);
  });

  it('un programma ricaricato e non toccato non e’ cambiato', () => {
    const righe = agendaDalServer(salvato.slice(0, 3), concessioni);
    const piano = pianoDaInviare(righe, (k) => concessioneDaChiave(k, concessioni));
    expect(pianoCambiato(piano, salvato.slice(0, 3))).toBe(false);
  });

  it('ordine, titolo, durata o persona diversi: cambiato', () => {
    const righe = agendaDalServer(salvato.slice(0, 3), concessioni);
    const risolvi = (k: string) => concessioneDaChiave(k, concessioni);
    const base = salvato.slice(0, 3);
    expect(
      pianoCambiato(pianoDaInviare([righe[1]!, righe[0]!, righe[2]!], risolvi), base)
    ).toBe(true);
    expect(
      pianoCambiato(
        pianoDaInviare([{ ...righe[0]!, label: 'Altro' }, righe[1]!, righe[2]!], risolvi),
        base
      )
    ).toBe(true);
    expect(
      pianoCambiato(
        pianoDaInviare([{ ...righe[0]!, minutes: '' }, righe[1]!, righe[2]!], risolvi),
        base
      )
    ).toBe(true);
    // La stessa persona con una concessione nuova (cambio di ruolo).
    const dopoIlCambio = [{ id: 'g-luca-2', email: 'luca@example.org' }, ...concessioni];
    expect(
      pianoCambiato(
        pianoDaInviare(righe, (k) =>
          concessioneDaChiave(k, [...concessioni, dopoIlCambio[0]!])
        ),
        base
      )
    ).toBe(true);
  });
});

describe('chiaviOrfane ed erroriProgramma', () => {
  it('le scelte di persone che non sono piu’ nel passo', () => {
    const orfane = chiaviOrfane(
      [
        riga({ speakerKey: 'e:tolta@example.org' }),
        riga({ speakerKey: CHIAVE_PRINCIPALE }),
        riga(),
      ],
      [{ key: CHIAVE_PRINCIPALE, name: '', role: 'organizer', publicListed: false }]
    );
    expect([...orfane]).toEqual(['e:tolta@example.org']);
  });

  it('una durata che non e’ una durata, solo su righe con titolo e ad agenda accesa', () => {
    const agenda = [
      riga({ minutes: 'dieci' }),
      riga({ label: '', minutes: 'x' }),
      riga({ minutes: '20' }),
    ];
    expect(erroriProgramma({ agendaEnabled: true, agenda })).toEqual({
      'agenda.0.minutes': 'invalid',
    });
    expect(erroriProgramma({ agendaEnabled: false, agenda })).toEqual({});
  });
});

describe('conIdSalvati', () => {
  const salvato = [
    {
      id: 'a1',
      label: 'Uno',
      plannedMinutes: null,
      speakerGrantId: null,
      speakerPrimary: false,
    },
    {
      id: 'a2',
      label: 'Due',
      plannedMinutes: null,
      speakerGrantId: null,
      speakerPrimary: false,
    },
  ];
  it('le righe con un titolo prendono gli id salvati, in ordine; le vuote restano', () => {
    const righe = [riga({ label: 'Uno' }), riga({ label: ' ' }), riga({ label: 'Due' })];
    expect(conIdSalvati(righe, salvato).map((r) => r.id)).toEqual([
      'a1',
      undefined,
      'a2',
    ]);
  });
  it('se il numero non torna non tocca niente', () => {
    const righe = [riga({ label: 'Uno' })];
    expect(conIdSalvati(righe, salvato)).toEqual(righe);
  });
});

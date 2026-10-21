import { describe, expect, it } from 'vitest';

import {
  CHIAVE_PRINCIPALE,
  agendaDalServer,
  chiavePersona,
  chiaviOrfane,
  conIdSalvati,
  conIntervento,
  opzioniConPrincipale,
  oraNelFuso,
  concessioneDaChiave,
  descrizioneConProgramma,
  erroriProgramma,
  opzioniRelatore,
  orariDelModulo,
  pianoCambiato,
  pianoDaInviare,
  relatoriSenzaIntervento,
  senzaRelatoriAssenti,
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

describe('orariDelModulo', () => {
  const INIZIO = new Date('2026-10-29T09:00:00.000Z');
  const ore = (inizi: Array<Date | null>) =>
    inizi.map((d) => d?.toISOString().slice(11, 16) ?? null);

  it('una riga vuota non ha orario e non sposta quelli dopo', () => {
    const { inizi, totale, fine } = orariDelModulo(
      [
        riga({ label: 'Uno', minutes: '10' }),
        // Vuota, anche con i minuti scritti: non si salva, non conta.
        riga({ label: '  ', minutes: '30' }),
        riga({ label: 'Due', minutes: '20' }),
      ],
      INIZIO
    );
    expect(ore(inizi)).toEqual(['09:00', null, '09:10']);
    expect(totale).toBe(30);
    expect(fine?.toISOString()).toBe('2026-10-29T09:30:00.000Z');
  });

  it('una riga vuota appena aggiunta non toglie il totale né la fine', () => {
    const { totale, fine } = orariDelModulo(
      [
        riga({ label: 'Uno', minutes: '10' }),
        riga({ label: 'Due', minutes: '20' }),
        riga({ label: 'Tre', minutes: '30' }),
        riga({ label: '', minutes: '' }),
      ],
      INIZIO
    );
    // Come il riepilogo e la pagina pubblica: tre argomenti, un'ora.
    expect(totale).toBe(60);
    expect(fine?.toISOString()).toBe('2026-10-29T10:00:00.000Z');
  });

  it('dal primo argomento senza durata in poi niente orari, e niente totale', () => {
    const { inizi, totale, fine } = orariDelModulo(
      [
        riga({ label: 'Uno', minutes: '10' }),
        riga({ label: 'Due', minutes: '' }),
        riga({ label: 'Tre', minutes: '15' }),
      ],
      INIZIO
    );
    expect(ore(inizi)).toEqual(['09:00', '09:10', null]);
    expect(totale).toBeNull();
    expect(fine).toBeNull();
  });

  it('senza un inizio valido niente orari, ma il totale si conosce', () => {
    const { inizi, totale, fine } = orariDelModulo(
      [riga({ label: 'Uno', minutes: '10' })],
      null
    );
    expect(inizi).toEqual([null]);
    expect(totale).toBe(10);
    expect(fine).toBeNull();
  });

  it('senza argomenti con un titolo: nessun totale', () => {
    expect(orariDelModulo([riga({ label: '' })], INIZIO)).toEqual({
      inizi: [null],
      totale: null,
      fine: null,
    });
  });
});

describe('senzaRelatoriAssenti', () => {
  const persone = {
    moderatorName: '',
    moderators: [
      { name: 'Anna', email: 'anna@example.org', organizer: false, publicListed: false },
    ],
    speakers: [{ name: 'Luca', email: '', grantId: 'g-luca', publicListed: false }],
  };

  it('toglie solo le scelte di chi non e’ piu’ fra le persone, e dice quali righe', () => {
    const agenda = [
      riga({ key: 'a', speakerKey: 'e:anna@example.org' }),
      riga({ key: 'b', speakerKey: 'e:tolta@example.org' }),
      riga({ key: 'c', speakerKey: 'g:g-luca' }),
      riga({ key: 'd', speakerKey: 'g:g-tolto' }),
      riga({ key: 'e', speakerKey: null }),
    ];
    const { form, righe } = senzaRelatoriAssenti({ ...persone, agenda });
    expect(righe).toEqual(['b', 'd']);
    expect(form.agenda.map((v) => v.speakerKey)).toEqual([
      'e:anna@example.org',
      null,
      'g:g-luca',
      null,
      null,
    ]);
  });

  it('l’organizzatore principale resta una scelta anche senza nome; senza orfane il modulo e’ lo stesso', () => {
    const modulo = { ...persone, agenda: [riga({ speakerKey: CHIAVE_PRINCIPALE })] };
    const esito = senzaRelatoriAssenti(modulo);
    expect(esito.righe).toEqual([]);
    expect(esito.form).toBe(modulo);
  });
});

describe('relatoriSenzaIntervento', () => {
  it('i relatori senza un argomento con un titolo (quello che si salva), non chi conduce', () => {
    const modulo = {
      moderatorName: 'Chi organizza',
      moderators: [{ name: 'Anna', email: 'anna@example.org', organizer: false, publicListed: false }],
      speakers: [
        { name: 'Luca', email: 'luca@example.org', publicListed: false },
        { name: 'Sara', email: 'sara@example.org', publicListed: false },
      ],
    };
    const conTitolo = relatoriSenzaIntervento({
      ...modulo,
      agenda: [riga({ speakerKey: 'e:luca@example.org' })],
    });
    expect(conTitolo.map((o) => o.name)).toEqual(['Sara']);
    const senzaTitolo = relatoriSenzaIntervento({
      ...modulo,
      agenda: [riga({ speakerKey: 'e:luca@example.org', label: '' })],
    });
    expect(senzaTitolo.map((o) => o.name)).toEqual(['Luca', 'Sara']);
  });
});

describe('conIntervento', () => {
  it('una riga nuova in fondo, con la persona', () => {
    const { agenda, indice } = conIntervento([riga({ key: 'a' })], 'e:anna@example.org');
    expect(indice).toBe(1);
    expect(agenda).toHaveLength(2);
    expect(agenda[1]).toMatchObject({ label: '', minutes: '', speakerKey: 'e:anna@example.org' });
  });

  it('la riga vuota appena aggiunta si usa; una con qualcosa no', () => {
    const vuota = { key: 'v', label: '', minutes: '', speakerKey: null };
    expect(conIntervento([riga({ key: 'a' }), vuota], 'primary')).toEqual({
      agenda: [expect.objectContaining({ key: 'a' }), { ...vuota, speakerKey: 'primary' }],
      indice: 1,
    });
    expect(conIntervento([{ ...vuota, minutes: '10' }], 'primary').indice).toBe(1);
    expect(conIntervento([{ ...vuota, speakerKey: 'e:x@example.org' }], 'primary').indice).toBe(1);
    expect(conIntervento([{ ...vuota, id: 'salvata' }], 'primary').indice).toBe(1);
  });
});

describe('descrizioneConProgramma', () => {
  it('un titolo «Programma» o «Agenda», anche in grassetto o in inglese', () => {
    expect(descrizioneConProgramma('Intro.\n\n## Programma\n\nSaluti')).toBe(true);
    expect(descrizioneConProgramma('**Agenda:**\nSaluti')).toBe(true);
    expect(descrizioneConProgramma('### Programme')).toBe(true);
  });

  it('due righe che cominciano con un orario, anche in elenco o in tabella', () => {
    expect(descrizioneConProgramma('- 10:00 Apertura\n- 10.30 Interventi')).toBe(true);
    expect(descrizioneConProgramma('| 10:00 | Apertura |\n| 11:00 | Chiusura |')).toBe(true);
  });

  it('le date e i numeri dei paragrafi non sono orari', () => {
    expect(descrizioneConProgramma('12.05.2026 prima sessione\n19.05.2026 seconda sessione')).toBe(false);
    expect(descrizioneConProgramma('1.10 Requisiti\n1.20 Modalità')).toBe(false);
    expect(descrizioneConProgramma('10:00-11:00 Apertura\n11:00-12:00 Lavori')).toBe(true);
    expect(descrizioneConProgramma('09.30 Apertura\n9:45 Saluti')).toBe(true);
    expect(descrizioneConProgramma('- 9.30 Accoglienza\n- 9.45 Saluti')).toBe(true);
  });

  it('una parola in una frase, o un orario solo, non bastano', () => {
    expect(descrizioneConProgramma('Il programma del governo per il digitale.')).toBe(false);
    expect(descrizioneConProgramma("L'incontro comincia alle 10:00.\n10:00 ritrovo")).toBe(false);
    expect(descrizioneConProgramma('')).toBe(false);
    expect(descrizioneConProgramma(null)).toBe(false);
  });
});

describe('opzioniConPrincipale e oraNelFuso', () => {
  it('l’organizzatore principale c’e’ sempre, anche senza nome, ed e’ il primo', () => {
    const senzaNome = opzioniConPrincipale({ moderatorName: ' ', moderators: [], speakers: [] });
    expect(senzaNome).toEqual([
      { key: CHIAVE_PRINCIPALE, name: '', role: 'organizer', publicListed: false },
    ]);
    const conNome = opzioniConPrincipale({
      moderatorName: 'Chi organizza',
      moderatorPublicListed: true,
      moderators: [],
      speakers: [{ name: 'Luca', email: 'luca@example.org', publicListed: false }],
    });
    expect(conNome.map((o) => o.key)).toEqual([CHIAVE_PRINCIPALE, 'e:luca@example.org']);
    expect(conNome[0]!.name).toBe('Chi organizza');
  });

  it('l’ora nel fuso dell’evento', () => {
    expect(oraNelFuso(new Date('2026-10-29T09:05:00Z'), 'Europe/Rome')).toBe('10:05');
  });
});

import { describe, expect, it } from 'vitest';

import {
  TYPING_PING_MS,
  TYPING_TTL_MS,
  applyTyping,
  clearTyping,
  parseTypingPayload,
  pruneTyping,
  shouldPing,
  typingLabel,
  type TypingState,
} from './typing';

const T0 = 1_000_000;

function nomi(state: TypingState): string[] {
  return [...state.values()].map((e) => e.name);
}

describe('costanti', () => {
  it('chi non rinnova l’avviso resta visibile più a lungo dell’intervallo fra due avvisi', () => {
    // Altrimenti un avviso in ritardo di poco farebbe lampeggiare l'indicatore.
    expect(TYPING_PING_MS).toBe(3000);
    expect(TYPING_TTL_MS).toBe(5000);
    expect(TYPING_TTL_MS).toBeGreaterThan(TYPING_PING_MS);
  });
});

describe('shouldPing', () => {
  it('manda il primo avviso subito', () => {
    expect(shouldPing(0, T0)).toBe(true);
  });

  it('non manda più di un avviso ogni TYPING_PING_MS', () => {
    expect(shouldPing(T0, T0)).toBe(false);
    expect(shouldPing(T0, T0 + TYPING_PING_MS - 1)).toBe(false);
    expect(shouldPing(T0, T0 + TYPING_PING_MS)).toBe(true);
  });

  it('con l’orologio tornato indietro non smette di avvisare', () => {
    expect(shouldPing(T0, T0 - 10_000)).toBe(true);
  });
});

describe('parseTypingPayload', () => {
  it('copia solo i campi noti: un campo in più non arriva al client', () => {
    expect(
      parseTypingPayload({ senderKey: 'abc', senderName: ' Anna ', senderId: 'guest-x' }),
    ).toEqual({ senderKey: 'abc', senderName: 'Anna' });
  });

  it.each([
    null,
    'stringa',
    42,
    {},
    { senderKey: 'abc' },
    { senderName: 'Anna' },
    { senderKey: '', senderName: 'Anna' },
    { senderKey: 'abc', senderName: '   ' },
    { senderKey: 7, senderName: 'Anna' },
    { senderKey: 'k'.repeat(65), senderName: 'Anna' },
    { senderKey: 'abc', senderName: 'n'.repeat(201) },
  ])('scarta un avviso malformato: %j', (raw) => {
    expect(parseTypingPayload(raw)).toBeNull();
  });
});

describe('applyTyping', () => {
  it('registra chi scrive fino a now + TTL, senza toccare la mappa ricevuta', () => {
    const vuota: TypingState = new Map();
    const dopo = applyTyping(vuota, { senderKey: 'k1', senderName: 'Anna' }, T0);
    expect(vuota.size).toBe(0);
    expect([...dopo.values()]).toEqual([{ name: 'Anna', until: T0 + TYPING_TTL_MS }]);
  });

  it('un nuovo avviso della stessa persona rinnova la scadenza senza duplicarla', () => {
    let s: TypingState = new Map();
    s = applyTyping(s, { senderKey: 'k1', senderName: 'Anna' }, T0);
    s = applyTyping(s, { senderKey: 'k2', senderName: 'Bruno' }, T0 + 100);
    s = applyTyping(s, { senderKey: 'k1', senderName: 'Anna' }, T0 + 2000);
    expect(s.size).toBe(2);
    // L'ordine resta quello di arrivo: l'etichetta non scambia i nomi a ogni avviso.
    expect(nomi(s)).toEqual(['Anna', 'Bruno']);
    expect([...s.values()][0]!.until).toBe(T0 + 2000 + TYPING_TTL_MS);
  });

  it('distingue due persone sullo stesso posto condiviso per nome', () => {
    // Il link primario del moderatore ha una chiave sola per chiunque lo usi.
    let s: TypingState = new Map();
    s = applyTyping(s, { senderKey: 'primario', senderName: 'Mario' }, T0);
    s = applyTyping(s, { senderKey: 'primario', senderName: 'Lucia' }, T0);
    expect(nomi(s)).toEqual(['Mario', 'Lucia']);
  });

  it('ignora sé stessi per chiave quando la chiave è nota, qualunque sia il nome', () => {
    // Per un'identità nominale il server usa il nome registrato, che può non
    // coincidere con quello che il client crede di avere.
    const s: TypingState = new Map();
    const dopo = applyTyping(s, { senderKey: 'mia', senderName: 'Maria Rossi' }, T0, {
      key: 'mia',
      name: 'Maria',
    });
    expect(dopo).toBe(s);
  });

  it('con la chiave nota non scarta un’altra persona con lo stesso nome', () => {
    const dopo = applyTyping(new Map(), { senderKey: 'altra', senderName: 'Anna' }, T0, {
      key: 'mia',
      name: 'Anna',
    });
    expect(nomi(dopo)).toEqual(['Anna']);
  });

  it('senza chiave nota ignora sé stessi per nome', () => {
    const s: TypingState = new Map();
    expect(applyTyping(s, { senderKey: 'k', senderName: 'Anna' }, T0, { name: ' Anna ' })).toBe(s);
    expect(nomi(applyTyping(s, { senderKey: 'k', senderName: 'Bruno' }, T0, { name: 'Anna' }))).toEqual([
      'Bruno',
    ]);
  });

  it('un avviso malformato lascia lo stato com’è', () => {
    const s: TypingState = new Map();
    expect(applyTyping(s, { senderKey: '', senderName: 'Anna' }, T0)).toBe(s);
  });
});

describe('pruneTyping', () => {
  it('toglie chi non ha rinnovato l’avviso entro il TTL', () => {
    let s: TypingState = new Map();
    s = applyTyping(s, { senderKey: 'k1', senderName: 'Anna' }, T0);
    s = applyTyping(s, { senderKey: 'k2', senderName: 'Bruno' }, T0 + 3000);
    expect(nomi(pruneTyping(s, T0 + TYPING_TTL_MS - 1))).toEqual(['Anna', 'Bruno']);
    expect(nomi(pruneTyping(s, T0 + TYPING_TTL_MS))).toEqual(['Bruno']);
    expect(pruneTyping(s, T0 + 3000 + TYPING_TTL_MS).size).toBe(0);
  });

  it('restituisce la stessa mappa quando nessuno è scaduto', () => {
    const s = applyTyping(new Map(), { senderKey: 'k1', senderName: 'Anna' }, T0);
    expect(pruneTyping(s, T0 + 1)).toBe(s);
  });
});

describe('clearTyping', () => {
  it('toglie chi ha appena inviato il messaggio, e solo lui', () => {
    let s: TypingState = new Map();
    s = applyTyping(s, { senderKey: 'k1', senderName: 'Anna' }, T0);
    s = applyTyping(s, { senderKey: 'k2', senderName: 'Bruno' }, T0);
    const dopo = clearTyping(s, 'k1', 'Anna');
    expect(nomi(dopo)).toEqual(['Bruno']);
    expect(nomi(s)).toEqual(['Anna', 'Bruno']);
  });

  it('con il nome toglie una sola persona del posto condiviso; senza, tutte', () => {
    let s: TypingState = new Map();
    s = applyTyping(s, { senderKey: 'primario', senderName: 'Mario' }, T0);
    s = applyTyping(s, { senderKey: 'primario', senderName: 'Lucia' }, T0);
    s = applyTyping(s, { senderKey: 'k2', senderName: 'Bruno' }, T0);
    expect(nomi(clearTyping(s, 'primario', 'Mario'))).toEqual(['Lucia', 'Bruno']);
    expect(nomi(clearTyping(s, 'primario'))).toEqual(['Bruno']);
  });

  it('restituisce la stessa mappa quando non c’è niente da togliere', () => {
    const s = applyTyping(new Map(), { senderKey: 'k1', senderName: 'Anna' }, T0);
    expect(clearTyping(s, 'k9', 'Zeno')).toBe(s);
    expect(clearTyping(s, 'k9')).toBe(s);
    expect(clearTyping(s, '')).toBe(s);
  });
});

describe('typingLabel', () => {
  it('nessuno, una persona, due persone, poi «più persone»', () => {
    expect(typingLabel([])).toEqual({ kind: 'none' });
    expect(typingLabel(['Anna'])).toEqual({ kind: 'one', name: 'Anna' });
    expect(typingLabel(['Anna', 'Bruno'])).toEqual({ kind: 'two', a: 'Anna', b: 'Bruno' });
    expect(typingLabel(['Anna', 'Bruno', 'Carla'])).toEqual({ kind: 'many' });
    expect(typingLabel(['a', 'b', 'c', 'd', 'e'])).toEqual({ kind: 'many' });
  });
});

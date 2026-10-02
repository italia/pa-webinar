import { afterEach, describe, expect, it } from 'vitest';

import {
  MY_QUESTIONS_STORAGE_PREFIX,
  isAnswered,
  qaChanges,
  qaSeen,
  readMyQuestions,
  rememberMyQuestion,
  type QaListItem,
} from './alerts';

const domanda = (id: string, extra: Partial<QaListItem> = {}): QaListItem => ({
  id,
  authorName: 'Relatore 1',
  text: `Domanda ${id}`,
  status: 'PENDING',
  answerText: null,
  ...extra,
});

describe('isAnswered', () => {
  it('vale per lo stato «Risposta data» e per una risposta scritta', () => {
    expect(isAnswered({ status: 'ANSWERED', answerText: null })).toBe(true);
    expect(isAnswered({ status: 'HIGHLIGHTED', answerText: 'Sì.' })).toBe(true);
    expect(isAnswered({ status: 'PENDING', answerText: null })).toBe(false);
  });
});

describe('qaChanges', () => {
  it('alla prima lettura non segnala niente', () => {
    expect(qaChanges(null, [domanda('a', { status: 'ANSWERED' })])).toEqual({
      newQuestions: [],
      newlyAnswered: [],
    });
  });

  it('segnala le domande nuove', () => {
    const prima = qaSeen([domanda('a')]);
    const r = qaChanges(prima, [domanda('a'), domanda('b')]);
    expect(r.newQuestions.map((q) => q.id)).toEqual(['b']);
    expect(r.newlyAnswered).toEqual([]);
  });

  it('segnala una risposta appena arrivata, una volta sola', () => {
    const prima = qaSeen([domanda('a')]);
    const dopo = [domanda('a', { answerText: 'Entro giugno.' })];
    expect(qaChanges(prima, dopo).newlyAnswered.map((q) => q.id)).toEqual(['a']);
    // Gia' risposta alla lettura successiva: non e' piu' una novita'.
    expect(qaChanges(qaSeen(dopo), dopo).newlyAnswered).toEqual([]);
  });

  it('una correzione del testo della risposta non e\' una risposta nuova', () => {
    const prima = qaSeen([domanda('a', { status: 'ANSWERED', answerText: 'Sì' })]);
    const r = qaChanges(prima, [domanda('a', { status: 'ANSWERED', answerText: 'Sì, entro giugno.' })]);
    expect(r.newlyAnswered).toEqual([]);
  });
});

describe('domande fatte da questo browser', () => {
  afterEach(() => window.localStorage.clear());

  it('si ricordano per evento', () => {
    rememberMyQuestion('evento-1', 'a');
    rememberMyQuestion('evento-1', 'b');
    rememberMyQuestion('evento-2', 'c');
    expect([...readMyQuestions('evento-1')]).toEqual(['a', 'b']);
    expect([...readMyQuestions('evento-2')]).toEqual(['c']);
  });

  it('un valore rovinato vale come nessuna domanda', () => {
    window.localStorage.setItem(MY_QUESTIONS_STORAGE_PREFIX + 'evento-1', '{rotto');
    expect(readMyQuestions('evento-1').size).toBe(0);
  });

  it('tiene solo le ultime cinquanta', () => {
    for (let i = 0; i < 55; i++) rememberMyQuestion('evento-1', `q${i}`);
    const ids = readMyQuestions('evento-1');
    expect(ids.size).toBe(50);
    expect(ids.has('q0')).toBe(false);
    expect(ids.has('q54')).toBe(true);
  });
});

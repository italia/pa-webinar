import { describe, expect, it } from 'vitest';

import {
  EMOJI_CATALOG,
  parseRecentEmoji,
  pushRecentEmoji,
  searchEmoji,
} from './emoji-catalog';

describe('searchEmoji', () => {
  it('senza ricerca restituisce tutto il catalogo', () => {
    expect(searchEmoji('')).toHaveLength(EMOJI_CATALOG.length);
  });

  it('trova per parola italiana o inglese, anche col solo inizio', () => {
    expect(searchEmoji('grazie').map((e) => e.emoji)).toContain('🙏');
    expect(searchEmoji('thanks').map((e) => e.emoji)).toContain('🙏');
    expect(searchEmoji('applau').map((e) => e.emoji)).toContain('👏');
  });

  it('ignora maiuscole e accenti', () => {
    expect(searchEmoji('Caffè').map((e) => e.emoji)).toContain('☕');
  });

  it('con più parole servono tutte', () => {
    const r = searchEmoji('cuore blu').map((e) => e.emoji);
    expect(r).toContain('💙');
    expect(r).not.toContain('❤️');
  });

  it('nessun risultato per parole sconosciute', () => {
    expect(searchEmoji('zzzzqqq')).toEqual([]);
  });

  it('nel catalogo nessuna emoji compare due volte', () => {
    const emoji = EMOJI_CATALOG.map((e) => e.emoji);
    expect(new Set(emoji).size).toBe(emoji.length);
  });
});

describe('emoji recenti', () => {
  it('la nuova va in testa, senza doppioni, al massimo 16', () => {
    expect(pushRecentEmoji(['👍', '🙏'], '🙏')).toEqual(['🙏', '👍']);
    const tante = Array.from({ length: 20 }, (_, i) => String(i));
    expect(pushRecentEmoji(tante, 'x')).toHaveLength(16);
  });

  it('un valore salvato rovinato vale come elenco vuoto', () => {
    expect(parseRecentEmoji('non json')).toEqual([]);
    expect(parseRecentEmoji(JSON.stringify(['👍', 3, '🙏']))).toEqual(['👍', '🙏']);
    expect(parseRecentEmoji(null)).toEqual([]);
  });
});

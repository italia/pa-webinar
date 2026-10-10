import { describe, expect, it } from 'vitest';

import { applyChunk, CAPTION_FINAL_TTL_MS, chunkText, prune } from './caption-lines';

describe('chunkText', () => {
  it('preferisce il definitivo, altrimenti unisce stabile e instabile', () => {
    expect(chunkText({ messageID: 'm', final: ' Ciao. ' })).toEqual({ text: 'Ciao.', final: true });
    expect(chunkText({ messageID: 'm', stable: 'Buon', unstable: 'giorno' })).toEqual({ text: 'Buongiorno', final: false });
    expect(chunkText({ messageID: 'm' })).toEqual({ text: '', final: false });
  });
});

describe('applyChunk', () => {
  it('sostituisce il testo della stessa frase e accoda le nuove', () => {
    let lines = applyChunk([], { messageID: 'a', participant: { id: 'p1' }, stable: 'Buon' }, 0);
    lines = applyChunk(lines, { messageID: 'a', participant: { id: 'p1' }, stable: 'Buongiorno' }, 100);
    expect(lines).toEqual([{ id: 'a', speakerId: 'p1', text: 'Buongiorno', final: false, at: 100 }]);
    lines = applyChunk(lines, { messageID: 'b', participant: { id: 'p2' }, stable: 'Salve' }, 200);
    lines = applyChunk(lines, { messageID: 'a', participant: { id: 'p1' }, final: 'Buongiorno a tutti.' }, 300);
    expect(lines.map((l) => [l.id, l.text, l.final])).toEqual([
      ['a', 'Buongiorno a tutti.', true],
      ['b', 'Salve', false],
    ]);
  });

  it('tiene solo le ultime righe', () => {
    let lines = applyChunk([], { messageID: 'a', final: 'Uno.' }, 0);
    lines = applyChunk(lines, { messageID: 'b', final: 'Due.' }, 1);
    lines = applyChunk(lines, { messageID: 'c', final: 'Tre.' }, 2);
    expect(lines.map((l) => l.text)).toEqual(['Due.', 'Tre.']);
  });

  it('un frammento vuoto toglie la frase, uno senza id non cambia nulla', () => {
    const lines = applyChunk([], { messageID: 'a', stable: 'x' }, 0);
    expect(applyChunk(lines, { messageID: 'a', unstable: '' }, 1)).toEqual([]);
    expect(applyChunk(lines, { messageID: '', final: 'y' }, 1)).toBe(lines);
  });
});

describe('prune', () => {
  it('fa sparire le frasi concluse dopo il tempo di lettura', () => {
    const lines = applyChunk([], { messageID: 'a', final: 'Fine.' }, 0);
    expect(prune(lines, CAPTION_FINAL_TTL_MS - 1)).toHaveLength(1);
    expect(prune(lines, CAPTION_FINAL_TTL_MS)).toHaveLength(0);
  });
});

import { describe, expect, it, vi } from 'vitest';

import { PonteChatPiazza, type AscoltatorePiazza } from './chat-bridge';

function ascoltatore() {
  return {
    messaggio: vi.fn(),
    modificato: vi.fn(),
    rimosso: vi.fn(),
    scrittura: vi.fn(),
  } satisfies AscoltatorePiazza;
}

const msg = (id: string, testo = `testo ${id}`) => ({ id, nome: `Persona ${id}`, testo, mio: false });

describe('PonteChatPiazza', () => {
  it('passa alla piazza ogni messaggio, anche quelli arrivati insieme', () => {
    const ponte = new PonteChatPiazza(() => 0);
    const a = ascoltatore();
    ponte.collega(a);
    ponte.messaggio(msg('1'));
    ponte.messaggio(msg('2'));
    ponte.messaggio(msg('3'));
    expect(a.messaggio.mock.calls.map(([m, eta]) => [m.id, eta])).toEqual([
      ['1', 0],
      ['2', 0],
      ['3', 0],
    ]);
  });

  it('aprendo la piazza ripete i messaggi recenti con la loro età, misurata qui', () => {
    let ora = 1_000;
    const ponte = new PonteChatPiazza(() => ora);
    ponte.messaggio(msg('vecchio'));
    ora += 25_000;
    ponte.messaggio(msg('recente'));
    ora += 5_000;
    ponte.scrittura(['Anna']);
    const a = ascoltatore();
    ponte.collega(a);
    expect(a.messaggio.mock.calls.map(([m, eta]) => [m.id, eta])).toEqual([['recente', 5_000]]);
    expect(a.scrittura).toHaveBeenCalledWith(['Anna']);
  });

  it('un messaggio tolto non torna aprendo la piazza, e il fumetto aperto va via', () => {
    const ponte = new PonteChatPiazza(() => 0);
    ponte.messaggio(msg('1'));
    ponte.rimosso('1');
    const a = ascoltatore();
    ponte.collega(a);
    expect(a.messaggio).not.toHaveBeenCalled();
    ponte.rimosso('2');
    expect(a.rimosso).toHaveBeenCalledWith('2');
  });

  it('una correzione arriva al fumetto e vale anche per chi apre dopo', () => {
    const ponte = new PonteChatPiazza(() => 0);
    const prima = ascoltatore();
    const scollega = ponte.collega(prima);
    ponte.messaggio(msg('1', 'numero 333 1234567'));
    ponte.modificato('1', 'scusate, numero sbagliato');
    expect(prima.modificato).toHaveBeenCalledWith('1', 'scusate, numero sbagliato');
    scollega();
    const dopo = ascoltatore();
    ponte.collega(dopo);
    expect(dopo.messaggio.mock.calls[0]?.[0].testo).toBe('scusate, numero sbagliato');
  });

  it('un messaggio già passato non ricomincia (una chat che si riapre li rilegge)', () => {
    let ora = 0;
    const ponte = new PonteChatPiazza(() => ora);
    const a = ascoltatore();
    ponte.collega(a);
    ponte.messaggio(msg('1'));
    ora += 5_000;
    ponte.messaggio(msg('1'), 0);
    expect(a.messaggio).toHaveBeenCalledTimes(1);
  });

  it('se poi si scopre che era mio, il fumetto passa sul mio avatar con l’età vera', () => {
    let ora = 0;
    const ponte = new PonteChatPiazza(() => ora);
    const a = ascoltatore();
    ponte.collega(a);
    ponte.messaggio(msg('1'));
    ora += 800;
    ponte.messaggio({ ...msg('1'), mio: true });
    expect(a.messaggio).toHaveBeenLastCalledWith(expect.objectContaining({ id: '1', mio: true }), 800);
  });

  it('un messaggio recuperato porta la sua età stimata; troppo vecchio, niente fumetto', () => {
    const ponte = new PonteChatPiazza(() => 100_000);
    const a = ascoltatore();
    ponte.collega(a);
    ponte.messaggio(msg('recente'), 4_000);
    ponte.messaggio(msg('vecchio'), 45_000);
    expect(a.messaggio.mock.calls.map(([m, eta]) => [m.id, eta])).toEqual([['recente', 4_000]]);
  });

  it('una correzione conta solo se cambia il testo di un messaggio recente', () => {
    const ponte = new PonteChatPiazza(() => 0);
    const a = ascoltatore();
    ponte.collega(a);
    ponte.messaggio(msg('1', 'ciao'));
    ponte.modificato('1', 'ciao');
    ponte.modificato('1', '');
    ponte.modificato('sconosciuto', 'altro');
    expect(a.modificato).not.toHaveBeenCalled();
  });

  it('scollegata, la piazza non riceve più niente', () => {
    const ponte = new PonteChatPiazza(() => 0);
    const a = ascoltatore();
    const scollega = ponte.collega(a);
    scollega();
    ponte.messaggio(msg('1'));
    ponte.scrittura(['Bruno']);
    expect(a.messaggio).not.toHaveBeenCalled();
    expect(a.scrittura).toHaveBeenCalledTimes(1);
  });
});

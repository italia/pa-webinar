// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { describe, expect, it } from 'vitest';

import {
  NICKNAME_MAX,
  alternativeNickname,
  difettoDiForma,
  formaDiConfronto,
  imitaUnNome,
  normalizzaNickname,
  usaUnaParolaRiservata,
} from './nickname-rule';

describe('normalizzaNickname', () => {
  it('toglie gli spazi ai lati e porta le forme larghe a quelle piane', () => {
    expect(normalizzaNickname('  Pippo ')).toBe('Pippo');
    expect(normalizzaNickname('Ｐｉｐｐｏ１')).toBe('Pippo1');
  });
});

describe('difettoDiForma', () => {
  it('accetta una parola sola, anche con separatori e cifre', () => {
    for (const ok of [
      'Pippo',
      'Al',
      'pippo_1',
      'Anna.Maria',
      'Zoë-23',
      'Ελένη',
      'Мария',
      '李明',
    ]) {
      expect(difettoDiForma(ok), ok).toBeNull();
    }
  });

  it('rifiuta lunghezze fuori dai limiti', () => {
    expect(difettoDiForma('P')).toBe('length');
    expect(difettoDiForma('P'.repeat(NICKNAME_MAX + 1))).toBe('length');
    expect(difettoDiForma('P'.repeat(NICKNAME_MAX))).toBeNull();
  });

  it('rifiuta spazi, simboli, inizi e fini sbagliati e caratteri invisibili', () => {
    for (const ko of [
      'Pippo Rossi',
      '1Pippo',
      '_Pippo',
      'Pippo.',
      'Pi..ppo',
      'Pi-_ppo',
      'Pippo​',
      'Pip\u0000po',
      'Pippo!',
      'Pippo😀',
      '@Pippo',
    ]) {
      expect(difettoDiForma(ko), JSON.stringify(ko)).toBe('format');
    }
  });

  it('rifiuta le lettere che non si vedono', () => {
    expect(difettoDiForma(normalizzaNickname('\u3164\u3164'))).toBe('format');
    expect(difettoDiForma('\u115F\u1160')).toBe('format');
    expect(difettoDiForma('Pi\u3164ppo')).toBe('format');
  });

  it("rifiuta le scritture mescolate, la via piu' semplice per sembrare un altro", () => {
    // «а» cirillica in mezzo a lettere latine.
    expect(difettoDiForma('Pаolo')).toBe('scripts');
    expect(difettoDiForma('Ελένηa')).toBe('scripts');
    expect(difettoDiForma('Mario李')).toBe('scripts');
  });
});

describe('formaDiConfronto', () => {
  it('ignora maiuscole, accenti e separatori', () => {
    expect(formaDiConfronto('Pìppo-1')).toBe('pippo1');
    expect(formaDiConfronto('PIPPO_1')).toBe(formaDiConfronto('pippo.1'));
  });
});

describe('imitaUnNome', () => {
  const chiConduce = ['Mario Rossi', "Anna D'Angelo", 'Al Bano'];

  it('il nome intero, scritto in qualunque modo, o contenuto', () => {
    expect(imitaUnNome('MarioRossi', chiConduce)).toBe(true);
    expect(imitaUnNome('mario_rossi', chiConduce)).toBe(true);
    expect(imitaUnNome('MarioRossi99', chiConduce)).toBe(true);
    expect(imitaUnNome('AnnaDAngelo', chiConduce)).toBe(true);
  });

  it('una parola del nome di almeno tre lettere, da sola', () => {
    expect(imitaUnNome('Mario', chiConduce)).toBe(true);
    expect(imitaUnNome('Màrio', chiConduce)).toBe(true);
    expect(imitaUnNome('Rossi', chiConduce)).toBe(true);
    expect(imitaUnNome('Angelo', chiConduce)).toBe(true);
  });

  it('un nome di una parola sola conta solo uguale', () => {
    expect(imitaUnNome('Anna', ['Anna'])).toBe(true);
    expect(imitaUnNome('Giovanna', ['Anna'])).toBe(false);
    expect(imitaUnNome('Direttore', ['Direttore Generale'])).toBe(true);
    expect(imitaUnNome('Direttorissimo', ['Direttore Generale'])).toBe(false);
  });

  it('non tocca i nickname che solo somigliano', () => {
    expect(imitaUnNome('Mar', chiConduce)).toBe(false);
    expect(imitaUnNome('Rossi99', chiConduce)).toBe(false);
    // «Al» ha due lettere: da sola non conta.
    expect(imitaUnNome('Al', chiConduce)).toBe(false);
    expect(imitaUnNome('Pippo', chiConduce)).toBe(false);
    expect(imitaUnNome('Pippo', [])).toBe(false);
  });
});

describe('usaUnaParolaRiservata', () => {
  const parole = ['Moderatore', 'Relatore', 'Partecipante', 'Host'];

  it('le parole lunghe non si possono nemmeno contenere', () => {
    expect(usaUnaParolaRiservata('Moderatore2', parole)).toBe(true);
    expect(usaUnaParolaRiservata('IlRelatore', parole)).toBe(true);
    expect(usaUnaParolaRiservata('Partecipante-7K2QXM', parole)).toBe(true);
    expect(usaUnaParolaRiservata('relatóre', parole)).toBe(true);
  });

  it('quelle corte solo da sole', () => {
    expect(usaUnaParolaRiservata('Host', parole)).toBe(true);
    expect(usaUnaParolaRiservata('Host1', parole)).toBe(true);
    expect(usaUnaParolaRiservata('host_22', parole)).toBe(true);
    expect(usaUnaParolaRiservata('Hostess', parole)).toBe(false);
    expect(usaUnaParolaRiservata('Pippo', parole)).toBe(false);
  });
});

describe('alternativeNickname', () => {
  it('lo stesso nickname con un numero in fondo, mai uguale a quello chiesto', () => {
    expect(alternativeNickname('Pippo').slice(0, 2)).toEqual(['Pippo2', 'Pippo3']);
    expect(alternativeNickname('Pippo2')).not.toContain('Pippo2');
    expect(alternativeNickname('Pippo2')[0]).toBe('Pippo3');
  });

  it('dentro la lunghezza massima, e nella forma ammessa', () => {
    const lungo = 'P'.repeat(NICKNAME_MAX);
    for (const c of alternativeNickname(lungo)) {
      expect([...c].length).toBeLessThanOrEqual(NICKNAME_MAX);
      expect(difettoDiForma(c)).toBeNull();
    }
  });
});

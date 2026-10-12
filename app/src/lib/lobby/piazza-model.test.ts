import { describe, expect, it } from 'vitest';

// Dai sorgenti della piazza, non dal pacchetto: l'indice tira dentro Phaser.
import {
  CAPPELLI,
  codificaLook,
  decodificaLook,
  LOOK_PREDEFINITO,
  lookCasuale,
  lookDaSeme,
  lookDaVecchio,
  lookDi,
  normalizzaLook,
  SCELTE,
  stessoLook,
  type AvatarLook,
} from '../../../../lobby/src/lobby/avatar/look';
import { EMOTE_KEY } from '../../../../lobby/src/lobby/emotes';
import { CODICI_SEGRETI } from '../../../../lobby/src/lobby/segreti';
import { contaUmori, eUmore, UMORI } from '../../../../lobby/src/lobby/umori';
import { GARDEN_UMORI, isGardenUmore } from '../garden/umori';

describe('l’aspetto del personaggio', () => {
  it('viaggia in avatarId in al più 16 caratteri e torna uguale', () => {
    for (let i = 0; i < 50; i++) {
      const look = lookCasuale();
      const id = codificaLook(look);
      expect(id.length).toBeLessThanOrEqual(16);
      expect(stessoLook(decodificaLook(id)!, look)).toBe(true);
    }
  });

  it('la codifica di prima (colore e lettere) non è un aspetto', () => {
    expect(decodificaLook('0066cc')).toBeNull();
    expect(decodificaLook('d9364fhg')).toBeNull();
  });

  it('riporta dentro le scelte possibili i valori fuori misura', () => {
    const look = normalizzaLook({ pelle: 99, capelli: -1, maglia: 1.5 } as Partial<AvatarLook>);
    expect(look.pelle).toBe(LOOK_PREDEFINITO.pelle);
    expect(look.capelli).toBe(LOOK_PREDEFINITO.capelli);
    expect(look.maglia).toBe(LOOK_PREDEFINITO.maglia);
    for (const [campo, n] of Object.entries(SCELTE)) {
      expect(normalizzaLook({ [campo]: n - 1 })[campo as keyof AvatarLook]).toBe(n - 1);
    }
  });

  it('chi non ha scelto ha un personaggio a caso, sempre lo stesso per lui, diverso dagli altri', () => {
    expect(stessoLook(lookDaSeme('self_abc12345'), lookDaSeme('self_abc12345'))).toBe(true);
    const codici = new Set(Array.from({ length: 40 }, (_, i) => codificaLook(lookDaSeme(`self_${i}`))));
    expect(codici.size).toBeGreaterThan(35);
    expect(stessoLook(lookDi({ id: 'x' }), lookDaSeme('x'))).toBe(true);
  });

  it('a caso, la corona non esce mai: è il segreto del pozzo', () => {
    const corona = CAPPELLI.indexOf('corona');
    for (let i = 0; i < 300; i++) expect(lookCasuale().cappello).not.toBe(corona);
  });

  it('l’aspetto di prima si ritrova: colore della maglia, caschetto, occhiali', () => {
    const look = lookDaVecchio('#D9364F', true, true);
    expect(look.coloreMaglia).toBe(1);
    expect(CAPPELLI[look.cappello]).toBe('caschetto');
    expect(look.occhiali).toBe(1);
  });
});

describe('l’umore della piazza', () => {
  it('il server accetta esattamente gli umori che la piazza sa contare', () => {
    expect([...GARDEN_UMORI].sort()).toEqual([...UMORI].sort());
    expect(isGardenUmore('felice')).toBe(true);
    expect(isGardenUmore('arrabbiato')).toBe(false);
  });

  it('si contano solo gli umori validi', () => {
    expect(contaUmori(['felice', 'felice', null, undefined, 'carico'])).toEqual({
      felice: 2,
      curioso: 0,
      assonnato: 0,
      carico: 1,
    });
    expect(eUmore('carico')).toBe(true);
    expect(eUmore('x')).toBe(false);
  });
});

describe('i codici segreti', () => {
  it('le parole non usano i tasti dei gesti né quelli per camminare', () => {
    const occupati = new Set([...Object.values(EMOTE_KEY), 'w', 'a', 's', 'd', ' ']);
    for (const codice of [CODICI_SEGRETI.fuochi, CODICI_SEGRETI.neve]) {
      for (const k of codice) expect(occupati.has(k)).toBe(false);
    }
  });
});

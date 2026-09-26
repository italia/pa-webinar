// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { closingPhase, exitDestination, phaseAfterTokenConflict } from './live-phase';

describe('closingPhase', () => {
  it('«Evento concluso» solo per un evento davvero concluso', () => {
    expect(closingPhase('ENDED')).toBe('ended');
  });

  it('chi esce da solo da un evento in corso può rientrare', () => {
    expect(closingPhase('LIVE')).toBe('left');
    expect(closingPhase('IDLE')).toBe('left');
    expect(closingPhase('PUBLISHED')).toBe('left');
  });
});

describe('phaseAfterTokenConflict', () => {
  it('evento concluso nel frattempo: la chiusura, non un errore in inglese', () => {
    expect(phaseAfterTokenConflict('ENDED')).toBe('ended');
  });

  it('sala tornata in attesa: la sala d’attesa', () => {
    expect(phaseAfterTokenConflict('IDLE')).toBe('waiting');
    expect(phaseAfterTokenConflict('PROVISIONING')).toBe('waiting');
    expect(phaseAfterTokenConflict('PUBLISHED')).toBe('waiting');
  });

  it('evento in corso o stato ignoto: resta l’errore', () => {
    expect(phaseAfterTokenConflict('LIVE')).toBeNull();
    expect(phaseAfterTokenConflict('ARCHIVED')).toBeNull();
    expect(phaseAfterTokenConflict(undefined)).toBeNull();
  });
});

describe('exitDestination', () => {
  it('evento a calendario: la sua pagina', () => {
    expect(exitDestination('SCHEDULED', 'evento')).toBe('/events/evento');
    expect(exitDestination(undefined, 'evento')).toBe('/events/evento');
  });

  it('chiamata istantanea: la home, perché la pagina evento non c’è', () => {
    expect(exitDestination('INSTANT', 'call')).toBe('/');
  });
});

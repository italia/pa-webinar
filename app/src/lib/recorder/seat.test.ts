import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { RECORDER_SEAT_PREFIX, isRecorderSeat, recorderSeat } from './seat';

/**
 * Il posto del registratore si riconosce anche in Prosody (mod_pa_occupants),
 * che ne tiene una copia del prefisso: le due devono restare uguali, nel
 * modulo e nella sua copia del chart.
 */
describe('posto del registratore', () => {
  it('si costruisce e si riconosce dal prefisso', () => {
    expect(recorderSeat('r1')).toBe(`${RECORDER_SEAT_PREFIX}r1`);
    expect(isRecorderSeat(recorderSeat('r1'))).toBe(true);
    expect(isRecorderSeat('reg-123')).toBe(false);
  });

  it('il modulo di Prosody usa lo stesso prefisso', () => {
    const radice = resolve(__dirname, '../../../..');
    for (const file of [
      'infra/jitsi/prosody-plugins/mod_pa_occupants.lua',
      'infra/helm/pa-webinar/files/prosody-plugins/mod_pa_occupants.lua',
    ]) {
      const lua = readFileSync(resolve(radice, file), 'utf8');
      expect(lua, file).toContain(`local RECORDER_SEAT_PREFIX = '${RECORDER_SEAT_PREFIX}';`);
    }
  });
});

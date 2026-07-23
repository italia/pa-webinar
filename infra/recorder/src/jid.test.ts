import { describe, it, expect } from 'vitest';

import { recorderJid } from './index.js';

describe('recorderJid', () => {
  it('compone parte locale e dominio nascosto', () => {
    expect(recorderJid('recorder', 'hidden.meet.jitsi')).toBe(
      'recorder@hidden.meet.jitsi',
    );
  });

  it('lascia intatto un JID già completo (ignora il dominio del chart)', () => {
    expect(recorderJid('bot@altro.dominio', 'hidden.meet.jitsi')).toBe(
      'bot@altro.dominio',
    );
  });

  it('senza utente non c è identità: si torna al JWT', () => {
    expect(recorderJid(undefined, 'hidden.meet.jitsi')).toBeUndefined();
    expect(recorderJid('  ', 'hidden.meet.jitsi')).toBeUndefined();
  });

  it('utente senza dominio è una configurazione a metà, non un JID', () => {
    // Meglio ricadere sul JWT (bot visibile) che tentare un login che fallisce
    // e lasciare l evento senza registrazione.
    expect(recorderJid('recorder', undefined)).toBeUndefined();
    expect(recorderJid('recorder', '')).toBeUndefined();
  });
});

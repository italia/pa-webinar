import { describe, expect, it } from 'vitest';

import { consensiRichiesti } from './consents';

const base = {
  recordingEnabled: true,
  multitrackRecordingEnabled: true,
  participantsCanUnmute: true,
  participantsCanStartVideo: true,
  participantsCanShareScreen: true,
};
const ascolto = {
  participantsCanUnmute: false,
  participantsCanStartVideo: false,
  participantsCanShareScreen: false,
};

describe('consensiRichiesti', () => {
  it('chi può parlare e mostrarsi presta entrambi i consensi', () => {
    expect(consensiRichiesti(base)).toEqual({
      registrazione: true,
      avvisoRegistrazione: false,
      tracce: true,
    });
  });

  it("solo ascolto: l'informativa al posto della casella, la traccia resta obbligatoria", () => {
    // Il registratore multitraccia non filtra per consenso: chi riceve la
    // parola dev'essere già coperto.
    expect(consensiRichiesti({ ...base, ...ascolto })).toEqual({
      registrazione: false,
      avvisoRegistrazione: true,
      tracce: true,
    });
  });

  it('il solo schermo condiviso basta a chiedere il consenso alla registrazione', () => {
    expect(
      consensiRichiesti({ ...base, ...ascolto, participantsCanShareScreen: true }).registrazione,
    ).toBe(true);
  });

  it('senza registrazione non si chiede né si avvisa', () => {
    expect(
      consensiRichiesti({ ...base, recordingEnabled: false, multitrackRecordingEnabled: false }),
    ).toEqual({ registrazione: false, avvisoRegistrazione: false, tracce: false });
  });
});

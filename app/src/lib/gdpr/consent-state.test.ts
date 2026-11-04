import { describe, expect, it } from 'vitest';

import { consensiDellIscrizione } from './consent-state';

const BASE = {
  consentRecording: null,
  consentRecordingWithdrawnAt: null,
  recordingConsents: [],
  consentMultitrack: null,
  consentMultitrackWithdrawnAt: null,
  multitrackConsents: [],
  consentFutureCommunications: false,
  consentFutureCommunicationsWithdrawnAt: null,
};
const RITIRO = new Date('2026-11-05T10:00:00.000Z');

describe('consensiDellIscrizione', () => {
  it('un consenso mai chiesto non compare', () => {
    expect(consensiDellIscrizione(BASE)).toEqual({
      recording: null,
      transcription: null,
      futureCommunications: null,
    });
  });

  it("un rifiuto all'iscrizione e' un consenso non dato, non ritirato", () => {
    expect(
      consensiDellIscrizione({ ...BASE, consentRecording: false }).recording
    ).toEqual({
      dato: false,
      ritiratoIl: null,
    });
  });

  it("dato all'iscrizione e poi ritirato", () => {
    const r = consensiDellIscrizione({
      ...BASE,
      consentRecording: true,
      consentRecordingWithdrawnAt: RITIRO,
    });
    expect(r.recording).toEqual({ dato: false, ritiratoIl: RITIRO.toISOString() });
  });

  it("dato in sala conta anche se all'iscrizione aveva detto no", () => {
    const r = consensiDellIscrizione({
      ...BASE,
      consentMultitrack: false,
      multitrackConsents: [{ withdrawnAt: null }],
    });
    expect(r.transcription).toEqual({ dato: true, ritiratoIl: null });
  });

  it('dato di nuovo dopo un ritiro non mostra il ritiro', () => {
    const r = consensiDellIscrizione({
      ...BASE,
      consentRecording: true,
      consentRecordingWithdrawnAt: RITIRO,
      recordingConsents: [{ withdrawnAt: null }],
    });
    expect(r.recording).toEqual({ dato: true, ritiratoIl: null });
  });

  it('comunicazioni future ritirate', () => {
    const r = consensiDellIscrizione({
      ...BASE,
      consentFutureCommunicationsWithdrawnAt: RITIRO,
    });
    expect(r.futureCommunications).toEqual({
      dato: false,
      ritiratoIl: RITIRO.toISOString(),
    });
  });
});

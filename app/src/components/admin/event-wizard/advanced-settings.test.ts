import { describe, expect, it } from 'vitest';

import { ISTANZA_PREDEFINITA, stimaCapacita } from '@/lib/capacity/model';
import { defaultMatrix, type PermissionMatrix } from '@/lib/utils/permission-matrix';

import { inputCapacita, riepilogoCapacita } from './advanced-settings';
import type { WizardForm } from './wizard-shell';

/**
 * Le scelte del wizard che pesano sul ponte video, e la riga del riepilogo
 * che ne viene.
 */

function modulo(patch: Partial<WizardForm> = {}): WizardForm {
  return {
    maxParticipants: 120,
    expectedSenderRatioPct: 100,
    permissionMatrix: defaultMatrix(),
    moderators: [],
    speakers: [],
    videoQuality: null,
    recordingEnabled: false,
    liveCaptionsEnabled: true,
    startsAt: '2026-10-20T10:00',
    endsAt: '2026-10-20T11:30',
    ...patch,
  } as WizardForm;
}

const tutti = (matrice: PermissionMatrix): PermissionMatrix => ({
  ...matrice,
  mic: ['GUEST', 'SPEAKER', 'MODERATOR'],
  video: ['GUEST', 'SPEAKER', 'MODERATOR'],
});

describe('inputCapacita', () => {
  it('chi presenta: il moderatore principale, i moderatori e i relatori', () => {
    const input = inputCapacita(
      modulo({
        moderators: [{}, {}] as WizardForm['moderators'],
        speakers: [{}] as WizardForm['speakers'],
      })
    );
    expect(input.presenters).toBe(4);
    expect(input.durationHours).toBeCloseTo(1.5);
  });

  it('i permessi della matrice decidono webcam e microfoni dei partecipanti', () => {
    const aperti = inputCapacita(modulo({ permissionMatrix: tutti(defaultMatrix()) }));
    expect(aperti.participantsCanStartVideo).toBe(true);
    expect(aperti.participantsCanUnmute).toBe(true);
  });
});

describe('riepilogoCapacita', () => {
  it('e la stima del pannello, in una riga', () => {
    const form = modulo({ permissionMatrix: tutti(defaultMatrix()) });
    const istanza = { ...ISTANZA_PREDEFINITA, coresPerBridge: 15, numLoudest: 5 };
    const riga = riepilogoCapacita(form, istanza);
    const stima = stimaCapacita(inputCapacita(form), istanza);
    expect(riga).toEqual({
      carico: stima.ponte.carico,
      livello: stima.ponte.livello,
      downMbps: stima.perPartecipante.downMbps,
    });
  });

  it('un evento piu grande alza il carico e il livello', () => {
    const istanza = { ...ISTANZA_PREDEFINITA, coresPerBridge: 15, numLoudest: 5 };
    const piccolo = riepilogoCapacita(
      modulo({ permissionMatrix: tutti(defaultMatrix()), maxParticipants: 30 }),
      istanza
    );
    const grande = riepilogoCapacita(
      modulo({ permissionMatrix: tutti(defaultMatrix()), maxParticipants: 300 }),
      istanza
    );
    expect(piccolo.livello).toBe('ampio');
    expect(grande.carico).toBeGreaterThan(piccolo.carico);
    expect(grande.livello).toBe('nonBasta');
  });
});

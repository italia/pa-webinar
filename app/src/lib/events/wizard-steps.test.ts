import { describe, expect, it } from 'vitest';

import {
  isWizardStep,
  passiPrincipali,
  passoDisponibile,
  wizardStepFromParam,
} from './wizard-steps';

describe('wizardStepFromParam', () => {
  it('riconosce i passi di oggi', () => {
    expect(wizardStepFromParam('schedule')).toEqual({ step: 'schedule' });
    expect(wizardStepFromParam('advanced')).toEqual({ step: 'advanced' });
    expect(wizardStepFromParam('programme')).toEqual({ step: 'programme' });
  });

  it('gli indirizzi di una volta aprono la sezione delle impostazioni avanzate', () => {
    expect(wizardStepFromParam('permissions')).toEqual({ step: 'advanced', section: 'participation' });
    expect(wizardStepFromParam('content')).toEqual({ step: 'advanced', section: 'content' });
    expect(isWizardStep('permissions')).toBe(false);
  });

  it('un valore che non dice niente non apre niente', () => {
    expect(wizardStepFromParam('altro')).toBeNull();
    expect(wizardStepFromParam(['review'])).toBeNull();
    expect(wizardStepFromParam(undefined)).toBeNull();
  });
});

describe('passiPrincipali', () => {
  it('un evento programmato ha il programma fra «Persone» e il riepilogo', () => {
    expect(passiPrincipali(false)).toEqual(['base', 'schedule', 'invites', 'programme', 'review']);
  });

  it('una chiamata istantanea non ha il passo del programma', () => {
    expect(passiPrincipali(true)).toEqual(['base', 'schedule', 'invites', 'review']);
  });

  it('il programma di una chiamata istantanea apre «Persone»; gli altri passi restano', () => {
    expect(passoDisponibile('programme', true)).toBe('invites');
    expect(passoDisponibile('programme', false)).toBe('programme');
    expect(passoDisponibile('review', true)).toBe('review');
  });
});

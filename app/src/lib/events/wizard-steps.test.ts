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

  it('«Permessi» e\' un passo; gli indirizzi di una volta aprono il loro posto di oggi', () => {
    expect(wizardStepFromParam('permissions')).toEqual({ step: 'permissions' });
    expect(isWizardStep('permissions')).toBe(true);
    expect(wizardStepFromParam('participation')).toEqual({ step: 'permissions' });
    expect(wizardStepFromParam('content')).toEqual({ step: 'advanced', section: 'content' });
  });

  it('un valore che non dice niente non apre niente', () => {
    expect(wizardStepFromParam('altro')).toBeNull();
    expect(wizardStepFromParam(['review'])).toBeNull();
    expect(wizardStepFromParam(undefined)).toBeNull();
  });
});

describe('passiPrincipali', () => {
  it('un evento programmato ha il programma fra «Persone» e il riepilogo', () => {
    expect(passiPrincipali(false)).toEqual(['base', 'schedule', 'invites', 'programme', 'permissions', 'review']);
  });

  it('una chiamata istantanea non ha il passo del programma', () => {
    expect(passiPrincipali(true)).toEqual(['base', 'schedule', 'invites', 'permissions', 'review']);
  });

  it('il programma di una chiamata istantanea apre «Persone»; gli altri passi restano', () => {
    expect(passoDisponibile('programme', true)).toBe('invites');
    expect(passoDisponibile('programme', false)).toBe('programme');
    expect(passoDisponibile('review', true)).toBe('review');
  });
});

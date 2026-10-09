import { describe, expect, it } from 'vitest';

import { isWizardStep, wizardStepFromParam } from './wizard-steps';

describe('wizardStepFromParam', () => {
  it('riconosce i passi di oggi', () => {
    expect(wizardStepFromParam('schedule')).toEqual({ step: 'schedule' });
    expect(wizardStepFromParam('advanced')).toEqual({ step: 'advanced' });
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

import { describe, expect, it } from 'vitest';

import { updateSettingsSchema } from '@/lib/validation/site-settings';

import { settingsFieldError, type SettingsIssue } from './settings-field-error';

/**
 * Dal rifiuto del server al campo da correggere. I problemi arrivano dalla
 * stessa validazione della rotta, ridotti alla forma che la rotta manda.
 */
function problemi(body: unknown): SettingsIssue[] {
  const r = updateSettingsSchema.safeParse(body);
  if (r.success) throw new Error('doveva fallire');
  return r.error.issues.map((i) => ({
    path: i.path,
    code: i.code,
    ...('validation' in i && typeof i.validation === 'string' && { validation: i.validation }),
    ...('type' in i && typeof i.type === 'string' && { type: i.type }),
    ...('minimum' in i && { minimum: Number(i.minimum) }),
    ...('maximum' in i && { maximum: Number(i.maximum) }),
  }));
}

describe('settingsFieldError', () => {
  it('email non valida: scheda Funzioni, campo e tipo', () => {
    expect(settingsFieldError(problemi({ supportEmail: 'non-una-email' }))).toEqual({
      field: 'supportEmail',
      tab: 'features',
      inputId: 'supportEmail',
      problem: 'email',
    });
  });

  it('indirizzo che resta non valido anche con lo schema', () => {
    expect(settingsFieldError(problemi({ organizationUrl: 'non è un indirizzo' }))).toMatchObject({
      tab: 'branding',
      inputId: 'organizationUrl',
      problem: 'url',
    });
  });

  it('testo troppo lungo e numeri fuori dai limiti portano il limite', () => {
    expect(settingsFieldError(problemi({ siteName: 'x'.repeat(201) }))).toMatchObject({
      problem: 'tooLong',
      limit: 200,
    });
    expect(settingsFieldError(problemi({ jvbPreScaleMinutes: 0 }))).toMatchObject({
      tab: 'features',
      problem: 'min',
      limit: 1,
    });
    expect(settingsFieldError(problemi({ jvbMaxReplicas: 99 }))).toMatchObject({
      tab: 'scaling',
      problem: 'max',
      limit: 50,
    });
  });

  it('un link del pie\' di pagina porta al suo campo', () => {
    const links = [{ title: 'ok', url: '/a' }, { title: 'x'.repeat(101), url: '/b' }];
    expect(settingsFieldError(problemi({ footerLinks: links }))).toMatchObject({
      tab: 'footer',
      inputId: 'link-title-1',
      problem: 'tooLong',
    });
  });

  it('i testi per lingua portano al campo della lingua, o a nessuno se il modulo non lo mostra', () => {
    expect(settingsFieldError([{ path: ['privacyPolicy', 'en'] }])).toMatchObject({
      tab: 'pages',
      inputId: 'privacyEn',
    });
    // Il tedesco non ha un campo nella scheda: meglio nessun campo che quello sbagliato.
    expect(settingsFieldError([{ path: ['privacyPolicy', 'de'] }])).toBeNull();
    expect(settingsFieldError([{ path: ['aiConsentDisclosure', 'fr'] }])).toMatchObject({
      tab: 'postprod',
      inputId: 'aiConsentDisclosure-fr',
    });
  });

  it('il motto porta la lingua che ha l\'errore', () => {
    expect(settingsFieldError(problemi({ siteTagline: { it: 'Breve', fr: 'x'.repeat(201) } }))).toMatchObject({
      field: 'siteTagline',
      tab: 'header',
      inputId: 'hdr-tagline',
      locale: 'fr',
      problem: 'tooLong',
    });
  });

  it('un testo obbligatorio vuoto e\' «obbligatorio», non «non valido»', () => {
    expect(settingsFieldError(problemi({ siteName: '' }))).toMatchObject({
      field: 'siteName',
      problem: 'required',
    });
  });

  it('un problema su un campo che il modulo non mostra non porta da nessuna parte', () => {
    expect(settingsFieldError([{ path: ['translationOverrides', 'it'] }])).toBeNull();
    expect(settingsFieldError('Validation failed')).toBeNull();
  });
});

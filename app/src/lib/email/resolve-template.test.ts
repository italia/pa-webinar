import { describe, expect, it } from 'vitest';

import {
  applyOverride,
  interpolate,
  type EmailTemplateOverride,
  type ResolvedEmailTemplate,
  type TemplatePlaceholders,
} from './resolve-template';

const BASE: ResolvedEmailTemplate = {
  subject: 'Default subject: Event',
  heading: 'Default heading',
  bodyIntro: 'Default intro',
  ctaLabel: 'Join',
  infoNote: 'Default note',
  footerNote: 'Default footer',
};

const VARS: TemplatePlaceholders = {
  eventTitle: 'Webinar Q1',
  eventDate: '15/05/2026',
  eventTime: '10:00',
  eventDuration: '1 ora',
  joinUrl: 'https://example.it/join/abc',
  eventPageUrl: 'https://example.it/event',
  siteName: 'Eventi PA',
  offsetMinutes: 60,
};

describe('interpolate', () => {
  it('replaces known placeholders', () => {
    expect(interpolate('Hello {{eventTitle}}', VARS)).toBe('Hello Webinar Q1');
  });

  it('tolerates internal whitespace in placeholders', () => {
    expect(interpolate('{{ eventTitle }}', VARS)).toBe('Webinar Q1');
  });

  it('leaves unknown placeholders untouched', () => {
    expect(interpolate('Token {{unknownFoo}} here', VARS)).toBe('Token {{unknownFoo}} here');
  });

  it('emits empty string when value is undefined', () => {
    expect(interpolate('[{{eventTitle}}]', {})).toBe('[]');
  });

  it('handles multiple placeholders in one string', () => {
    expect(interpolate('{{eventTitle}} at {{eventTime}}', VARS)).toBe('Webinar Q1 at 10:00');
  });

  it('stringifies numeric values', () => {
    expect(interpolate('{{offsetMinutes}} min', VARS)).toBe('60 min');
  });
});

describe('applyOverride', () => {
  it('returns base copy untouched when override is null', () => {
    const r = applyOverride(BASE, null, VARS);
    expect(r).toEqual(BASE);
  });

  it('applies overrides and interpolates placeholders', () => {
    const ovr: EmailTemplateOverride = {
      subject: 'Welcome to {{eventTitle}}',
      heading: 'You are in!',
    };
    const r = applyOverride(BASE, ovr, VARS);
    expect(r.subject).toBe('Welcome to Webinar Q1');
    expect(r.heading).toBe('You are in!');
    // untouched fields fall back to base
    expect(r.bodyIntro).toBe(BASE.bodyIntro);
    expect(r.ctaLabel).toBe(BASE.ctaLabel);
  });

  it('treats empty string override as "no override"', () => {
    const ovr: EmailTemplateOverride = { subject: '', heading: '' };
    const r = applyOverride(BASE, ovr, VARS);
    expect(r.subject).toBe(BASE.subject);
    expect(r.heading).toBe(BASE.heading);
  });

  it('treats null override value as "no override"', () => {
    const ovr: EmailTemplateOverride = { subject: null };
    const r = applyOverride(BASE, ovr, VARS);
    expect(r.subject).toBe(BASE.subject);
  });

  it('allows clearing bodyIntro and infoNote to null via base', () => {
    const baseNoIntro: ResolvedEmailTemplate = { ...BASE, bodyIntro: null, infoNote: null };
    const r = applyOverride(baseNoIntro, null, VARS);
    expect(r.bodyIntro).toBeNull();
    expect(r.infoNote).toBeNull();
  });

  it('interpolates placeholders in all overridable fields', () => {
    const ovr: EmailTemplateOverride = {
      subject: 'S {{eventTitle}}',
      heading: 'H {{eventTitle}}',
      bodyIntro: 'I {{eventDate}}',
      ctaLabel: 'C {{eventTitle}}',
      infoNote: 'N {{joinUrl}}',
      footerNote: 'F {{siteName}}',
    };
    const r = applyOverride(BASE, ovr, VARS);
    expect(r.subject).toBe('S Webinar Q1');
    expect(r.heading).toBe('H Webinar Q1');
    expect(r.bodyIntro).toBe('I 15/05/2026');
    expect(r.ctaLabel).toBe('C Webinar Q1');
    expect(r.infoNote).toBe('N https://example.it/join/abc');
    expect(r.footerNote).toBe('F Eventi PA');
  });
});

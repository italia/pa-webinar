import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';

import {
  NON_PUBLIC_SETTING_FIELDS,
  PUBLIC_SETTING_FIELDS,
  publicSettings,
} from './public-projection';

/**
 * `GET /api/admin/settings` answers anonymous callers and is cached publicly for
 * 300s. The projection was a one-field blacklist, so every column added later
 * became public by default — which is how a Reply-To mailbox would have shipped
 * to scrapers. These guards make the classification exhaustive and enforced.
 */
const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'SiteSetting');

function columns(): string[] {
  if (!model) throw new Error('SiteSetting not found in the Prisma DMMF');
  return model.fields
    .filter((f) => f.kind === 'scalar' || f.kind === 'enum')
    .map((f) => f.name);
}

describe('public settings projection', () => {
  it('classifies EVERY SiteSetting column as public or withheld', () => {
    const pub = new Set<string>(PUBLIC_SETTING_FIELDS);
    const priv = new Set(Object.keys(NON_PUBLIC_SETTING_FIELDS));
    const unclassified = columns().filter((c) => !pub.has(c) && !priv.has(c));
    expect(
      unclassified,
      `New SiteSetting column(s) not classified: ${unclassified.join(', ')}. ` +
        'Add each to PUBLIC_SETTING_FIELDS, or to NON_PUBLIC_SETTING_FIELDS with a reason. ' +
        'Unclassified means it would be served to anonymous callers.',
    ).toEqual([]);
  });

  it('never both publishes and withholds the same column', () => {
    const priv = new Set(Object.keys(NON_PUBLIC_SETTING_FIELDS));
    expect(PUBLIC_SETTING_FIELDS.filter((f) => priv.has(f))).toEqual([]);
  });

  it('classifies no column that does not exist', () => {
    const real = new Set(columns());
    const ghosts = [...PUBLIC_SETTING_FIELDS, ...Object.keys(NON_PUBLIC_SETTING_FIELDS)]
      .filter((f) => !real.has(f));
    expect(ghosts).toEqual([]);
  });

  it('withholds the reply-to mailbox and the operator HTML', () => {
    const out = publicSettings({
      siteName: 'PA Webinar',
      emailFromName: 'Comune di X',
      emailReplyTo: 'eventi@comune.it',
      customHomeHtml: '<h1>hi</h1>',
    });
    expect(out).not.toHaveProperty('emailReplyTo');
    expect(out).not.toHaveProperty('customHomeHtml');
    // The sender NAME is in every message we send: public by nature.
    expect(out.emailFromName).toBe('Comune di X');
    expect(out.siteName).toBe('PA Webinar');
  });
});

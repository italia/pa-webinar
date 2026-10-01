import { describe, expect, it } from 'vitest';

import { eventAdminPath } from './admin-links';

const ID = '3f0c1d2e-4b5a-6978-8a9b-0c1d2e3f4a5b';

describe('eventAdminPath', () => {
  it('leaves the moderator token out for a staff session', () => {
    expect(eventAdminPath(ID)).toBe(`/admin/events/${ID}`);
    expect(eventAdminPath(ID, { edit: true })).toBe(`/admin/events/${ID}/edit`);
    expect(eventAdminPath(ID, { viaToken: null })).not.toContain('token=');
  });

  it('keeps the token for whoever came in with the moderator link', () => {
    expect(eventAdminPath(ID, { viaToken: 'abc' })).toBe(`/admin/events/${ID}?token=abc`);
    expect(eventAdminPath(ID, { edit: true, viaToken: 'a b' })).toBe(
      `/admin/events/${ID}/edit?token=a%20b`,
    );
  });
});

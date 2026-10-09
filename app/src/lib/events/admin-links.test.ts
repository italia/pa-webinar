import { describe, expect, it } from 'vitest';

import { eventAdminPath } from './admin-links';

const ID = '3f0c1d2e-4b5a-6978-8a9b-0c1d2e3f4a5b';

describe('eventAdminPath', () => {
  it('leaves the moderator token out for a staff session', () => {
    expect(eventAdminPath(ID)).toBe(`/admin/events/${ID}`);
    expect(eventAdminPath(ID, { edit: true })).toBe(`/admin/events/${ID}/edit`);
    expect(eventAdminPath(ID, { viaToken: null })).not.toContain('token=');
  });

  it('opens the edit wizard on a given step', () => {
    expect(eventAdminPath(ID, { edit: true, step: 'advanced', section: 'participation' })).toBe(
      `/admin/events/${ID}/edit?step=advanced&section=participation`,
    );
    // La sezione vale solo per le impostazioni avanzate.
    expect(eventAdminPath(ID, { edit: true, step: 'schedule', section: 'data' })).toBe(
      `/admin/events/${ID}/edit?step=schedule`,
    );
    expect(eventAdminPath(ID, { edit: true, step: 'review', viaToken: 'abc' })).toBe(
      `/admin/events/${ID}/edit?step=review&token=abc`,
    );
    // Il passo vale solo per la modifica.
    expect(eventAdminPath(ID, { step: 'review' })).toBe(`/admin/events/${ID}`);
    // Il token si codifica come sempre.
    expect(eventAdminPath(ID, { viaToken: "a!'()~*" })).toBe(
      `/admin/events/${ID}?token=${encodeURIComponent("a!'()~*")}`,
    );
  });

  it('keeps the token for whoever came in with the moderator link', () => {
    expect(eventAdminPath(ID, { viaToken: 'abc' })).toBe(`/admin/events/${ID}?token=abc`);
    expect(eventAdminPath(ID, { edit: true, viaToken: 'a b' })).toBe(
      `/admin/events/${ID}/edit?token=a%20b`,
    );
  });
});

import { describe, it, expect } from 'vitest';

function normalizeRoute(pathname: string): string {
  return pathname
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d+/g, '/:id');
}

describe('normalizeRoute', () => {
  it('replaces UUIDs with :id', () => {
    expect(normalizeRoute('/api/events/550e8400-e29b-41d4-a716-446655440000'))
      .toBe('/api/events/:id');
  });

  it('replaces numeric IDs with :id', () => {
    expect(normalizeRoute('/api/events/123/registrations'))
      .toBe('/api/events/:id/registrations');
  });

  it('leaves non-ID paths unchanged', () => {
    expect(normalizeRoute('/api/status/infrastructure'))
      .toBe('/api/status/infrastructure');
  });

  it('handles multiple UUIDs', () => {
    expect(normalizeRoute('/api/events/550e8400-e29b-41d4-a716-446655440000/qa/660e8400-e29b-41d4-a716-446655440001'))
      .toBe('/api/events/:id/qa/:id');
  });
});

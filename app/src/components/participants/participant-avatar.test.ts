import { describe, expect, it } from 'vitest';

import { safeAvatarSrc } from './participant-avatar';

const ORIGIN = 'https://webinar.gov.it';

describe('safeAvatarSrc', () => {
  it('le immagini incorporate e quelle del portale si mostrano', () => {
    expect(safeAvatarSrc('data:image/svg+xml;base64,PHN2Zz4=', ORIGIN)).toBe('data:image/svg+xml;base64,PHN2Zz4=');
    expect(safeAvatarSrc('https://webinar.gov.it/api/avatar/photo/abc?v=1', ORIGIN)).toBe(
      'https://webinar.gov.it/api/avatar/photo/abc?v=1',
    );
    expect(safeAvatarSrc('/api/avatar?ref=x', ORIGIN)).toBe('https://webinar.gov.it/api/avatar?ref=x');
  });

  it('un indirizzo di terzi o un percorso qualunque no', () => {
    expect(safeAvatarSrc('https://www.gravatar.com/avatar/abc', ORIGIN)).toBeNull();
    expect(safeAvatarSrc('https://webinar.gov.it/altro.png', ORIGIN)).toBeNull();
    expect(safeAvatarSrc('javascript:alert(1)', ORIGIN)).toBeNull();
    expect(safeAvatarSrc('data:text/html;base64,PGI+', ORIGIN)).toBeNull();
    expect(safeAvatarSrc(undefined, ORIGIN)).toBeNull();
  });
});

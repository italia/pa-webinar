import { describe, it, expect } from 'vitest';

import {
  sanitizeSegment,
  recordingPrefix,
  trackKey,
  manifestKey,
  localTrackFilename,
  MULTITRACK_ROOT,
  MANIFEST_FILENAME,
  TRACK_FILE_EXT,
} from './paths';

describe('sanitizeSegment', () => {
  it('lascia passare alfanumerici, trattino e underscore', () => {
    expect(sanitizeSegment('abc-123_XYZ')).toBe('abc-123_XYZ');
  });

  it('neutralizza il path traversal', () => {
    expect(sanitizeSegment('../../etc/passwd')).toBe('______etc_passwd');
  });

  it('collassa slash e caratteri speciali in underscore', () => {
    expect(sanitizeSegment('a/b c.d')).toBe('a_b_c_d');
  });

  it('lancia su stringa vuota', () => {
    expect(() => sanitizeSegment('')).toThrow();
    expect(() => sanitizeSegment('///')).not.toThrow(); // diventa "___"
  });
});

describe('recordingPrefix', () => {
  it('costruisce il prefisso atteso', () => {
    expect(recordingPrefix('evt1', 'rec1')).toBe(
      `${MULTITRACK_ROOT}/evt1/rec1`,
    );
  });

  it('sanifica eventId e recordingId', () => {
    expect(recordingPrefix('e/v/t', 'r e c')).toBe(
      `${MULTITRACK_ROOT}/e_v_t/r_e_c`,
    );
  });
});

describe('trackKey', () => {
  it('produce la key audio con estensione opus', () => {
    expect(trackKey('evt1', 'rec1', 'p42')).toBe(
      `${MULTITRACK_ROOT}/evt1/rec1/audio/p42.${TRACK_FILE_EXT}`,
    );
  });

  it('sanifica il participantId nella key', () => {
    expect(trackKey('evt1', 'rec1', '../x')).toBe(
      `${MULTITRACK_ROOT}/evt1/rec1/audio/___x.${TRACK_FILE_EXT}`,
    );
  });
});

describe('manifestKey', () => {
  it('punta a tracks.json nel prefisso della registrazione', () => {
    expect(manifestKey('evt1', 'rec1')).toBe(
      `${MULTITRACK_ROOT}/evt1/rec1/${MANIFEST_FILENAME}`,
    );
  });
});

describe('localTrackFilename', () => {
  it('è piatto (nessuna sottocartella) e sanificato', () => {
    expect(localTrackFilename('p42')).toBe(`p42.${TRACK_FILE_EXT}`);
    expect(localTrackFilename('a/b')).toBe(`a_b.${TRACK_FILE_EXT}`);
  });
});

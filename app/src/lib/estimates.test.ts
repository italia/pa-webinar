import { describe, expect, it } from 'vitest';

import { calculateEstimates, estimateNumbers } from './estimates';

/**
 * Le stime di un evento in numeri (il pannello della capacita') e in parole
 * (la pagina dell'evento e l'istantanea salvata): gli stessi conti.
 */

const base = {
  maxParticipants: 100,
  recordingEnabled: true,
  participantsCanUnmute: true,
  participantsCanStartVideo: true,
  participantsCanShareScreen: true,
  startsAt: '2026-10-20T08:00:00.000Z',
  endsAt: '2026-10-20T09:30:00.000Z',
};

describe('estimateNumbers', () => {
  it('durata e spazio vengono dalle date', () => {
    const n = estimateNumbers(base);
    expect(n.durationHours).toBeCloseTo(1.5);
    expect(n.storageGB).toBeCloseTo((1.5 * 1.5 * 3600) / 8 / 1024);
  });
});

describe('quota di chi parla', () => {
  it('cambia i ponti, non la banda di ciascuno', () => {
    const grande = { ...base, maxParticipants: 1000 };
    const webinar = estimateNumbers({ ...grande, expectedSenderRatioPct: 5 });
    const tutti = estimateNumbers({ ...grande, expectedSenderRatioPct: 100 });
    expect(tutti.jvbCount).toBeGreaterThan(webinar.jvbCount);
    expect(tutti.participantDownMbps).toBe(webinar.participantDownMbps);
  });
});

describe('calculateEstimates', () => {
  it('mette in parole gli stessi numeri', () => {
    const n = estimateNumbers(base);
    const s = calculateEstimates(base);
    expect(s.jvbCount).toBe(n.jvbCount);
    expect(s.estimatedDuration).toBe('1h 30m');
    expect(s.storageEstimate).toBe(`~${n.storageGB.toFixed(1)} GB`);
    expect(calculateEstimates({ ...base, recordingEnabled: false }).storageEstimate).toBe(
      '~0 GB'
    );
  });
});

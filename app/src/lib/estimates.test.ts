import { describe, expect, it } from 'vitest';

import { ISTANZA_PREDEFINITA, stimaCapacita } from '@/lib/capacity/model';
import { DEFAULT_JVB_CONFIG, jvbsForEvent } from '@/lib/jvb-sizing';

import { calculateEstimates, estimateNumbers } from './estimates';

/**
 * La stima salvata con l'evento: un adattatore sul modello della capacita',
 * in numeri e in parole.
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
  it('durata e spazio vengono dalle date; senza date, due ore', () => {
    const n = estimateNumbers(base);
    expect(n.durationHours).toBeCloseTo(1.5);
    expect(n.storageGB).toBeCloseTo((4 * 1.5 * 3600) / 8 / 1024);
    expect(n.storageGBMax).toBeCloseTo((10 * 1.5 * 3600) / 8 / 1024);
    const senzaDate = estimateNumbers({
      ...base,
      startsAt: undefined,
      endsAt: undefined,
    });
    expect(senzaDate.durationHours).toBe(2);
    expect(estimateNumbers({ ...base, recordingEnabled: false }).storageGB).toBe(0);
  });

  it('sono i numeri del modello, con la sua versione', () => {
    const n = estimateNumbers(base);
    const s = stimaCapacita(
      {
        maxParticipants: 100,
        expectedSenderRatioPct: null,
        participantsCanStartVideo: true,
        participantsCanUnmute: true,
        presenters: 1,
        videoQuality: null,
        recordingEnabled: true,
        liveCaptionsEnabled: false,
        durationHours: 1.5,
      },
      ISTANZA_PREDEFINITA
    );
    expect(n.model).toBe(2);
    expect(n.participantDownMbps).toBe(s.perPartecipante.downMbps);
    expect(n.cores).toBe(s.ponte.core);
    expect(n.bridgeLoadPct).toBeCloseTo(s.ponte.carico * 100);
    expect(n.bridges).toBe(1);
    // I ponti dello scaler, con la sua formula, per confronto.
    expect(n.jvbCount).toBe(jvbsForEvent(100, 30, true, DEFAULT_JVB_CONFIG));
  });

  it('con piu iscritti che partecipanti attesi stima sugli iscritti', () => {
    expect(estimateNumbers({ ...base, registeredParticipants: 40 }).sizedFor).toBe(100);
    const oltre = estimateNumbers({ ...base, registeredParticipants: 140 });
    expect(oltre.sizedFor).toBe(140);
    expect(oltre.basedOnRegistrations).toBe(true);
  });
});

describe('quota di webcam accese', () => {
  it('cambia la banda di ciascuno e il carico del ponte', () => {
    const riunione = { ...base, maxParticipants: 40 };
    const poche = estimateNumbers({ ...riunione, expectedSenderRatioPct: 5 });
    const tutte = estimateNumbers({ ...riunione, expectedSenderRatioPct: 100 });
    expect(tutte.participantDownMbps).toBeGreaterThan(poche.participantDownMbps);
    expect(tutte.cores).toBeGreaterThan(poche.cores);
  });
});

describe('calculateEstimates', () => {
  it('mette in parole gli stessi numeri', () => {
    const n = estimateNumbers(base);
    const s = calculateEstimates(base);
    expect(s.jvbCount).toBe(n.jvbCount);
    expect(s.model).toBe(2);
    expect(s.estimatedDuration).toBe('1h 30m');
    expect(s.storageEstimate).toBe(`~${n.storageGB.toFixed(1)} GB`);
    expect(calculateEstimates({ ...base, recordingEnabled: false }).storageEstimate).toBe(
      '~0 GB'
    );
  });
});

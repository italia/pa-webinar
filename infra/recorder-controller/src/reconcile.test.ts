import { describe, it, expect } from 'vitest';

import { reconcile, type ActualJob, type DesiredRecorder } from './reconcile.js';

const d = (recordingId: string, eventId = `evt-${recordingId}`): DesiredRecorder => ({
  recordingId,
  eventId,
});
const j = (recordingId: string, jobName: string, phase: ActualJob['phase']): ActualJob => ({
  recordingId,
  jobName,
  phase,
});

describe('reconcile', () => {
  it('crea un recorder per ogni desiderato senza Job', () => {
    const plan = reconcile([d('r1'), d('r2')], []);
    expect(plan.toCreate.map((x) => x.recordingId)).toEqual(['r1', 'r2']);
    expect(plan.toDelete).toEqual([]);
  });

  it('NON crea se esiste già un Job attivo per quel recordingId', () => {
    const plan = reconcile([d('r1')], [j('r1', 'rec-r1', 'active')]);
    expect(plan.toCreate).toEqual([]);
    expect(plan.toDelete).toEqual([]);
  });

  it('NON ricrea se il Job è già riuscito (registrazione completata)', () => {
    const plan = reconcile([d('r1')], [j('r1', 'rec-r1', 'succeeded')]);
    expect(plan.toCreate).toEqual([]);
  });

  it('ricrea se il solo Job esistente è fallito (retry)', () => {
    const plan = reconcile([d('r1')], [j('r1', 'rec-r1', 'failed')]);
    expect(plan.toCreate.map((x) => x.recordingId)).toEqual(['r1']);
  });

  it('deduplica i Job attivi concorrenti per lo stesso recordingId', () => {
    const plan = reconcile(
      [d('r1')],
      [j('r1', 'rec-r1-a', 'active'), j('r1', 'rec-r1-b', 'active'), j('r1', 'rec-r1-c', 'active')],
    );
    // tiene il primo, elimina gli altri due; non crea (uno è già vivo).
    expect(plan.toCreate).toEqual([]);
    expect(plan.toDelete).toEqual(['rec-r1-b', 'rec-r1-c']);
  });

  it('non elimina Job per recordingId non più desiderati se attivi (li lascia finire)', () => {
    // r-old non è più desiderato (evento finito) ma il suo Job è attivo:
    // il recorder esce da solo per idle-timeout, non lo killiamo.
    const plan = reconcile([d('r1')], [j('r-old', 'rec-old', 'active'), j('r1', 'rec-r1', 'active')]);
    expect(plan.toDelete).toEqual([]);
    expect(plan.toCreate).toEqual([]);
  });

  it('caso misto: crea i mancanti e deduplica, in modo deterministico', () => {
    const plan = reconcile(
      [d('r1'), d('r2'), d('r3')],
      [
        j('r2', 'rec-r2-a', 'active'),
        j('r2', 'rec-r2-b', 'active'), // duplicato → delete
        j('r3', 'rec-r3', 'failed'), // failed → ricrea
      ],
    );
    expect(plan.toCreate.map((x) => x.recordingId)).toEqual(['r1', 'r3']);
    expect(plan.toDelete).toEqual(['rec-r2-b']);
  });

  it('è idempotente: applicare il piano e rieseguire non produce nuove create', () => {
    const desired = [d('r1')];
    // dopo la prima create, simuliamo il Job ora attivo:
    const afterApply = reconcile(desired, [j('r1', 'rec-r1', 'active')]);
    expect(afterApply.toCreate).toEqual([]);
    expect(afterApply.toDelete).toEqual([]);
  });
});

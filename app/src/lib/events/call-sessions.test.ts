/**
 * Chiusura delle sessioni di chiamata.
 *
 * Una sessione rimasta aperta su un evento concluso fa riportare alle
 * statistiche la finestra programmata (quattro ore per una chiamata
 * istantanea) al posto della durata vera, e toglie la retention. Qui si
 * fissano l'orario di chiusura e il picco che la sessione eredita.
 */

import { describe, expect, it } from 'vitest';

import { FakeLifecycleDb } from '@/test/fake-lifecycle-db';

import {
  closeOpenSessions,
  closeSessionsOfEndedEvents,
  closeStaleSessions,
  staleSessionCloseTime,
  type SessionTx,
} from './call-sessions';

const NOW = new Date('2026-09-25T10:00:00Z');
const MIN = 60_000;
const at = (min: number) => new Date(NOW.getTime() + min * MIN);
const tx = (db: FakeLifecycleDb) => db as unknown as SessionTx;

describe('closeOpenSessions', () => {
  it('chiude adesso le sessioni aperte degli eventi indicati, e solo quelle', async () => {
    const db = new FakeLifecycleDb(() => NOW);
    db.addEvent({ id: 'e1', status: 'ENDED', peakParticipants: 9 });
    db.addEvent({ id: 'e2', status: 'LIVE' });
    db.addSession({ id: 'aperta', eventId: 'e1', startedAt: at(-30) });
    db.addSession({ id: 'chiusa', eventId: 'e1', startedAt: at(-90), endedAt: at(-60), duration: 1800 });
    db.addSession({ id: 'altra', eventId: 'e2', startedAt: at(-30) });

    const n = await closeOpenSessions(tx(db), ['e1'], NOW);

    expect(n).toBe(1);
    expect(db.session('aperta')).toMatchObject({ endedAt: NOW, duration: 1800, peakParticipants: 9 });
    expect(db.session('chiusa')).toMatchObject({ endedAt: at(-60), duration: 1800 });
    expect(db.session('altra')?.endedAt).toBeNull();
  });

  it('non sovrascrive il picco che la sessione ha già', async () => {
    const db = new FakeLifecycleDb(() => NOW);
    db.addEvent({ id: 'e1', status: 'ENDED', peakParticipants: 9 });
    db.addSession({ id: 's', eventId: 'e1', peakParticipants: 3 });

    await closeOpenSessions(tx(db), ['e1'], NOW);

    expect(db.session('s')?.peakParticipants).toBe(3);
  });

  it('senza eventi non interroga nulla', async () => {
    const db = new FakeLifecycleDb(() => NOW);
    expect(await closeOpenSessions(tx(db), [], NOW)).toBe(0);
    expect(db.writes).toEqual([]);
  });
});

describe('staleSessionCloseTime', () => {
  const base = {
    startedAt: at(-120),
    endsAt: at(-60),
    lastActiveAt: null,
    gracePeriodMinutes: null,
    siteGraceMinutes: 15,
    now: NOW,
  };

  it('un evento chiuso a mano finisce alla sua ultima modifica', () => {
    expect(staleSessionCloseTime({ ...base, updatedAt: at(-70) })).toEqual(at(-70));
  });

  it('una modifica successiva non va oltre la fine programmata più la grace', () => {
    expect(staleSessionCloseTime({ ...base, updatedAt: at(-5) })).toEqual(at(-45));
  });

  it('un\'attività più tarda sposta il limite', () => {
    expect(
      staleSessionCloseTime({ ...base, updatedAt: at(-5), lastActiveAt: at(-20) }),
    ).toEqual(at(-20));
  });

  it('una sala a tempo indefinito ha come limite la fine programmata', () => {
    expect(
      staleSessionCloseTime({ ...base, updatedAt: at(-5), gracePeriodMinutes: -1 }),
    ).toEqual(at(-60));
  });

  it('una sessione cominciata dopo il limite finisce all\'ultima modifica, non prima di cominciare', () => {
    expect(
      staleSessionCloseTime({ ...base, startedAt: at(-30), updatedAt: at(-10) }),
    ).toEqual(at(-10));
    // Aperta un istante dopo la chiusura (una corsa): durata zero, mai negativa.
    expect(
      staleSessionCloseTime({ ...base, startedAt: at(-30), updatedAt: at(-40) }),
    ).toEqual(at(-30));
  });

  it('mai nel futuro', () => {
    expect(
      staleSessionCloseTime({ ...base, endsAt: at(60), updatedAt: at(30) }),
    ).toEqual(NOW);
  });
});

describe('closeSessionsOfEndedEvents', () => {
  it('ripara solo gli eventi conclusi o archiviati', async () => {
    const db = new FakeLifecycleDb(() => NOW);
    db.addEvent({ id: 'finito', status: 'ENDED', endsAt: at(-60), updatedAt: at(-50) });
    db.addEvent({ id: 'archiviato', status: 'ARCHIVED', endsAt: at(-60), updatedAt: at(-40) });
    db.addEvent({ id: 'vivo', status: 'LIVE' });
    db.addSession({ id: 's1', eventId: 'finito', startedAt: at(-100) });
    db.addSession({ id: 's2', eventId: 'archiviato', startedAt: at(-100) });
    db.addSession({ id: 's3', eventId: 'vivo', startedAt: at(-100) });

    const n = await closeSessionsOfEndedEvents(tx(db), NOW, 15);

    expect(n).toBe(2);
    expect(db.session('s1')?.endedAt).toEqual(at(-50));
    expect(db.session('s2')?.endedAt).toEqual(at(-45));
    expect(db.session('s3')?.endedAt).toBeNull();
  });

  it('senza niente da riparare non scrive', async () => {
    const db = new FakeLifecycleDb(() => NOW);
    db.addEvent({ id: 'finito', status: 'ENDED' });
    expect(await closeSessionsOfEndedEvents(tx(db), NOW, 15)).toBe(0);
    expect(db.writes).toEqual([]);
  });
});

describe('closeStaleSessions', () => {
  it('chiude le sessioni degli eventi indicati con l\'orario stimato', async () => {
    const db = new FakeLifecycleDb(() => NOW);
    db.addEvent({ id: 'incagliato', status: 'LIVE', endsAt: at(-600), gracePeriodMinutes: 0, updatedAt: at(-500) });
    db.addSession({ id: 's', eventId: 'incagliato', startedAt: at(-660) });

    expect(await closeStaleSessions(tx(db), ['incagliato'], NOW, 15)).toBe(1);
    expect(db.session('s')).toMatchObject({ endedAt: at(-600), duration: 3600 });
  });
});

/**
 * Il giro del ciclo di vita, nei due modi.
 *
 * Il modo 'fixed' è quello delle installazioni senza scaler: prima non
 * esisteva, e gli eventi restavano PUBLISHED o LIVE per sempre, con le
 * iscrizioni aperte, la retention mai partita e le sessioni mai chiuse. Il
 * modo 'scaler' è il comportamento storico dello scaler, spostato qui: i test
 * ne fissano le regole perché lo spostamento non le cambi.
 *
 * Le righe stanno in una banca dati finta in memoria (src/test): si verifica
 * lo stato a fine giro, non la forma delle query.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetProbeCache } from '@/lib/status/probes';
import { FakeLifecycleDb } from '@/test/fake-lifecycle-db';

const NOW = new Date('2026-09-25T10:00:00Z');
const MIN = 60_000;
const at = (min: number) => new Date(NOW.getTime() + min * MIN);

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/lib/db', () => ({
  get prisma() {
    return holder.db;
  },
}));
const publish = vi.hoisted(() => ({ publishEventStatus: vi.fn() }));
vi.mock('@/lib/live-state/publish', () => publish);

import {
  dispatchRecorder,
  lifecycleWindows,
  probeBridge,
  runLifecycleTick,
  type LifecycleWindows,
  type ScalerTickInput,
} from './lifecycle-tick';

const WINDOWS: LifecycleWindows = {
  inactiveGraceMin: 45,
  preScaleMin: 15,
  emptyCloseMin: -1,
  siteGrace: 15,
};

let db: FakeLifecycleDb;

/** Gli stati che il giro ha scritto, in qualunque riga. */
const statiScritti = () =>
  db.writes.map((w) => (w.data as { status?: string }).status).filter(Boolean);

beforeEach(() => {
  vi.clearAllMocks();
  db = new FakeLifecycleDb(() => NOW);
  holder.db = db;
});

function fixed(
  bridge: { probed: boolean; reachable: boolean; participants: number } = {
    probed: false,
    reachable: false,
    participants: 0,
  },
  windows: LifecycleWindows = WINDOWS,
) {
  return runLifecycleTick({ mode: 'fixed', now: NOW, windows, bridge });
}

function scaler(over: Partial<ScalerTickInput> = {}) {
  return runLifecycleTick({
    mode: 'scaler',
    now: NOW,
    windows: WINDOWS,
    jvbReachable: true,
    participants: 0,
    scalerAggregated: true,
    currentReplicas: 1,
    ...over,
  } as ScalerTickInput);
}

describe('giro a bridge fisso — apertura', () => {
  it('apre all\'orario d\'inizio un evento pubblicato, in preparazione o in pausa', async () => {
    db.addEvent({ id: 'pub', status: 'PUBLISHED', startsAt: at(-1) });
    db.addEvent({ id: 'prov', status: 'PROVISIONING', startsAt: at(-1) });
    db.addEvent({ id: 'idle', status: 'IDLE', startsAt: at(-1) });

    const r = await fixed();

    expect(db.status('pub')).toBe('LIVE');
    expect(db.status('prov')).toBe('LIVE');
    expect(db.status('idle')).toBe('LIVE');
    expect(r.transitions.toLive).toBe(3);
    // L'istante dell'apertura è anche un segno di vita.
    expect(db.events.find((e) => e.id === 'pub')?.provisioningStartedAt).toEqual(NOW);
    expect(publish.publishEventStatus).toHaveBeenCalledWith('pub', 'LIVE');
  });

  it('non tocca un evento che deve ancora cominciare, né una bozza', async () => {
    db.addEvent({ id: 'dopo', status: 'PUBLISHED', startsAt: at(5), endsAt: at(65) });
    db.addEvent({ id: 'bozza', status: 'DRAFT', startsAt: at(-1) });

    await fixed();

    expect(db.status('dopo')).toBe('PUBLISHED');
    expect(db.status('bozza')).toBe('DRAFT');
  });

  it('niente pre-riscaldamento: un evento imminente resta PUBLISHED, mai PROVISIONING', async () => {
    db.addEvent({ id: 'fra5', status: 'PUBLISHED', startsAt: at(5), endsAt: at(65) });

    await fixed();

    expect(db.status('fra5')).toBe('PUBLISHED');
    expect(statiScritti()).not.toContain('PROVISIONING');
  });

  it('con la sonda del bridge che non risponde la sala non si apre', async () => {
    db.addEvent({ id: 'pub', status: 'PUBLISHED', startsAt: at(-1) });

    await fixed({ probed: true, reachable: false, participants: 0 });

    expect(db.status('pub')).toBe('PUBLISHED');
  });

  it('senza sonda (Jitsi esterno, Compose) il bridge si dà per presente', async () => {
    db.addEvent({ id: 'pub', status: 'PUBLISHED', startsAt: at(-1) });

    await fixed({ probed: false, reachable: false, participants: 0 });

    expect(db.status('pub')).toBe('LIVE');
  });
});

describe('giro a bridge fisso — chiusura', () => {
  it('un evento mai aperto oltre la fine termina subito', async () => {
    db.addEvent({ id: 'pub', status: 'PUBLISHED', startsAt: at(-60), endsAt: at(-1) });
    db.addEvent({ id: 'prov', status: 'PROVISIONING', startsAt: at(-60), endsAt: at(-1) });

    const r = await fixed();

    expect(db.status('pub')).toBe('ENDED');
    expect(db.status('prov')).toBe('ENDED');
    expect(r.transitions.toEnded).toBe(2);
    expect(publish.publishEventStatus).toHaveBeenCalledWith('pub', 'ENDED');
  });

  it('una sala LIVE termina alla fine della grace, e ne chiude la sessione', async () => {
    db.addEvent({ id: 'oltre', status: 'LIVE', startsAt: at(-90), endsAt: at(-16), peakParticipants: 7 });
    db.addEvent({ id: 'dentro', status: 'LIVE', startsAt: at(-90), endsAt: at(-14) });
    db.addSession({ id: 's-oltre', eventId: 'oltre', startedAt: at(-80) });

    await fixed();

    expect(db.status('oltre')).toBe('ENDED');
    // Nella grace (15 minuti) la sala resta aperta.
    expect(db.status('dentro')).toBe('LIVE');
    const s = db.session('s-oltre')!;
    expect(s.endedAt).toEqual(NOW);
    expect(s.duration).toBe(80 * 60);
    // Senza un picco proprio, la sessione eredita quello dell'evento.
    expect(s.peakParticipants).toBe(7);
  });

  it('la grace dell\'evento vince su quella del sito', async () => {
    db.addEvent({ id: 'g0', status: 'LIVE', endsAt: at(-1), gracePeriodMinutes: 0 });

    await fixed();

    expect(db.status('g0')).toBe('ENDED');
  });

  it('una sala a tempo indefinito oltre la fine termina solo dopo la finestra di inattività', async () => {
    db.addEvent({
      id: 'vuota',
      status: 'LIVE',
      startsAt: at(-300),
      endsAt: at(-120),
      gracePeriodMinutes: -1,
      lastActiveAt: at(-50),
    });
    db.addEvent({
      id: 'occupata',
      status: 'LIVE',
      startsAt: at(-300),
      endsAt: at(-120),
      gracePeriodMinutes: -1,
      lastActiveAt: at(-2),
    });

    await fixed();

    expect(db.status('vuota')).toBe('ENDED');
    expect(db.status('occupata')).toBe('LIVE');
  });

  it('senza sonda, una sala con iscritti non si chiude per silenzio: gli ospiti senza token non possono segnalarsi', async () => {
    const sala = {
      status: 'LIVE',
      startsAt: at(-300),
      endsAt: at(-120),
      gracePeriodMinutes: -1,
      lastActiveAt: at(-50),
      registrationCount: 3,
    };
    db.addEvent({ id: 'con-iscritti', ...sala });
    db.addEvent({ id: 'con-iscritti-sonda', ...sala });

    await fixed();
    expect(db.status('con-iscritti')).toBe('LIVE');

    // Con la sonda del bridge che risponde, il silenzio torna a valere.
    await fixed({ probed: true, reachable: true, participants: 0 });
    expect(db.status('con-iscritti-sonda')).toBe('ENDED');
  });

  it('una chiamata istantanea abbandonata termina prima della sua fine segnaposto', async () => {
    db.addEvent({
      id: 'istantanea',
      status: 'LIVE',
      eventType: 'INSTANT',
      startsAt: at(-120),
      endsAt: at(120),
      gracePeriodMinutes: -1,
      lastActiveAt: at(-46),
    });
    db.addEvent({
      id: 'istantanea-viva',
      status: 'LIVE',
      eventType: 'INSTANT',
      startsAt: at(-120),
      endsAt: at(120),
      gracePeriodMinutes: -1,
      lastActiveAt: at(-1),
    });
    db.addSession({ id: 's', eventId: 'istantanea', startedAt: at(-100) });

    await fixed();

    expect(db.status('istantanea')).toBe('ENDED');
    expect(db.status('istantanea-viva')).toBe('LIVE');
    expect(db.session('s')?.endedAt).toEqual(NOW);
  });

  it('un evento a calendario vuoto prima della sua fine non termina: è una pausa', async () => {
    db.addEvent({
      id: 'pausa',
      status: 'LIVE',
      startsAt: at(-120),
      endsAt: at(60),
      gracePeriodMinutes: -1,
      lastActiveAt: at(-100),
    });

    await fixed();

    expect(db.status('pausa')).toBe('LIVE');
  });

  it('non mette mai in pausa: nessun LIVE → IDLE', async () => {
    db.addEvent({ id: 'live', status: 'LIVE', startsAt: at(-120), endsAt: at(60), lastActiveAt: at(-100) });

    await fixed({ probed: true, reachable: true, participants: 0 });

    expect(db.status('live')).toBe('LIVE');
    expect(statiScritti()).not.toContain('IDLE');
  });

  it('i partecipanti sul bridge tengono vive le sale LIVE, mai il contrario', async () => {
    db.addEvent({
      id: 'istantanea',
      status: 'LIVE',
      eventType: 'INSTANT',
      startsAt: at(-120),
      endsAt: at(120),
      lastActiveAt: at(-50),
    });

    const r = await fixed({ probed: true, reachable: true, participants: 3 });

    expect(r.transitions.liveRefreshed).toBe(1);
    expect(db.status('istantanea')).toBe('LIVE');
  });

  it('la chiusura anticipata di una sala vuota, se accesa, vuole la sonda del bridge', async () => {
    const vuota = {
      status: 'LIVE',
      startsAt: at(-120),
      endsAt: at(60),
      lastActiveAt: at(-20),
    };
    db.addEvent({ id: 'a', ...vuota });
    await fixed({ probed: false, reachable: false, participants: 0 }, { ...WINDOWS, emptyCloseMin: 10 });
    expect(db.status('a')).toBe('LIVE');

    await fixed({ probed: true, reachable: true, participants: 0 }, { ...WINDOWS, emptyCloseMin: 10 });
    expect(db.status('a')).toBe('ENDED');
  });
});

describe('riparazione delle sessioni rimaste aperte', () => {
  it('chiude le sessioni di eventi già conclusi con l\'orario stimato, non adesso', async () => {
    // Concluso a mano alle -200 (updatedAt), fine programmata alle -210 con
    // grace 15: la sessione finisce alle -200, non oggi.
    db.addEvent({
      id: 'finito',
      status: 'ENDED',
      startsAt: at(-300),
      endsAt: at(-210),
      updatedAt: at(-200),
    });
    db.addSession({ id: 's', eventId: 'finito', startedAt: at(-290), peakParticipants: 4 });

    const r = await fixed();

    expect(r.sessionsRepaired).toBe(1);
    expect(db.session('s')?.endedAt).toEqual(at(-200));
    expect(db.session('s')?.duration).toBe(90 * 60);
    expect(db.session('s')?.peakParticipants).toBe(4);
  });

  it('una modifica successiva alla chiusura non gonfia la durata', async () => {
    // Pubblicazione della registrazione giorni dopo: updatedAt si sposta, la
    // fine resta quella programmata più la grace.
    db.addEvent({
      id: 'finito',
      status: 'ARCHIVED',
      startsAt: at(-300),
      endsAt: at(-240),
      gracePeriodMinutes: 0,
      updatedAt: at(-10),
    });
    db.addSession({ id: 's', eventId: 'finito', startedAt: at(-290) });

    await fixed();

    expect(db.session('s')?.endedAt).toEqual(at(-240));
  });

  it('gira anche nel modo scaler', async () => {
    db.addEvent({ id: 'finito', status: 'ENDED', startsAt: at(-300), endsAt: at(-210), updatedAt: at(-200) });
    db.addSession({ id: 's', eventId: 'finito', startedAt: at(-290) });

    const r = await scaler();

    expect(r.sessionsRepaired).toBe(1);
  });

  it('una riparazione che fallisce non fa fallire il giro', async () => {
    db.addEvent({ id: 'finito', status: 'ENDED', endsAt: at(-210), updatedAt: at(-200) });
    db.addSession({ id: 's', eventId: 'finito', startedAt: at(-290) });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const original = db.$transaction;
    let call = 0;
    db.$transaction = (async (fn: (tx: FakeLifecycleDb) => Promise<unknown>) => {
      call += 1;
      if (call === 2) throw new Error('deadlock');
      return original(fn);
    }) as typeof db.$transaction;

    const r = await fixed();

    expect(r.sessionsRepaired).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('modo scaler — le regole storiche', () => {
  it('pre-riscalda un evento imminente e apre quello cominciato, col bridge raggiungibile', async () => {
    db.addEvent({ id: 'fra10', status: 'PUBLISHED', startsAt: at(10), endsAt: at(70) });
    db.addEvent({ id: 'prov', status: 'PROVISIONING', startsAt: at(-1) });

    const r = await scaler();

    expect(db.status('fra10')).toBe('PROVISIONING');
    expect(db.status('prov')).toBe('LIVE');
    expect(r.transitions).toEqual({
      liveRefreshed: 0,
      liveEmptyClosed: 0,
      liveToIdle: 0,
      toEnded: 0,
      publishedToProvisioning: 1,
      provisioningToLive: 1,
    });
  });

  it('senza bridge raggiungibile pre-riscalda ma non apre', async () => {
    db.addEvent({ id: 'prov', status: 'PROVISIONING', startsAt: at(-1) });

    await scaler({ jvbReachable: false });

    expect(db.status('prov')).toBe('PROVISIONING');
  });

  it('mette in pausa una sala vuota prima della fine e ne chiude la sessione', async () => {
    db.addEvent({ id: 'live', status: 'LIVE', startsAt: at(-120), endsAt: at(60), lastActiveAt: at(-50) });
    db.addSession({ id: 's', eventId: 'live', startedAt: at(-110) });

    const r = await scaler();

    expect(db.status('live')).toBe('IDLE');
    expect(r.transitions.liveToIdle).toBe(1);
    expect(db.session('s')?.endedAt).toEqual(NOW);
  });

  it('con più repliche e senza aggregazione non mette in pausa (conteggio inaffidabile)', async () => {
    db.addEvent({ id: 'live', status: 'LIVE', startsAt: at(-120), endsAt: at(60), lastActiveAt: at(-50) });

    await scaler({ scalerAggregated: false, currentReplicas: 2 });

    expect(db.status('live')).toBe('LIVE');
  });

  it('termina alla fine della grace e i mai aperti oltre la fine', async () => {
    db.addEvent({ id: 'oltre', status: 'LIVE', endsAt: at(-16) });
    db.addEvent({ id: 'idle', status: 'IDLE', endsAt: at(-1) });

    const r = await scaler();

    expect(db.status('oltre')).toBe('ENDED');
    expect(db.status('idle')).toBe('ENDED');
    expect(r.transitions.toEnded).toBe(2);
  });

  it('una chiamata istantanea abbandonata va in pausa, non termina (la pausa è revocabile)', async () => {
    db.addEvent({
      id: 'istantanea',
      status: 'LIVE',
      eventType: 'INSTANT',
      startsAt: at(-120),
      endsAt: at(120),
      gracePeriodMinutes: -1,
      lastActiveAt: at(-50),
    });

    await scaler();

    expect(db.status('istantanea')).toBe('IDLE');
  });
});

describe('lifecycleWindows', () => {
  it('legge le impostazioni del sito', () => {
    expect(
      lifecycleWindows({
        jvbInactiveGraceMinutes: 30,
        jvbPreScaleMinutes: 5,
        jvbEmptyCloseMinutes: 10,
        eventGracePeriodMinutes: 0,
      }),
    ).toEqual({ inactiveGraceMin: 30, preScaleMin: 5, emptyCloseMin: 10, siteGrace: 0 });
  });
});

describe('probeBridge', () => {
  // La sonda condivisa tiene il risultato qualche secondo: ogni caso parte pulito.
  beforeEach(() => __resetProbeCache());

  it('senza indirizzo il bridge non è raggiungibile e non si chiama nessuno', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect((await probeBridge('')).reachable).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('legge partecipanti e carico da /colibri/stats', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ participants: 4, conferences: 1, stress_level: 0.2 })));
    const r = await probeBridge('http://jvb:8080');
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('http://jvb:8080/colibri/stats');
    expect(r).toEqual({ participants: 4, conferences: 1, stressLevel: 0.2, reachable: true });
    fetchSpy.mockRestore();
  });

  it('una risposta d\'errore o un errore di rete valgono «non raggiungibile»', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 503 }));
    expect((await probeBridge('http://jvb:8080')).reachable).toBe(false);
    __resetProbeCache();
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect((await probeBridge('http://jvb:8080')).reachable).toBe(false);
    fetchSpy.mockRestore();
  });

  it('un bridge che si dichiara non in salute non è raggiungibile', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ healthy: false, participants: 3 })));
    expect((await probeBridge('http://jvb:8080')).reachable).toBe(false);
    fetchSpy.mockRestore();
  });

  it("una barra finale nell'indirizzo non raddoppia", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ participants: 0 })));
    await probeBridge('http://jvb:8080/');
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('http://jvb:8080/colibri/stats');
    fetchSpy.mockRestore();
  });
});

describe('dispatchRecorder', () => {
  it('senza controller non chiama nessuno', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    dispatchRecorder({});
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('con il controller chiama /dispatch', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    dispatchRecorder({ RECORDER_CONTROLLER_URL: 'http://recorder-controller:8080/' });
    expect(fetchSpy).toHaveBeenCalledWith('http://recorder-controller:8080/dispatch', { method: 'POST' });
    fetchSpy.mockRestore();
  });
});

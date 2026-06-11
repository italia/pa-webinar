/**
 * Dev harness — the ONLY call site that wires concrete deps.
 *
 * Swapping a Mock* for a real adapter is a one-line change right here; the game
 * never changes. Querystring knobs:
 *   ?in=20    seconds until the event goes live (default 60; 0 = live now)
 *   ?host=1   enter early (host)
 *   ?bots=120 number of simulated peers (default 80)
 */
import { mountLobby } from '../src/lobby';
import { MockConferenceState } from '../src/lobby/mocks/MockConferenceState';
import { MockEventSchedule } from '../src/lobby/mocks/MockEventSchedule';
import { MockMediaDevices } from '../src/lobby/mocks/MockMediaDevices';
import { MockPresenceClient } from '../src/lobby/mocks/MockPresenceClient';

const params = new URLSearchParams(location.search);
const startInSeconds = params.has('in') ? Number(params.get('in')) : 60;
const host = params.get('host') === '1';
const nBots = params.has('bots') ? Number(params.get('bots')) : 80;

const world = { w: 2400, h: 1600 };

const presence = new MockPresenceClient(nBots, { world });
const conference = new MockConferenceState();
const schedule = new MockEventSchedule({ startInSeconds, host });
const media = new MockMediaDevices();

const container = document.getElementById('lobby');
if (!container) throw new Error('#lobby container not found');

const handle = mountLobby(
  container,
  { worldSize: world, capacityHint: nBots, initialProfile: { name: '' } },
  // ↓ one line to swap to production: { presence: realPresence, conference: realJitsi, ... }
  { presence, conference, schedule, media },
);

// Dev console helpers: window.lobby.addBots(50), .live(), .end(), .destroy()
Object.assign(window, {
  lobby: {
    handle,
    presence,
    schedule,
    addBots: (n = 30) => presence.addBots(n),
    live: () => schedule.setStatus('live'),
    end: () => schedule.setStatus('ended'),
    destroy: () => {
      handle.destroy();
      schedule.dispose();
    },
  },
});

window.addEventListener('beforeunload', () => {
  handle.destroy();
  schedule.dispose();
});

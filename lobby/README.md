# @pa-webinar/lobby — Sala d'attesa 2D (Phaser)

An **isolated** 2D top-down social lobby (WorkAdventure / Gather-style) for the
PA Webinar pre-join waiting room. People connected-but-not-yet-joined are avatars
in a **garden**; people who entered the videocall appear in the **amphitheatre**
wearing a visor with their name always visible.

The module is a self-contained game client. **All I/O is injected** behind four
ports — it never imports Jitsi, websockets, or fetches a backend. The dev harness
wires `Mock*` implementations; production swaps in real adapters with a one-line
change at the call site.

## Run the dev harness

```bash
npm run lobby:dev          # from the repo root  → http://localhost:5180
# or, inside lobby/:
npm run dev
```

Querystring knobs:

| param      | effect                                             |
|------------|----------------------------------------------------|
| `?in=20`   | seconds until the event goes live (default 60; `0` = live now) |
| `?host=1`  | enter early as host (gate open during `scheduled`) |
| `?bots=120`| number of simulated peers (default 80)             |

Dev console: `window.lobby.addBots(50)`, `.live()`, `.end()`, `.destroy()`.

Controls: **WASD / arrows** move · **Space** jump · **E** wave · **H** heart ·
walk into the **gate** to open the config panel · **Entra** to join.

```bash
npm run typecheck          # tsc --noEmit (strict)
npm run build              # bundles the harness (dist-harness/)
npm run build:lib          # bundles the library (dist/lobby.js, phaser external)
```

## Public API

```ts
import { mountLobby } from '@pa-webinar/lobby';

const handle = mountLobby(container, config, {
  presence,    // PresenceClient
  conference,  // ConferenceState
  schedule,    // EventSchedule
  media,       // MediaDevices
});
handle.setProfile({ name: 'Giulia', color: '#1d6fb8' });
handle.destroy();   // releases sprites, listeners, RAF, Phaser game, media streams
```

See `src/lobby/index.ts` for `LobbyConfig` / `LobbyDeps` / `LobbyHandle` and the
re-exported port types.

## Architecture (where things live)

```
src/lobby/
  index.ts                 public API: mountLobby + types
  public-types.ts          LobbyConfig / LobbyDeps / LobbyHandle / AssetConfig
  LobbyGame.ts             bootstrap: DOM roots, CSS, DI context, Phaser, UI, destroy
  context.ts               LobbyContext handed to scenes via the registry
  bus.ts                   typed mitt event bus (UI ⇄ scene)
  ports/                   INTERFACES ONLY — the seams
  mocks/                   Mock* deps for the harness
  scenes/                  BootScene, WorldScene (the render/update heart)
  systems/                 PeerStore, AvatarSprite, AvatarTextureFactory, Movement,
                           WorldMap, NametagCulling, ProximityLinks, CountdownGate
  ui/                      DOM overlays: StatusBadge, PersonalizationBar,
                           ConfigPanel, Onboarding, Joystick
dev/main.ts                the ONLY place concrete deps are wired
```

Two sources of truth converge in **PeerStore**: identity + position come from
`PresenceClient`, call membership from `ConferenceState`; `inCall` is reconciled
to `presence.inCall || conference.has(id)`. The scene reads one merged map.

Art is isolated in **AvatarTextureFactory** (parametric → texture) and
**WorldMap.buildPlaceholderMap** (programmatic map with the same zone rects a
real Tiled `.tmj` exposes). Swapping to a spritesheet / tilemap touches only
those files (and is pre-wired via `AssetConfig`).

## Swap to production (the one-line change)

The waiting room today is `app/src/components/live/garden/garden-interactive.tsx`
(SVG) wired to the real `/api/events/:slug/garden/ping` Redis presence loop. To
adopt this Phaser lobby, write four thin adapters and swap the mount:

| Port             | Real adapter wraps…                                                            |
|------------------|-------------------------------------------------------------------------------|
| `PresenceClient` | the existing `POST /api/events/:slug/garden/ping` loop (the 200 ms poll already returns the peer list; `move()` feeds the ping body) |
| `ConferenceState`| Jitsi IFrame API events from `jitsi-room.tsx` (`participantJoined/Left`); `join()` triggers the existing `onEnterLive` JWT flow |
| `MediaDevices`   | `device-check.tsx` logic (enumerate / preview / level via `getUserMedia`); `join` reuses the selection |
| `EventSchedule`  | `waiting-room.tsx` status mapping: `PUBLISHED→scheduled`, `LIVE→live`, `ENDED→ended` |

Then, in `waiting-room.tsx`, replace `<GardenInteractive>` with a thin client
component that calls `mountLobby(el, cfg, { presence, conference, schedule, media })`
on mount and `handle.destroy()` on unmount — the game itself is unchanged.

> **Device hygiene:** `MediaDevices.stop()` releases preview tracks; the scene
> calls it on join *before* the real conference acquires the camera/mic, so the
> two never fight over the device. Keep this in the real adapter.

## Status / known scope

- Built only as the **game client** per spec — no realtime server,
  `lib-jitsi-meet`, proximity chat/voice, or backend `eventStartsAt`.
- Placeholder art (CC0-style programmatic), confined to the swap seams above.
- Jump is a local animation (the presence protocol carries no jump channel);
  emotes ARE networked via `presence.emote`.

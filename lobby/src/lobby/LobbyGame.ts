import * as Phaser from 'phaser';

import { busOn, createBus, type LobbyBus } from './bus';
import { DEFAULT_CAPACITY, DEFAULT_WORLD } from './constants';
import { CONTEXT_KEY, type LobbyContext, type ResolvedConfig } from './context';
import type { PlayerProfile } from './ports/types';
import type { LobbyConfig, LobbyDeps } from './public-types';
import { BootScene } from './scenes/BootScene';
import { WorldScene } from './scenes/WorldScene';
import { lobbyStorage } from './storage';
import { AudioSystem } from './systems/AudioSystem';
import { AVATAR_COLORS } from './systems/AvatarTextureFactory';
import { ConfigPanel } from './ui/ConfigPanel';
import { Joystick } from './ui/Joystick';
import { Onboarding } from './ui/Onboarding';
import { PersonalizationBar } from './ui/PersonalizationBar';
import { StatusBadge } from './ui/StatusBadge';
import { TopBar } from './ui/TopBar';
import { LOBBY_CSS } from './ui/styles';

interface Disposable {
  destroy(): void;
}

/**
 * Owns the whole lobby instance: the DOM scaffolding (canvas root + UI overlay
 * root), the injected CSS, the Phaser game, the DI context handed to the
 * scenes, and the DOM UI components. Everything is created in the constructor
 * and fully released in destroy().
 */
export class LobbyGame {
  private readonly gameRoot: HTMLDivElement;
  private readonly uiRoot: HTMLDivElement;
  private readonly styleEl: HTMLStyleElement;
  private readonly bus: LobbyBus;
  private readonly game: Phaser.Game;
  private readonly ui: Disposable[] = [];
  private readonly audio: AudioSystem;
  private readonly profile: PlayerProfile;
  private readonly restorePosition: string | null;
  private readonly onExitToClassic?: () => void;
  private readonly busUnsubs: (() => void)[] = [];
  private gestureUnsub: (() => void) | null = null;
  private destroyed = false;

  constructor(
    private readonly container: HTMLElement,
    config: LobbyConfig,
    private readonly deps: LobbyDeps,
  ) {
    const resolved: ResolvedConfig = {
      worldSize: config.worldSize ?? { ...DEFAULT_WORLD },
      capacityHint: config.capacityHint ?? DEFAULT_CAPACITY,
      map: config.map ?? 'piazza',
      assets: config.assets,
      canExitClassic: !!config.onExitToClassic,
    };

    this.onExitToClassic = config.onExitToClassic;
    this.profile = this.buildInitialProfile(config.initialProfile);
    this.bus = createBus();
    this.audio = new AudioSystem();

    // ── DOM scaffolding ──
    const computed = getComputedStyle(container).position;
    this.restorePosition = computed === 'static' ? container.style.position : null;
    if (computed === 'static') container.style.position = 'relative';

    this.styleEl = injectStyles();
    this.gameRoot = document.createElement('div');
    Object.assign(this.gameRoot.style, {
      position: 'absolute',
      inset: '0',
      overflow: 'hidden',
    } as Partial<CSSStyleDeclaration>);
    this.uiRoot = document.createElement('div');
    this.uiRoot.className = 'pawl';
    container.append(this.gameRoot, this.uiRoot);

    // ── DI context ──
    const ctx: LobbyContext = {
      presence: deps.presence,
      conference: deps.conference,
      schedule: deps.schedule,
      media: deps.media,
      bus: this.bus,
      audio: this.audio,
      config: resolved,
      getProfile: () => this.snapshot(),
      setProfile: (p) => this.setProfile(p),
    };

    // Connect presence before the scene starts reading peers.
    void deps.presence.connect(this.snapshot());

    // ── Phaser game ──
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: this.gameRoot,
      backgroundColor: '#eaf3fb',
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: '100%',
        height: '100%',
      },
      render: { antialias: true, roundPixels: true, powerPreference: 'high-performance' },
      scene: [BootScene, WorldScene],
      callbacks: {
        preBoot: (game) => game.registry.set(CONTEXT_KEY, ctx),
      },
    });

    // ── UI overlays ──
    const profileDeps = {
      getProfile: () => this.snapshot(),
      setProfile: (p: Partial<PlayerProfile>) => this.setProfile(p),
    };
    this.ui.push(
      new StatusBadge(this.uiRoot, this.bus),
      new TopBar(this.uiRoot, this.bus, { canExitClassic: resolved.canExitClassic }),
      new PersonalizationBar(this.uiRoot, this.bus, profileDeps),
      new ConfigPanel(this.uiRoot, this.bus, deps.media),
      new Onboarding(this.uiRoot, this.bus, profileDeps),
      new Joystick(this.uiRoot, this.bus),
    );

    // ── Top-bar actions ──
    this.busUnsubs.push(
      busOn(this.bus, 'requestClassic', () => this.onExitToClassic?.()),
      busOn(this.bus, 'audioToggle', () => this.bus.emit('audioState', this.audio.toggle())),
    );
    this.bus.emit('audioState', this.audio.isEnabled());

    // Resume audio on the first user gesture (autoplay policy).
    const resumeAudio = (): void => this.audio.resume();
    document.addEventListener('pointerdown', resumeAudio, { once: true });
    document.addEventListener('keydown', resumeAudio, { once: true });
    this.gestureUnsub = () => {
      document.removeEventListener('pointerdown', resumeAudio);
      document.removeEventListener('keydown', resumeAudio);
    };
  }

  setProfile(p: Partial<PlayerProfile>): void {
    if (this.destroyed) return;
    const delta: Partial<PlayerProfile> = {};
    if (p.name !== undefined && p.name !== this.profile.name) {
      this.profile.name = p.name;
      delta.name = p.name;
    }
    if (p.color !== undefined && p.color !== this.profile.color) {
      this.profile.color = p.color;
      delta.color = p.color;
    }
    if (p.accessories !== undefined) {
      this.profile.accessories = { ...this.profile.accessories, ...p.accessories };
      delta.accessories = { ...this.profile.accessories };
    }
    if (Object.keys(delta).length === 0) return;

    lobbyStorage.setProfile({
      name: this.profile.name,
      color: this.profile.color,
      accessories: this.profile.accessories,
    });
    this.deps.presence.setProfile(delta);
    this.bus.emit('profileChange', delta);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    for (const u of this.busUnsubs) u();
    this.busUnsubs.length = 0;
    this.gestureUnsub?.();
    this.gestureUnsub = null;
    this.audio.destroy();

    for (const c of this.ui) c.destroy();
    this.ui.length = 0;

    // Tear down the game (scene SHUTDOWN releases movement listeners, the peer
    // store subscriptions and the gate).
    this.game.destroy(true);

    try {
      this.deps.presence.disconnect();
    } catch {
      /* ignore */
    }
    try {
      this.deps.media.stop();
    } catch {
      /* ignore */
    }

    this.bus.all.clear();
    this.gameRoot.remove();
    this.uiRoot.remove();
    this.styleEl.remove();
    if (this.restorePosition !== null) {
      this.container.style.position = this.restorePosition;
    } else {
      // We only set it when it was static; revert to that.
      this.container.style.position = '';
    }
  }

  private snapshot(): PlayerProfile {
    return {
      id: this.profile.id,
      name: this.profile.name,
      color: this.profile.color,
      accessories: { ...this.profile.accessories },
    };
  }

  private buildInitialProfile(seed: Partial<PlayerProfile> | undefined): PlayerProfile {
    const persisted = lobbyStorage.getProfile();
    return {
      id: seed?.id ?? genId(),
      name: seed?.name ?? persisted?.name ?? '',
      color: seed?.color ?? persisted?.color ?? AVATAR_COLORS[0],
      accessories: {
        helmet: seed?.accessories?.helmet ?? persisted?.accessories?.helmet ?? false,
        glasses: seed?.accessories?.glasses ?? persisted?.accessories?.glasses ?? false,
      },
    };
  }
}

function injectStyles(): HTMLStyleElement {
  const style = document.createElement('style');
  style.dataset.pawebinarLobby = '1';
  style.textContent = LOBBY_CSS;
  document.head.append(style);
  return style;
}

function genId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return `self_${c.randomUUID().slice(0, 8)}`;
  return `self_${Math.random().toString(36).slice(2, 10)}`;
}

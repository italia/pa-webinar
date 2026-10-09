import * as Phaser from 'phaser';

import { busOn, createBus, type LobbyBus } from './bus';
import { DEFAULT_CAPACITY, DEFAULT_WORLD } from './constants';
import { CONTEXT_KEY, type LobbyContext, type ResolvedConfig } from './context';
import type { EmoteType, PlayerProfile } from './ports/types';
import { DEFAULT_GATE_LABELS, type LobbyConfig, type LobbyDeps } from './public-types';
import { BootScene } from './scenes/BootScene';
import { WorldScene } from './scenes/WorldScene';
import { lobbyStorage } from './storage';
import { AudioSystem } from './systems/AudioSystem';
import { AVATAR_COLORS } from './systems/AvatarTextureFactory';
import { contaUmori, type Umore } from './umori';
import { CAPPELLI, lookCasuale, lookDaVecchio, normalizzaLook, stessoLook, type AvatarLook } from './avatar/look';
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
  /** Si risolve quando la scena è partita (Phaser parte in modo asincrono):
   *  da lì in poi gli eventi del bus hanno chi li ascolta. */
  readonly ready: Promise<void>;
  private segnalaPronta: () => void = () => undefined;

  constructor(
    private readonly container: HTMLElement,
    config: LobbyConfig,
    private readonly deps: LobbyDeps,
  ) {
    this.ready = new Promise<void>((risolvi) => {
      this.segnalaPronta = risolvi;
    });
    const resolved: ResolvedConfig = {
      worldSize: config.worldSize ?? { ...DEFAULT_WORLD },
      capacityHint: config.capacityHint ?? DEFAULT_CAPACITY,
      map: config.map ?? 'piazza',
      assets: config.assets,
      canExitClassic: !!config.onExitToClassic,
      embed: config.embed ?? false,
      labels: { ...DEFAULT_GATE_LABELS, ...config.labels },
    };

    this.onExitToClassic = config.onExitToClassic;
    this.profile = this.buildInitialProfile(config.initialProfile);
    this.bus = createBus();
    // Prima di creare il gioco: la scena può partire in qualsiasi momento.
    this.busUnsubs.push(
      busOn(this.bus, 'sceneReady', () => this.segnalaPronta()),
      busOn(this.bus, 'luogo', (id) => config.onLuogo?.(id)),
      busOn(this.bus, 'interagisci', (id) => config.onInteragisci?.(id)),
    );
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
    // In embed mode the host shell owns identity + the "Entra" CTA, so the
    // full-screen chrome is suppressed: no onboarding modal, no top bar (and
    // therefore no enter button / device panel trigger — entry is the host's
    // job), no status badge. The world + the mobile joystick remain so the box
    // is a walkable ambient preview. This also removes the in-game join path,
    // so entry only ever goes through the host's gated CTA.
    const profileDeps = {
      getProfile: () => this.snapshot(),
      setProfile: (p: Partial<PlayerProfile>) => this.setProfile(p),
    };
    if (!resolved.embed) {
      this.ui.push(
        new StatusBadge(this.uiRoot, this.bus),
        new TopBar(this.uiRoot, this.bus, { canExitClassic: resolved.canExitClassic }),
        new PersonalizationBar(this.uiRoot, this.bus, profileDeps),
        new ConfigPanel(this.uiRoot, this.bus, deps.media),
        new Onboarding(this.uiRoot, this.bus, profileDeps),
      );
    }
    this.ui.push(new Joystick(this.uiRoot, this.bus));

    // ── Top-bar actions ──
    this.busUnsubs.push(
      busOn(this.bus, 'requestClassic', () => this.onExitToClassic?.()),
      busOn(this.bus, 'audioToggle', () => this.bus.emit('audioState', this.audio.toggle())),
    );
    this.bus.emit('audioState', this.audio.isEnabled());

    // L'audio parte solo dopo un gesto della persona. Si riprova a ogni gesto
    // finché il contesto non è davvero in funzione: col tocco, su un
    // telefono, il primo `pointerdown` non basta al browser (conta il
    // rilascio, o il clic).
    const GESTI_AUDIO = ['pointerup', 'touchend', 'click', 'keydown'] as const;
    const resumeAudio = (): void => {
      this.audio.resume();
      if (this.audio.inFunzione()) togli();
    };
    const togli = (): void => {
      for (const ev of GESTI_AUDIO) document.removeEventListener(ev, resumeAudio, true);
    };
    for (const ev of GESTI_AUDIO) document.addEventListener(ev, resumeAudio, true);
    this.gestureUnsub = togli;
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
    if (p.umore !== undefined && p.umore !== (this.profile.umore ?? null)) {
      this.profile.umore = p.umore;
      delta.umore = p.umore;
    }
    if (p.look !== undefined) {
      const look = normalizzaLook(p.look);
      if (!this.profile.look || !stessoLook(look, this.profile.look)) {
        this.profile.look = look;
        delta.look = look;
      }
    } else if (delta.color !== undefined || delta.accessories !== undefined) {
      // La barra dei colori della piazza da sola cambia maglia, caschetto e
      // occhiali: l'aspetto li segue.
      const { helmet = false, glasses = false } = this.profile.accessories;
      const base = this.profile.look ?? lookDaVecchio(this.profile.color, helmet, glasses);
      const caschetto = CAPPELLI.indexOf('caschetto');
      this.profile.look = {
        ...base,
        coloreMaglia: lookDaVecchio(this.profile.color, false, false).coloreMaglia,
        cappello: helmet ? caschetto : base.cappello === caschetto ? 0 : base.cappello,
        occhiali: glasses ? 1 : base.occhiali === 1 ? 0 : base.occhiali,
      };
      delta.look = this.profile.look;
    }
    if (Object.keys(delta).length === 0) return;

    lobbyStorage.setProfile({
      name: this.profile.name,
      color: this.profile.color,
      accessories: this.profile.accessories,
      ...(this.profile.look ? { look: this.profile.look } : {}),
    });
    this.deps.presence.setProfile(delta);
    this.bus.emit('profileChange', delta);
  }

  // La chat: chi ospita la piazza aspetta `ready` prima di mandarla (il bus
  // non conserva gli eventi che nessuno ascolta) e tiene lui i messaggi
  // recenti per chi apre la piazza dopo.
  showChatMessage(name: string, text: string, ageMs = 0, id?: string, self = false): void {
    if (this.destroyed) return;
    this.bus.emit('chatMessage', { name, text, ageMs, id, self });
  }

  clearChatMessage(id: string): void {
    if (this.destroyed) return;
    this.bus.emit('chatClear', id);
  }

  editChatMessage(id: string, text: string): void {
    if (this.destroyed) return;
    this.bus.emit('chatEdit', { id, text });
  }

  setTyping(names: string[]): void {
    if (this.destroyed) return;
    this.bus.emit('chatTyping', names);
  }

  emote(type: EmoteType): void {
    if (this.destroyed) return;
    this.bus.emit('emote', type);
  }

  azione(id: string): void {
    if (this.destroyed) return;
    this.bus.emit('azione', id);
  }

  festa(): void {
    if (this.destroyed) return;
    this.bus.emit('festa');
  }

  /** Quanti per ciascun umore, fra chi è in piazza (io compreso). */
  umori(): Record<Umore, number> {
    if (this.destroyed) return contaUmori([]);
    const scena = this.game.scene.getScene('World') as WorldScene | null;
    return scena?.sys.isActive() ? scena.umori() : contaUmori([this.profile.umore]);
  }

  presenti(): { nome: string; look: AvatarLook; io: boolean }[] {
    if (this.destroyed) return [];
    const scena = this.game.scene.getScene('World') as WorldScene | null;
    return scena?.sys.isActive() ? scena.presenti() : [];
  }

  setAudio(on: boolean): boolean {
    if (this.destroyed) return false;
    const stato = this.audio.setEnabled(on);
    this.bus.emit('audioState', stato);
    return stato;
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
      ...(this.profile.look ? { look: { ...this.profile.look } } : {}),
      umore: this.profile.umore ?? null,
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
      // Senza un aspetto scelto, uno a caso: in piazza non si è mai tutti
      // uguali.
      look: seed?.look || persisted?.look ? normalizzaLook(seed?.look ?? persisted?.look) : lookCasuale(),
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
  // getRandomValues c'e' anche fuori da HTTPS, dove manca randomUUID: niente
  // ripiego su Math.random. Otto caratteri esadecimali, come prima.
  const b = globalThis.crypto.getRandomValues(new Uint8Array(4));
  return `self_${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
}

import { busOn, type LobbyBus } from '../bus';
import { el } from './dom';

export interface TopBarOptions {
  /** Show the "Versione classica" button (host provided onExitToClassic). */
  canExitClassic: boolean;
}

/**
 * Always-visible top controls — especially for less game-savvy users who
 * shouldn't have to discover that you walk to the gate to enter:
 *   - "Entra nella videocall" (primary) opens the config panel from anywhere,
 *   - "Versione classica" switches back to the classic experience,
 *   - an audio mute toggle and a help button.
 */
export class TopBar {
  private readonly root: HTMLDivElement;
  private readonly audioBtn: HTMLButtonElement;
  private readonly unsubs: (() => void)[] = [];

  constructor(parent: HTMLElement, bus: LobbyBus, opts: TopBarOptions) {
    const enterBtn = el('button', {
      class: 'pawl-top-btn pawl-top-btn--primary',
      text: '🎬 Entra nella videocall',
      title: 'Configura microfono e webcam ed entra',
    });
    enterBtn.addEventListener('click', () => bus.emit('requestEnter', undefined));

    this.audioBtn = el('button', {
      class: 'pawl-top-btn',
      text: '🔊 Musica',
      ariaLabel: 'Attiva/disattiva la musica',
      title: 'Attiva/disattiva la musica e i suoni',
    });
    this.audioBtn.addEventListener('click', () => bus.emit('audioToggle', undefined));

    const infoBtn = el('button', {
      class: 'pawl-top-btn pawl-top-btn--icon',
      text: '?',
      ariaLabel: 'Aiuto e comandi',
      title: 'Aiuto e comandi',
    });
    infoBtn.addEventListener('click', () => bus.emit('openOnboarding', undefined));

    const children: HTMLElement[] = [enterBtn];
    if (opts.canExitClassic) {
      const classicBtn = el('button', {
        class: 'pawl-top-btn',
        text: 'Versione classica',
        title: 'Passa alla versione classica (senza gioco)',
      });
      classicBtn.addEventListener('click', () => bus.emit('requestClassic', undefined));
      children.push(classicBtn);
    }
    children.push(this.audioBtn, infoBtn);

    this.root = el('div', { class: 'pawl-topbar', role: 'toolbar' }, children);
    parent.append(this.root);

    this.unsubs.push(
      busOn(bus, 'audioState', (on) => {
        this.audioBtn.textContent = on ? '🔊 Musica' : '🔇 Musica';
        this.audioBtn.classList.toggle('pawl-top-btn--muted', !on);
      }),
    );
  }

  destroy(): void {
    for (const u of this.unsubs) u();
    this.root.remove();
  }
}

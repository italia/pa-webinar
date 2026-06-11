import { busOn, type LobbyBus } from '../bus';
import type { PlayerProfile } from '../ports/types';
import { AVATAR_COLORS } from '../systems/AvatarTextureFactory';
import { el } from './dom';

export interface PersonalizationDeps {
  getProfile(): PlayerProfile;
  setProfile(p: Partial<PlayerProfile>): void;
}

/** Bottom-left dock: name, colour, accessories — all live (→ setProfile). */
export class PersonalizationBar {
  private readonly root: HTMLDivElement;
  private readonly nameInput: HTMLInputElement;
  private readonly swatches: HTMLButtonElement[] = [];
  private readonly helmetBtn: HTMLButtonElement;
  private readonly glassesBtn: HTMLButtonElement;
  private readonly unsubs: (() => void)[] = [];

  constructor(
    parent: HTMLElement,
    bus: LobbyBus,
    private readonly deps: PersonalizationDeps,
  ) {
    const profile = deps.getProfile();

    this.nameInput = el('input', {
      class: 'pawl-input',
      type: 'text',
      placeholder: 'Il tuo nome',
      value: profile.name,
      maxLength: 24,
      ariaLabel: 'Il tuo nome',
    });
    this.nameInput.addEventListener('input', () => {
      this.deps.setProfile({ name: this.nameInput.value });
    });

    const swatchRow = el('div', { class: 'pawl-swatches' });
    for (const color of AVATAR_COLORS) {
      const b = el('button', {
        class: 'pawl-swatch',
        ariaLabel: `Colore ${color}`,
        style: { background: color },
      });
      b.addEventListener('click', () => this.deps.setProfile({ color }));
      this.swatches.push(b);
      swatchRow.append(b);
    }

    this.helmetBtn = el('button', { class: 'pawl-toggle', text: '⛑️ Casco' });
    this.helmetBtn.addEventListener('click', () => this.toggleAccessory('helmet'));
    this.glassesBtn = el('button', { class: 'pawl-toggle', text: '🕶️ Occhiali' });
    this.glassesBtn.addEventListener('click', () => this.toggleAccessory('glasses'));

    this.root = el('div', { class: 'pawl-dock' }, [
      el('div', { class: 'pawl-dock__row' }, [
        el('span', { class: 'pawl-dock__label', text: 'Tu' }),
        this.nameInput,
      ]),
      swatchRow,
      el('div', { class: 'pawl-dock__row' }, [this.helmetBtn, this.glassesBtn]),
    ]);
    parent.append(this.root);

    // Keep the dock in sync when the profile changes via any path.
    this.unsubs.push(busOn(bus, 'profileChange', () => this.render()));
    this.render();
  }

  private toggleAccessory(key: 'helmet' | 'glasses'): void {
    const acc = { ...this.deps.getProfile().accessories };
    acc[key] = !acc[key];
    this.deps.setProfile({ accessories: acc });
  }

  private render(): void {
    const p = this.deps.getProfile();
    if (document.activeElement !== this.nameInput && this.nameInput.value !== p.name) {
      this.nameInput.value = p.name;
    }
    this.swatches.forEach((b, i) => {
      b.classList.toggle('pawl-swatch--active', AVATAR_COLORS[i] === p.color);
    });
    this.helmetBtn.classList.toggle('pawl-toggle--on', !!p.accessories.helmet);
    this.glassesBtn.classList.toggle('pawl-toggle--on', !!p.accessories.glasses);
  }

  destroy(): void {
    for (const u of this.unsubs) u();
    this.root.remove();
  }
}

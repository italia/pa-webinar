import { busOn, type LobbyBus } from '../bus';
import type { PlayerProfile } from '../ports/types';
import { lobbyStorage } from '../storage';
import { el } from './dom';

export interface OnboardingDeps {
  getProfile(): PlayerProfile;
  setProfile(p: Partial<PlayerProfile>): void;
}

/**
 * Entry overlay. The FIRST thing a visitor does is pick a name — so we don't end
 * up with a room full of "Ospite". It also explains the controls (for less
 * game-savvy users) and that the event starts on the countdown. Dismissible and
 * reopenable from the top "?" button. Shown automatically on arrival when
 * onboarding hasn't been dismissed OR no name has been set yet.
 */
export class Onboarding {
  private readonly overlay: HTMLDivElement;
  private readonly nameInput: HTMLInputElement;
  private readonly unsubs: (() => void)[] = [];

  constructor(
    parent: HTMLElement,
    bus: LobbyBus,
    private readonly deps: OnboardingDeps,
  ) {
    const profile = deps.getProfile();

    this.nameInput = el('input', {
      class: 'pawl-onb__name',
      type: 'text',
      placeholder: 'Es. Giulia, Marco…',
      value: profile.name,
      maxLength: 24,
      ariaLabel: 'Il tuo nome',
    });
    this.nameInput.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') this.confirm();
    });

    const startBtn = el('button', { class: 'pawl-onb__btn', text: 'Entra nel giardino →' });
    startBtn.addEventListener('click', () => this.confirm());

    this.overlay = el('div', { class: 'pawl-onb', role: 'dialog' }, [
      el('div', { class: 'pawl-onb__card' }, [
        el('div', { class: 'pawl-onb__title', text: '🌿 Benvenutə nella sala d’attesa' }),
        el('p', {
          class: 'pawl-onb__sub',
          text: 'Sei un avatar nel giardino. Scegli come farti chiamare: il nome sarà visibile agli altri partecipanti.',
        }),
        el('label', { class: 'pawl-onb__label', text: 'Il tuo nome' }),
        this.nameInput,
        el('div', { class: 'pawl-keys' }, [
          key('WASD / ↑↓←→', 'Muoviti'),
          key('Spazio', 'Salta'),
          key('E', 'Saluta'),
          key('🚪', 'Vai al cancello per entrare'),
        ]),
        startBtn,
        el('p', {
          class: 'pawl-onb__hint',
          text: 'Potrai cambiare nome, colore e accessori dal pannello in basso a sinistra.',
        }),
      ]),
    ]);
    parent.append(this.overlay);

    this.unsubs.push(busOn(bus, 'openOnboarding', () => this.open()));

    if (!lobbyStorage.isOnboardingDismissed() || !profile.name.trim()) {
      this.open();
    }
  }

  private open(): void {
    this.overlay.classList.add('pawl-onb--open');
    // Focus the name field shortly after the open transition starts.
    window.setTimeout(() => this.nameInput.focus(), 60);
  }

  private confirm(): void {
    const name = this.nameInput.value.trim();
    if (name) this.deps.setProfile({ name });
    this.overlay.classList.remove('pawl-onb--open');
    lobbyStorage.setOnboardingDismissed(true);
  }

  destroy(): void {
    for (const u of this.unsubs) u();
    this.overlay.remove();
  }
}

function key(combo: string, label: string): HTMLDivElement {
  return el('div', { class: 'pawl-key' }, [
    el('kbd', { text: combo }),
    el('span', { text: label }),
  ]);
}

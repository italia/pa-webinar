import { busOn, type LobbyBus } from '../bus';
import type { EventStatus } from '../ports/types';
import { formatClock } from '../util';
import { el } from './dom';

/** Top-centre badge: event status + countdown + people count. */
export class StatusBadge {
  private readonly root: HTMLDivElement;
  private readonly dot: HTMLSpanElement;
  private readonly text: HTMLSpanElement;
  private readonly count: HTMLSpanElement;
  private readonly unsubs: (() => void)[] = [];

  private status: EventStatus = 'scheduled';
  private remaining = 0;
  private people = 1;

  constructor(parent: HTMLElement, bus: LobbyBus) {
    this.dot = el('span', { class: 'pawl-badge__dot' });
    this.text = el('span', { class: 'pawl-badge__text', text: '—' });
    this.count = el('span', { class: 'pawl-badge__count', text: '1 in sala' });
    this.root = el('div', { class: 'pawl-badge pawl-badge--scheduled', role: 'status' }, [
      this.dot,
      this.text,
      this.count,
    ]);
    parent.append(this.root);

    this.unsubs.push(
      busOn(bus, 'statusChange', (s) => {
        this.status = s;
        this.render();
      }),
      busOn(bus, 'countdown', (ms) => {
        this.remaining = ms;
        this.render();
      }),
      busOn(bus, 'peerCount', (n) => {
        this.people = n;
        this.render();
      }),
    );
    this.render();
  }

  private render(): void {
    this.root.classList.remove(
      'pawl-badge--scheduled',
      'pawl-badge--live',
      'pawl-badge--ended',
    );
    this.root.classList.add(`pawl-badge--${this.status}`);
    if (this.status === 'live') this.text.textContent = 'IN DIRETTA';
    else if (this.status === 'ended') this.text.textContent = 'Evento terminato';
    else this.text.textContent = `Inizia tra ${formatClock(this.remaining)}`;
    this.count.textContent = `${this.people} in sala`;
  }

  destroy(): void {
    for (const u of this.unsubs) u();
    this.root.remove();
  }
}

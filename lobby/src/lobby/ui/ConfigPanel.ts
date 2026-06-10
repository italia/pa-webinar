import { busOn, type LobbyBus } from '../bus';
import type { MediaDevices } from '../ports/MediaDevices';
import type { DeviceSelection } from '../ports/types';
import { formatClock } from '../util';
import { clear, el } from './dom';

/**
 * Config-at-the-gate. Opens when the player steps into the gate trigger zone
 * (bus `gateZone`), independent of event status, so people can *prepare*. The
 * Entra button is gated by `canEnter` (live, or host during scheduled) with a
 * "Inizia tra mm:ss" countdown otherwise.
 *
 * Device hygiene: the preview acquires tracks via `media.preview`; closing the
 * panel or pressing Entra calls `media.stop()` so the (future) real conference
 * never fights the preview for the camera/mic.
 */
export class ConfigPanel {
  private readonly root: HTMLDivElement;
  private readonly video: HTMLVideoElement;
  private readonly noVideo: HTMLDivElement;
  private readonly vuFill: HTMLDivElement;
  private readonly cameraSel: HTMLSelectElement;
  private readonly micSel: HTMLSelectElement;
  private readonly outputSel: HTMLSelectElement;
  private readonly videoToggle: HTMLButtonElement;
  private readonly audioToggle: HTMLButtonElement;
  private readonly enterBtn: HTMLButtonElement;
  private readonly note: HTMLDivElement;
  private readonly unsubs: (() => void)[] = [];

  private open = false;
  private canEnter = false;
  private remaining = 0;
  private vuTimer = 0;
  private enumerated = false;
  private readonly sel: DeviceSelection = { videoMuted: false, audioMuted: false };

  constructor(
    parent: HTMLElement,
    private readonly bus: LobbyBus,
    private readonly media: MediaDevices,
  ) {
    this.video = el('video') as HTMLVideoElement;
    this.video.muted = true;
    this.video.autoplay = true;
    this.video.playsInline = true;
    this.noVideo = el('div', { class: 'pawl-config__novideo', text: 'Anteprima…' });
    this.vuFill = el('div', { class: 'pawl-vu__fill' });
    const preview = el('div', { class: 'pawl-config__preview' }, [
      this.video,
      this.noVideo,
      el('div', { class: 'pawl-vu' }, [this.vuFill]),
    ]);

    this.cameraSel = el('select', { class: 'pawl-select', ariaLabel: 'Camera' });
    this.micSel = el('select', { class: 'pawl-select', ariaLabel: 'Microfono' });
    this.outputSel = el('select', { class: 'pawl-select', ariaLabel: 'Uscita audio' });
    this.cameraSel.addEventListener('change', () => {
      this.sel.cameraId = this.cameraSel.value || undefined;
      void this.restartPreview();
    });
    this.micSel.addEventListener('change', () => {
      this.sel.micId = this.micSel.value || undefined;
    });
    this.outputSel.addEventListener('change', () => {
      this.sel.outputId = this.outputSel.value || undefined;
    });

    this.videoToggle = el('button', { class: 'pawl-toggle pawl-toggle--on', text: '📷 Video' });
    this.videoToggle.addEventListener('click', () => {
      this.sel.videoMuted = !this.sel.videoMuted;
      this.videoToggle.classList.toggle('pawl-toggle--on', !this.sel.videoMuted);
      void this.restartPreview();
    });
    this.audioToggle = el('button', { class: 'pawl-toggle pawl-toggle--on', text: '🎙️ Audio' });
    this.audioToggle.addEventListener('click', () => {
      this.sel.audioMuted = !this.sel.audioMuted;
      this.audioToggle.classList.toggle('pawl-toggle--on', !this.sel.audioMuted);
    });

    this.enterBtn = el('button', { class: 'pawl-btn', text: 'Entra' }) as HTMLButtonElement;
    this.enterBtn.addEventListener('click', () => {
      if (!this.canEnter) return;
      this.bus.emit('joinRequest', { ...this.sel });
    });
    this.note = el('div', { class: 'pawl-config__note', text: '' });

    this.root = el('div', { class: 'pawl-config' }, [
      el('h3', { class: 'pawl-config__title', text: '🎧 Pronti per entrare' }),
      preview,
      field('Camera', this.cameraSel),
      field('Microfono', this.micSel),
      field('Uscita audio', this.outputSel),
      el('div', { class: 'pawl-config__toggles' }, [this.videoToggle, this.audioToggle]),
      this.enterBtn,
      this.note,
    ]);
    parent.append(this.root);

    this.unsubs.push(
      busOn(bus, 'gateZone', (inside) => this.setOpen(inside)),
      busOn(bus, 'requestEnter', () => this.setOpen(true)),
      busOn(bus, 'canEnter', (v) => {
        this.canEnter = v;
        this.renderEnter();
      }),
      busOn(bus, 'countdown', (ms) => {
        this.remaining = ms;
        this.renderEnter();
      }),
      busOn(bus, 'joined', () => this.setOpen(false)),
    );
    this.renderEnter();
  }

  private setOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    this.root.classList.toggle('pawl-config--open', open);
    if (open) void this.openPanel();
    else this.closePanel();
  }

  private async openPanel(): Promise<void> {
    if (!this.enumerated) {
      try {
        const lists = await this.media.enumerate();
        fillSelect(this.cameraSel, lists.cameras, 'Camera');
        fillSelect(this.micSel, lists.mics, 'Microfono');
        fillSelect(this.outputSel, lists.outputs, 'Predefinita');
        this.sel.cameraId = this.cameraSel.value || undefined;
        this.sel.micId = this.micSel.value || undefined;
        this.sel.outputId = this.outputSel.value || undefined;
        this.enumerated = true;
      } catch {
        /* leave selects empty */
      }
    }
    if (!this.open) return; // closed during await
    await this.restartPreview();
    this.startVu();
  }

  private closePanel(): void {
    this.stopVu();
    this.media.stop();
    this.video.srcObject = null;
  }

  private async restartPreview(): Promise<void> {
    this.media.stop();
    this.video.srcObject = null;
    if (this.sel.videoMuted) {
      this.showNoVideo('Video disattivato');
      return;
    }
    this.showNoVideo('Anteprima…');
    const stream = await this.media.preview({ ...this.sel });
    if (!this.open) {
      this.media.stop();
      return;
    }
    if (stream) {
      this.video.srcObject = stream;
      this.noVideo.style.display = 'none';
    } else {
      this.showNoVideo('Anteprima non disponibile');
    }
  }

  private showNoVideo(msg: string): void {
    this.noVideo.textContent = msg;
    this.noVideo.style.display = '';
  }

  private startVu(): void {
    this.stopVu();
    this.vuTimer = window.setInterval(() => {
      const level = this.sel.audioMuted ? 0 : this.media.level();
      this.vuFill.style.width = `${Math.round(Math.max(0, Math.min(1, level)) * 100)}%`;
    }, 70);
  }

  private stopVu(): void {
    if (this.vuTimer) {
      window.clearInterval(this.vuTimer);
      this.vuTimer = 0;
    }
    this.vuFill.style.width = '0%';
  }

  private renderEnter(): void {
    this.enterBtn.disabled = !this.canEnter;
    this.enterBtn.textContent = this.canEnter
      ? 'Entra'
      : `Inizia tra ${formatClock(this.remaining)}`;
    this.note.textContent = this.canEnter
      ? ''
      : "Per gli ospiti l'ingresso si apre all'avvio dell'evento.";
  }

  destroy(): void {
    for (const u of this.unsubs) u();
    this.stopVu();
    this.media.stop();
    this.video.srcObject = null;
    this.root.remove();
  }
}

function field(label: string, control: HTMLElement): HTMLDivElement {
  return el('div', { class: 'pawl-config__field' }, [el('label', { text: label }), control]);
}

function fillSelect(
  sel: HTMLSelectElement,
  devices: MediaDeviceInfo[],
  fallbackLabel: string,
): void {
  clear(sel);
  if (devices.length === 0) {
    sel.append(el('option', { value: '', text: fallbackLabel }));
    return;
  }
  devices.forEach((d, i) => {
    sel.append(el('option', { value: d.deviceId, text: d.label || `${fallbackLabel} ${i + 1}` }));
  });
}

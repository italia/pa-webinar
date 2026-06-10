import type { MediaDeviceLists, MediaDevices } from '../ports/MediaDevices';
import type { DeviceSelection } from '../ports/types';

/**
 * Device layer stand-in. Device lists are fabricated (stable labels for the
 * demo). `preview()` attempts a REAL getUserMedia when permission is available
 * — so the preview and VU meter are live where possible — and falls back to a
 * null stream + animated level otherwise. `stop()` releases everything, which
 * is the contract the real lib-jitsi-meet wiring will rely on so the conference
 * never fights the preview for the camera/mic.
 */
export class MockMediaDevices implements MediaDevices {
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private data: Uint8Array<ArrayBuffer> | null = null;

  async enumerate(): Promise<MediaDeviceLists> {
    // Best-effort real labels, otherwise tidy fakes.
    let real: MediaDeviceInfo[] = [];
    try {
      real = (await navigator.mediaDevices?.enumerateDevices?.()) ?? [];
    } catch {
      real = [];
    }
    const byKind = (kind: MediaDeviceKind, labelled: boolean): MediaDeviceInfo[] =>
      real.filter((d) => d.kind === kind && (!labelled || d.label));

    return {
      cameras: ensure(byKind('videoinput', true), [
        fake('videoinput', 'cam-1', 'Webcam integrata'),
        fake('videoinput', 'cam-2', 'Webcam esterna'),
      ]),
      mics: ensure(byKind('audioinput', true), [
        fake('audioinput', 'mic-1', 'Microfono integrato'),
        fake('audioinput', 'mic-2', 'Cuffie'),
      ]),
      outputs: ensure(byKind('audiooutput', true), [
        fake('audiooutput', 'out-1', 'Altoparlanti'),
      ]),
    };
  }

  async preview(_sel: DeviceSelection): Promise<MediaStream | null> {
    this.stop();
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) return null;
    try {
      const stream = await md.getUserMedia({ video: true, audio: true });
      this.stream = stream;
      this.setupAnalyser(stream);
      return stream;
    } catch {
      return null; // permission denied / no device → animated fallback level
    }
  }

  level(): number {
    if (this.analyser && this.data) {
      this.analyser.getByteTimeDomainData(this.data);
      let sum = 0;
      for (let i = 0; i < this.data.length; i++) {
        const x = (this.data[i]! - 128) / 128;
        sum += x * x;
      }
      return Math.min(1, Math.sqrt(sum / this.data.length) * 3);
    }
    // Animated fallback so the VU always shows life in the demo.
    const t = performance.now() / 1000;
    return Math.max(0, 0.35 + 0.3 * Math.sin(t * 4) + 0.15 * Math.sin(t * 11));
  }

  stop(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.audioCtx) {
      void this.audioCtx.close().catch(() => undefined);
      this.audioCtx = null;
    }
    this.analyser = null;
    this.data = null;
  }

  private setupAnalyser(stream: MediaStream): void {
    if (stream.getAudioTracks().length === 0) return;
    const Ctor =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    try {
      this.audioCtx = new Ctor();
      const src = this.audioCtx.createMediaStreamSource(stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      src.connect(this.analyser);
      this.data = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
    } catch {
      this.analyser = null;
      this.data = null;
    }
  }
}

function ensure(list: MediaDeviceInfo[], fallback: MediaDeviceInfo[]): MediaDeviceInfo[] {
  return list.length > 0 ? list : fallback;
}

function fake(kind: MediaDeviceKind, deviceId: string, label: string): MediaDeviceInfo {
  return {
    deviceId,
    kind,
    label,
    groupId: `mock-${kind}`,
    toJSON() {
      return { deviceId, kind, label, groupId: `mock-${kind}` };
    },
  } as MediaDeviceInfo;
}

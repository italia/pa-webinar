import type { DeviceSelection, MediaDeviceLists, MediaDevices } from '@pa-webinar/lobby';

/**
 * Real device layer for the config-at-the-gate panel: enumerate devices,
 * produce a live preview honouring the chosen camera/mic, expose a VU level
 * from an AnalyserNode, and release everything on stop().
 *
 * `stop()` is the contract that keeps the preview from fighting the conference:
 * the lobby calls it on join (and on unmount) before Jitsi acquires the devices.
 */
export class BrowserMediaDevices implements MediaDevices {
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private data: Uint8Array<ArrayBuffer> | null = null;

  async enumerate(): Promise<MediaDeviceLists> {
    let devices: MediaDeviceInfo[] = [];
    try {
      devices = (await navigator.mediaDevices?.enumerateDevices?.()) ?? [];
    } catch {
      devices = [];
    }
    return {
      cameras: devices.filter((d) => d.kind === 'videoinput'),
      mics: devices.filter((d) => d.kind === 'audioinput'),
      outputs: devices.filter((d) => d.kind === 'audiooutput'),
    };
  }

  async preview(sel: DeviceSelection): Promise<MediaStream | null> {
    this.stop();
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) return null;
    try {
      const stream = await md.getUserMedia({
        video: sel.videoMuted
          ? false
          : sel.cameraId
            ? { deviceId: { ideal: sel.cameraId } }
            : true,
        audio: sel.micId ? { deviceId: { ideal: sel.micId } } : true,
      });
      this.stream = stream;
      this.setupAnalyser(stream);
      return stream;
    } catch {
      return null;
    }
  }

  level(): number {
    if (!this.analyser || !this.data) return 0;
    this.analyser.getByteTimeDomainData(this.data);
    let sum = 0;
    for (let i = 0; i < this.data.length; i++) {
      const x = (this.data[i]! - 128) / 128;
      sum += x * x;
    }
    return Math.min(1, Math.sqrt(sum / this.data.length) * 3);
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
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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

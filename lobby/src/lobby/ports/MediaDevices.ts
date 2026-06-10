import type { DeviceSelection } from './types';

export interface MediaDeviceLists {
  cameras: MediaDeviceInfo[];
  mics: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
}

/**
 * The device layer behind the config-at-the-gate panel: enumerate devices,
 * produce a preview stream, expose a VU level, and release tracks.
 *
 * Critical contract (where device contention bugs live): `preview()` acquires
 * tracks for the in-panel preview; `stop()` releases them. The host MUST call
 * `stop()` before the real conference grabs the same camera/mic, so the two
 * never fight over the device. The mock honours the same lifecycle so the
 * sequencing is exercised before lib-jitsi-meet is wired in.
 *
 * Note: this interface deliberately shadows the DOM `MediaDevices` lib type
 * within the module — the public API surface mirrors the spec. Value access to
 * `navigator.mediaDevices` is unaffected.
 */
export interface MediaDevices {
  enumerate(): Promise<MediaDeviceLists>;
  /** Preview stream for the chosen devices (or null if unavailable/denied). */
  preview(sel: DeviceSelection): Promise<MediaStream | null>;
  /** Current input level, 0..1, for the VU meter. */
  level(): number;
  /** Release any preview tracks. Call before the conference acquires devices. */
  stop(): void;
}

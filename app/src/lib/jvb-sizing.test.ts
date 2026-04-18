import { describe, it, expect } from 'vitest';

import {
  DEFAULT_JVB_CONFIG,
  type JvbSizingConfig,
  jvbsForEvent,
} from './jvb-sizing';

describe('jvbsForEvent', () => {
  it('returns at least 1 replica for 0 participants', () => {
    // Edge: an empty event should never compute to 0 pods — the cron
    // scaler uses this to bring up a warm JVB before participants join.
    expect(jvbsForEvent(0, 30, true)).toBe(1);
  });

  it('uses DEFAULT_JVB_CONFIG when no config passed', () => {
    // 100 parts @ 30% senders, video on: 30 senders + 70 receivers.
    // Cost: 30/3.125 + 70/18.75 = 9.6 + 3.73 = 13.33 cores. 1 pod @ 16
    // cores fits comfortably → 1 replica.
    expect(jvbsForEvent(100, 30, true)).toBe(1);
  });

  it('scales to 2+ replicas when single pod is exceeded', () => {
    // 300 parts @ 30% senders, video on: 90 senders + 210 receivers.
    // Cost: 90/3.125 + 210/18.75 = 28.8 + 11.2 = 40 cores / 16 = 2.5 → 3.
    expect(jvbsForEvent(300, 30, true)).toBe(3);
  });

  it('collapses sender ratio to 0 when videoEnabled=false', () => {
    // Audio-only webinar: everyone is a receiver regardless of ratio.
    // 100 parts → all 100 receivers → 100/18.75 / 16 = 0.33 → ceil = 1.
    expect(jvbsForEvent(100, 100, false)).toBe(1);
    // 500 all-receivers → 500/18.75 / 16 = 1.67 → ceil = 2.
    expect(jvbsForEvent(500, 100, false)).toBe(2);
  });

  it('handles 100% sender ratio', () => {
    // 50 parts, all senders: 50/3.125 = 16 cores → exactly 1 pod.
    expect(jvbsForEvent(50, 100, true)).toBe(1);
    // 100 all-senders: 100/3.125 = 32 cores / 16 = 2 pods.
    expect(jvbsForEvent(100, 100, true)).toBe(2);
  });

  it('clamps ratio to 0-100 range', () => {
    // Negative or >100 ratios are coerced — admin footgun protection.
    expect(jvbsForEvent(100, -10, true)).toBe(jvbsForEvent(100, 0, true));
    expect(jvbsForEvent(100, 150, true)).toBe(jvbsForEvent(100, 100, true));
  });

  it('caps replicas at config.maxReplicas', () => {
    // 10000 parts @ 50% senders would need a huge number of pods;
    // maxReplicas=6 is the cost-explosion guard.
    expect(jvbsForEvent(10000, 50, true)).toBe(DEFAULT_JVB_CONFIG.maxReplicas);
  });

  it('respects custom config overrides', () => {
    // A smaller VM (F8s_v2: 8 cores) needs more pods for the same event.
    const smallVm: JvbSizingConfig = {
      cpuCoresPerPod: 8,
      receiversPerCore: 18.75,
      sendersPerCore: 3.125,
      maxReplicas: 10,
    };
    // 300 parts @ 30% senders: 40 cores / 8 = 5 replicas (vs 3 on F16).
    expect(jvbsForEvent(300, 30, true, smallVm)).toBe(5);
  });

  it('handles degenerate config (0 cores per core) without dividing by zero', () => {
    // A misconfigured SiteSetting row shouldn't crash the scaler.
    const broken: JvbSizingConfig = {
      cpuCoresPerPod: 16,
      receiversPerCore: 0,
      sendersPerCore: 0,
      maxReplicas: 6,
    };
    // When both per-core densities are 0, total cost is 0 → 1 pod
    // (the floor). Caller still gets a sane, non-crashing result.
    expect(jvbsForEvent(100, 30, true, broken)).toBe(1);
  });
});

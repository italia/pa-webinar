import { describe, it, expect } from 'vitest';
import {
  baseToolbarButtons,
  moderatorToolbarButtons,
  mobileBaseToolbarButtons,
  mobileModeratorToolbarButtons,
  jitsiConfigOverwrite,
  jitsiInterfaceConfigOverwrite,
  participantFeatures,
  moderatorFeatures,
  speakerFeatures,
  speakerToolbarButtons,
  instantCallToolbarButtons,
  instantCallModeratorToolbarButtons,
  instantCallConfigOverwrite,
  VIDEO_QUALITY_PRESETS,
  DEFAULT_VIDEO_QUALITY_PRESET,
  resolveVideoQualityConfig,
  videoQualityMaxHeight,
} from './config';

describe('Jitsi config exports', () => {
  it('baseToolbarButtons does not include hangup', () => {
    expect(baseToolbarButtons).not.toContain('hangup');
  });

  it('moderatorToolbarButtons excludes native hangup (exit via app prompt)', () => {
    // Jitsi's own hangup bypasses our exit handler and loops the network-
    // resilience path; every role now leaves via the app "Esci dalla sala"
    // button (moderators get an "Esci solo tu / Termina per tutti" prompt).
    expect(moderatorToolbarButtons).not.toContain('hangup');
  });

  it('moderatorToolbarButtons is a superset of baseToolbarButtons', () => {
    for (const btn of baseToolbarButtons) {
      expect(moderatorToolbarButtons).toContain(btn);
    }
  });

  it('moderatorToolbarButtons does NOT statically include whiteboard (per-event opt-in)', () => {
    // The whiteboard is opt-in per event (Event.whiteboardEnabled): JitsiRoom
    // appends 'whiteboard' for moderators on desktop only when the event
    // enabled it. Jitsi additionally feature-gates it on config.whiteboard.
    // enabled (server-side, test only), so it stays hidden on prod regardless.
    expect(moderatorToolbarButtons).not.toContain('whiteboard');
  });

  it('baseToolbarButtons excludes chat (handled by custom ChatPanel)', () => {
    expect(baseToolbarButtons).not.toContain('chat');
  });

  it('baseToolbarButtons excludes reactions (handled by custom ReactionBar)', () => {
    expect(baseToolbarButtons).not.toContain('reactions');
  });

  it('participant features have recording disabled', () => {
    expect(participantFeatures.recording).toBe(false);
  });

  it('moderator features have recording enabled', () => {
    expect(moderatorFeatures.recording).toBe(true);
  });

  it('both feature sets have screen-sharing enabled', () => {
    expect(participantFeatures['screen-sharing']).toBe(true);
    expect(moderatorFeatures['screen-sharing']).toBe(true);
  });

  it('speaker features allow screen-sharing but not recording', () => {
    expect(speakerFeatures['screen-sharing']).toBe(true);
    expect(speakerFeatures.recording).toBe(false);
    expect(speakerFeatures.livestreaming).toBe(false);
  });

  it('speaker toolbar excludes moderator-only buttons', () => {
    expect(speakerToolbarButtons).not.toContain('hangup');
    expect(speakerToolbarButtons).not.toContain('mute-everyone');
    expect(speakerToolbarButtons).not.toContain('security');
  });

  it('mobileBaseToolbarButtons trims overwhelming controls', () => {
    expect(mobileBaseToolbarButtons).toContain('microphone');
    expect(mobileBaseToolbarButtons).toContain('camera');
    // `desktop` deliberately excluded on mobile: getDisplayMedia() inside an
    // iframe is rejected by iOS Safari and most Android browsers, so the
    // button would only surface misleading errors.
    expect(mobileBaseToolbarButtons).not.toContain('desktop');
    expect(mobileBaseToolbarButtons).toContain('raisehand');
    expect(mobileBaseToolbarButtons).toContain('settings');
    expect(mobileBaseToolbarButtons).not.toContain('filmstrip');
    expect(mobileBaseToolbarButtons).not.toContain('tileview');
    expect(mobileBaseToolbarButtons).not.toContain('fullscreen');
    expect(mobileBaseToolbarButtons).not.toContain('select-background');
    expect(mobileBaseToolbarButtons).not.toContain('hangup');
  });

  it('mobileModeratorToolbarButtons extends mobile base with participants-pane, no hangup', () => {
    for (const btn of mobileBaseToolbarButtons) {
      expect(mobileModeratorToolbarButtons).toContain(btn);
    }
    expect(mobileModeratorToolbarButtons).not.toContain('hangup');
    expect(mobileModeratorToolbarButtons).toContain('participants-pane');
  });
});

describe('Jitsi config overwrite', () => {
  it('disables file sharing by default', () => {
    expect(jitsiConfigOverwrite.enableFileSharing).toBe(false);
  });

  it('disables prejoin page', () => {
    expect(jitsiConfigOverwrite.prejoinConfig.enabled).toBe(false);
  });

  it('disables deep linking', () => {
    expect(jitsiConfigOverwrite.disableDeepLinking).toBe(true);
  });

  it('hides conference subject', () => {
    expect(jitsiConfigOverwrite.hideConferenceSubject).toBe(true);
  });

  it('disables P2P', () => {
    expect(jitsiConfigOverwrite.p2p.enabled).toBe(false);
  });

  it('disables native reactions (handled by custom overlay)', () => {
    expect(jitsiConfigOverwrite.disableReactions).toBe(true);
  });

  it('keeps echo cancellation / noise suppression / AGC ON', () => {
    expect(jitsiConfigOverwrite.disableAEC).toBe(false);
    expect(jitsiConfigOverwrite.disableNS).toBe(false);
    expect(jitsiConfigOverwrite.disableAGC).toBe(false);
  });

  it('disables noisy-mic detection (the prompt pushes users into the broken noise-suppression toggle)', () => {
    expect(jitsiConfigOverwrite.enableNoisyMicDetection).toBe(false);
  });

  it('disables kick by default (participants must not see the kick button)', () => {
    // JitsiRoom flips this to false in configOverwrite when role === 'moderator'
    // so the participants-pane "rimuovi utente" action fires. Participants keep
    // the safe default so they never see a non-functional kick option.
    expect(jitsiConfigOverwrite.remoteVideoMenu.disableKick).toBe(true);
  });

  it('disables grant-moderator via UI (grant is driven by JWT only)', () => {
    expect(jitsiConfigOverwrite.remoteVideoMenu.disableGrantModerator).toBe(true);
  });

  it('does NOT include customTheme (server-side only)', () => {
    expect('customTheme' in jitsiConfigOverwrite).toBe(false);
  });

  it('does NOT include dynamicBrandingUrl (server-side only)', () => {
    expect('dynamicBrandingUrl' in jitsiConfigOverwrite).toBe(false);
  });
});

describe('Jitsi interface config overwrite', () => {
  it('hides Jitsi watermarks', () => {
    expect(jitsiInterfaceConfigOverwrite.SHOW_JITSI_WATERMARK).toBe(false);
    expect(jitsiInterfaceConfigOverwrite.SHOW_BRAND_WATERMARK).toBe(false);
  });

  it('hides invite more header', () => {
    expect(jitsiInterfaceConfigOverwrite.HIDE_INVITE_MORE_HEADER).toBe(true);
  });

  it('disables mobile app promo', () => {
    expect(jitsiInterfaceConfigOverwrite.MOBILE_APP_PROMO).toBe(false);
  });
});

describe('Instant call config', () => {
  it('instantCallToolbarButtons includes microphone', () => {
    expect(instantCallToolbarButtons).toContain('microphone');
  });

  it('instantCallToolbarButtons includes camera', () => {
    expect(instantCallToolbarButtons).toContain('camera');
  });

  it('instantCallToolbarButtons includes desktop (screen share)', () => {
    expect(instantCallToolbarButtons).toContain('desktop');
  });

  it('instantCallToolbarButtons includes participants-pane', () => {
    expect(instantCallToolbarButtons).toContain('participants-pane');
  });

  it('instantCallToolbarButtons excludes chat and reactions', () => {
    expect(instantCallToolbarButtons).not.toContain('chat');
    expect(instantCallToolbarButtons).not.toContain('reactions');
  });

  it('instantCallToolbarButtons does not include hangup', () => {
    expect(instantCallToolbarButtons).not.toContain('hangup');
  });

  it('instantCallModeratorToolbarButtons excludes native hangup (exit via app prompt)', () => {
    expect(instantCallModeratorToolbarButtons).not.toContain('hangup');
  });

  it('instantCallModeratorToolbarButtons is superset of instantCallToolbarButtons', () => {
    for (const btn of instantCallToolbarButtons) {
      expect(instantCallModeratorToolbarButtons).toContain(btn);
    }
  });

  it('instant call config enables file sharing', () => {
    expect(instantCallConfigOverwrite.enableFileSharing).toBe(true);
  });

  it('instant call config inherits base config properties', () => {
    expect(instantCallConfigOverwrite.disableDeepLinking).toBe(true);
    expect(instantCallConfigOverwrite.prejoinConfig.enabled).toBe(false);
  });

  it('instant call config starts muted', () => {
    expect(instantCallConfigOverwrite.startWithAudioMuted).toBe(true);
    expect(instantCallConfigOverwrite.startWithVideoMuted).toBe(true);
  });

  it('instant call config has chat enabled in Jitsi backend (for API events)', () => {
    expect(instantCallConfigOverwrite.disableChat).toBe(false);
  });
});

describe('Video quality presets', () => {
  it('default preset is HIGH (720p, capped bitrate)', () => {
    expect(DEFAULT_VIDEO_QUALITY_PRESET).toBe('HIGH');
  });

  it('exposes exactly the four presets', () => {
    expect([...VIDEO_QUALITY_PRESETS]).toEqual(['SAVE_DATA', 'BALANCED', 'HIGH', 'MAX']);
  });

  it('maps each preset to its max height', () => {
    expect(videoQualityMaxHeight('SAVE_DATA')).toBe(360);
    expect(videoQualityMaxHeight('BALANCED')).toBe(540);
    expect(videoQualityMaxHeight('HIGH')).toBe(720);
    expect(videoQualityMaxHeight('MAX')).toBe(1080);
  });

  it('falls back to HIGH for unknown / nullish preset', () => {
    expect(videoQualityMaxHeight(undefined)).toBe(720);
    expect(videoQualityMaxHeight(null)).toBe(720);
    expect(videoQualityMaxHeight('BOGUS')).toBe(720);
    expect(resolveVideoQualityConfig('BOGUS').resolution).toBe(720);
  });

  it('every preset produces the keys that actually change the stream', () => {
    for (const q of VIDEO_QUALITY_PRESETS) {
      const c = resolveVideoQualityConfig(q) as Record<string, unknown>;
      expect(c.resolution).toBeTypeOf('number');
      expect(c.constraints).toBeTruthy();
      expect(c.maxFullResolutionParticipants).toBeTypeOf('number');
      expect(c.channelLastN).toBeTypeOf('number');
      expect(c.videoQuality).toBeTruthy();
      expect(c.audioQuality).toBeTruthy();
    }
  });

  it('resolution rises monotonically SAVE_DATA → MAX', () => {
    const heights = VIDEO_QUALITY_PRESETS.map((q) => videoQualityMaxHeight(q));
    expect(heights).toEqual([...heights].sort((a, b) => a - b));
  });

  it('top video bitrate rises with the preset but HIGH stays bandwidth-conscious (< MAX)', () => {
    const top = (q: string) =>
      (resolveVideoQualityConfig(q).videoQuality as { maxBitratesVideo: { high: number } })
        .maxBitratesVideo.high;
    expect(top('SAVE_DATA')).toBeLessThan(top('BALANCED'));
    expect(top('BALANCED')).toBeLessThan(top('HIGH'));
    expect(top('HIGH')).toBeLessThan(top('MAX'));
    // HIGH (prod default) caps the top layer well below MAX — "favour quality
    // without maxing bandwidth".
    expect(top('HIGH')).toBeLessThanOrEqual(2_500_000);
    expect(top('MAX')).toBeGreaterThanOrEqual(3_500_000);
  });

  it('HIGH disables Opus RED (echo/doubling at 96kbps mono); MAX keeps it on', () => {
    const high = resolveVideoQualityConfig('HIGH') as { enableOpusRed: boolean };
    const max = resolveVideoQualityConfig('MAX') as { enableOpusRed: boolean };
    expect(high.enableOpusRed).toBe(false);
    expect(max.enableOpusRed).toBe(true);
  });

  it('MAX uses rich stereo Opus; SAVE_DATA uses low mono', () => {
    const max = resolveVideoQualityConfig('MAX') as {
      stereo: boolean;
      audioQuality: { opusMaxAverageBitrate: number };
    };
    const save = resolveVideoQualityConfig('SAVE_DATA') as {
      stereo: boolean;
      audioQuality: { opusMaxAverageBitrate: number };
    };
    expect(max.stereo).toBe(true);
    expect(max.audioQuality.opusMaxAverageBitrate).toBeGreaterThan(
      save.audioQuality.opusMaxAverageBitrate,
    );
    expect(save.stereo).toBe(false);
  });

  it('unlocks screenshare framerate above the 5fps Jitsi default, scaling with the preset', () => {
    const fps = (q: string) =>
      resolveVideoQualityConfig(q).desktopSharingFrameRate as { min: number; max: number };
    for (const q of VIDEO_QUALITY_PRESETS) {
      expect(fps(q).min).toBeGreaterThanOrEqual(5);
      expect(fps(q).max).toBeGreaterThan(5); // il default {min:5,max:5} rende inguardabili demo/video
      expect(fps(q).max).toBeGreaterThanOrEqual(fps(q).min);
    }
    expect(fps('SAVE_DATA').max).toBeLessThan(fps('HIGH').max);
    expect(fps('MAX').max).toBeGreaterThanOrEqual(fps('HIGH').max);
  });

  it('returns a fresh object each call (no shared mutable state)', () => {
    const a = resolveVideoQualityConfig('HIGH');
    const b = resolveVideoQualityConfig('HIGH');
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

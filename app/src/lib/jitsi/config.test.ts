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
} from './config';

describe('Jitsi config exports', () => {
  it('baseToolbarButtons does not include hangup', () => {
    expect(baseToolbarButtons).not.toContain('hangup');
  });

  it('moderatorToolbarButtons includes hangup', () => {
    expect(moderatorToolbarButtons).toContain('hangup');
  });

  it('moderatorToolbarButtons is a superset of baseToolbarButtons', () => {
    for (const btn of baseToolbarButtons) {
      expect(moderatorToolbarButtons).toContain(btn);
    }
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

  it('mobileModeratorToolbarButtons extends mobile base with hangup and participants-pane', () => {
    for (const btn of mobileBaseToolbarButtons) {
      expect(mobileModeratorToolbarButtons).toContain(btn);
    }
    expect(mobileModeratorToolbarButtons).toContain('hangup');
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

  it('instantCallModeratorToolbarButtons includes hangup', () => {
    expect(instantCallModeratorToolbarButtons).toContain('hangup');
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

import { describe, it, expect } from 'vitest';
import {
  baseToolbarButtons,
  moderatorToolbarButtons,
  jitsiConfigOverwrite,
  jitsiInterfaceConfigOverwrite,
  participantFeatures,
  moderatorFeatures,
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

  it('instant call config has chat enabled', () => {
    expect(instantCallConfigOverwrite.disableChat).toBe(false);
  });
});

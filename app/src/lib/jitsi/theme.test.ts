import { describe, it, expect } from 'vitest';
import { jitsiConfigOverwrite, jitsiInterfaceConfigOverwrite } from './config';

/**
 * Theme validation for Jitsi configuration.
 *
 * The DTD color palette (customTheme) is now applied server-side via
 * Jitsi's _custom_config_js in the Helm values — NOT in the IFrame API
 * configOverwrite. These tests validate that the IFrame config is clean
 * and that interface overrides are correctly set.
 */

describe('IFrame config does NOT contain theme overrides (server-side only)', () => {
  it('does not include customTheme (applied server-side)', () => {
    expect('customTheme' in jitsiConfigOverwrite).toBe(false);
  });

  it('does not include dynamicBrandingUrl (applied server-side)', () => {
    expect('dynamicBrandingUrl' in jitsiConfigOverwrite).toBe(false);
  });

  it('does not include brandingDataUrl (applied server-side)', () => {
    expect('brandingDataUrl' in jitsiConfigOverwrite).toBe(false);
  });
});

describe('Interface config watermark overrides', () => {
  it('hides Jitsi watermark', () => {
    expect(jitsiInterfaceConfigOverwrite.SHOW_JITSI_WATERMARK).toBe(false);
  });

  it('hides brand watermark', () => {
    expect(jitsiInterfaceConfigOverwrite.SHOW_BRAND_WATERMARK).toBe(false);
  });

  it('hides powered-by', () => {
    expect(jitsiInterfaceConfigOverwrite.SHOW_POWERED_BY).toBe(false);
  });

  it('has configurable provider name', () => {
    expect(typeof jitsiInterfaceConfigOverwrite.PROVIDER_NAME).toBe('string');
  });
});

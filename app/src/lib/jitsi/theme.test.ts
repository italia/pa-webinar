import { describe, it, expect } from 'vitest';
import { dtdJitsiTheme, jitsiConfigOverwrite } from './config';

describe('DTD Jitsi theme palette completeness', () => {
  const palette = dtdJitsiTheme.palette;

  it('defines all core background tokens', () => {
    expect(palette.uiBackground).toBeDefined();
    expect(palette.ui01).toBeDefined();
    expect(palette.ui02).toBeDefined();
    expect(palette.ui03).toBeDefined();
    expect(palette.ui04).toBeDefined();
    expect(palette.ui05).toBeDefined();
  });

  it('defines all action tokens', () => {
    expect(palette.action01).toBeDefined();
    expect(palette.action01Hover).toBeDefined();
    expect(palette.action01Active).toBeDefined();
    expect(palette.action02).toBeDefined();
    expect(palette.action02Hover).toBeDefined();
    expect(palette.action02Active).toBeDefined();
    expect(palette.action03).toBeDefined();
    expect(palette.actionDanger).toBeDefined();
    expect(palette.actionDangerHover).toBeDefined();
    expect(palette.actionDangerActive).toBeDefined();
  });

  it('defines all text tokens', () => {
    expect(palette.text01).toBeDefined();
    expect(palette.text02).toBeDefined();
    expect(palette.text03).toBeDefined();
    expect(palette.text04).toBeDefined();
    expect(palette.textError).toBeDefined();
  });

  it('defines all icon tokens', () => {
    expect(palette.icon01).toBeDefined();
    expect(palette.icon02).toBeDefined();
    expect(palette.icon03).toBeDefined();
    expect(palette.iconError).toBeDefined();
  });

  it('defines field, link, and status tokens', () => {
    expect(palette.field01).toBeDefined();
    expect(palette.link01).toBeDefined();
    expect(palette.link01Hover).toBeDefined();
    expect(palette.link01Active).toBeDefined();
    expect(palette.success01).toBeDefined();
    expect(palette.warning01).toBeDefined();
    expect(palette.disabled01).toBeDefined();
    expect(palette.bottomSheet).toBeDefined();
  });

  it('all color values are valid hex or transparent', () => {
    const hexPattern = /^#[0-9A-Fa-f]{6}$/;
    for (const [key, value] of Object.entries(palette)) {
      expect(
        hexPattern.test(value) || value === 'transparent',
        `palette.${key} = "${value}" is not a valid hex color or "transparent"`,
      ).toBe(true);
    }
  });
});

describe('DTD theme color harmony', () => {
  const palette = dtdJitsiTheme.palette;

  it('primary action matches Bootstrap Italia primary (#0066CC)', () => {
    expect(palette.action01).toBe('#0066CC');
  });

  it('hover states are darker than base action colors', () => {
    const toNum = (hex: string) => parseInt(hex.replace('#', ''), 16);
    expect(toNum(palette.action01Hover)).toBeLessThan(toNum(palette.action01));
    expect(toNum(palette.action01Active)).toBeLessThan(toNum(palette.action01Hover));
  });

  it('background tokens form a dark-to-light gradient', () => {
    const brightness = (hex: string) => {
      const n = parseInt(hex.replace('#', ''), 16);
      const r = (n >> 16) & 0xFF;
      const g = (n >> 8) & 0xFF;
      const b = n & 0xFF;
      return r + g + b;
    };
    expect(brightness(palette.uiBackground)).toBeLessThan(brightness(palette.ui01));
    expect(brightness(palette.ui01)).toBeLessThan(brightness(palette.ui02));
    expect(brightness(palette.ui02)).toBeLessThan(brightness(palette.ui03));
    expect(brightness(palette.ui03)).toBeLessThan(brightness(palette.ui04));
    expect(brightness(palette.ui04)).toBeLessThan(brightness(palette.ui05));
  });

  it('text01 is white for maximum contrast on dark backgrounds', () => {
    expect(palette.text01).toBe('#FFFFFF');
    expect(palette.icon01).toBe('#FFFFFF');
  });

  it('danger color is distinct from action colors', () => {
    expect(palette.actionDanger).not.toBe(palette.action01);
    expect(palette.actionDanger).not.toBe(palette.action02);
  });
});

describe('customTheme integration in config', () => {
  it('jitsiConfigOverwrite embeds the theme object', () => {
    expect(jitsiConfigOverwrite.customTheme).toBeDefined();
    expect(jitsiConfigOverwrite.customTheme).toBe(dtdJitsiTheme);
  });

  it('theme is a nested object with palette property', () => {
    expect(typeof jitsiConfigOverwrite.customTheme).toBe('object');
    expect(typeof jitsiConfigOverwrite.customTheme.palette).toBe('object');
  });

  it('native reactions are disabled (our overlay replaces them)', () => {
    expect(jitsiConfigOverwrite.disableReactions).toBe(true);
  });

  it('chat remains enabled in backend for API events', () => {
    expect(jitsiConfigOverwrite.disableChat).toBe(false);
  });
});

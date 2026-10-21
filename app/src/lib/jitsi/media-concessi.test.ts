import { describe, expect, it } from 'vitest';

import {
  barraConConcessi,
  conAmmissione,
  conModerazione,
  mediumDi,
  statoIniziale,
} from './media-concessi';

const BARRA = ['microphone', 'camera', 'desktop', 'raisehand', 'settings'];

describe('barraConConcessi', () => {
  it('chi ha tutto concesso vede la barra intera', () => {
    expect(barraConConcessi(BARRA, statoIniziale({ audio: true, video: true }))).toEqual(
      BARRA
    );
  });

  it('senza microfono né videocamera concessi i due pulsanti non ci sono', () => {
    expect(
      barraConConcessi(BARRA, statoIniziale({ audio: false, video: false }))
    ).toEqual(['desktop', 'raisehand', 'settings']);
  });

  it('il microfono torna quando chi conduce dà la parola, e se ne va quando la toglie', () => {
    let s = statoIniziale({ audio: false, video: false });
    s = conAmmissione(s, 'audio', true);
    expect(barraConConcessi(BARRA, s)).toEqual([
      'microphone',
      'desktop',
      'raisehand',
      'settings',
    ]);
    s = conAmmissione(s, 'audio', false);
    expect(barraConConcessi(BARRA, s)).not.toContain('microphone');
  });

  it('con il blocco tolto torna per tutti; riacceso, le ammissioni ripartono da zero', () => {
    let s = conAmmissione(statoIniziale({ audio: false, video: false }), 'video', true);
    s = conModerazione(s, 'audio', false);
    expect(barraConConcessi(BARRA, s)).toEqual(BARRA);
    s = conModerazione(s, 'audio', true);
    s = conModerazione(s, 'video', true);
    expect(barraConConcessi(BARRA, s)).toEqual(['desktop', 'raisehand', 'settings']);
  });
});

describe('mediumDi', () => {
  it('riconosce solo audio e video', () => {
    expect(mediumDi('audio')).toBe('audio');
    expect(mediumDi('video')).toBe('video');
    expect(mediumDi('desktop')).toBeNull();
    expect(mediumDi(undefined)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';

import { logoPubblico, ordinaPersone, ruoloPubblico, sitoPubblico } from './public-people';

describe('logoPubblico', () => {
  it('tiene i loghi serviti dall\'app, come percorso', () => {
    expect(logoPubblico('https://webinar.example.gov.it/api/assets/images/logo.png')).toBe(
      '/api/assets/images/logo.png',
    );
    expect(logoPubblico('/api/assets/images/logo.png')).toBe('/api/assets/images/logo.png');
  });

  it('scarta un logo esterno', () => {
    expect(logoPubblico('https://cdn.example.com/logo.png')).toBeNull();
    expect(logoPubblico(null)).toBeNull();
  });
});

describe('sitoPubblico', () => {
  it('accetta solo indirizzi web', () => {
    expect(sitoPubblico('https://ente.example.gov.it')).toBe('https://ente.example.gov.it/');
    expect(sitoPubblico('javascript:alert(1)')).toBeNull();
  });
});

describe('ruoloPubblico e ordinaPersone', () => {
  it('organizzatori, poi moderatori, poi relatori', () => {
    const p = (name: string, role: 'MODERATOR' | 'SPEAKER', organizer = false) => ({
      name,
      role: ruoloPubblico({ role, organizer }),
      organization: null,
      logoUrl: null,
    });
    const ordinate = ordinaPersone([p('Zeno', 'SPEAKER'), p('Bea', 'MODERATOR'), p('Ada', 'MODERATOR', true)]);
    expect(ordinate.map((x) => [x.name, x.role])).toEqual([
      ['Ada', 'organizer'],
      ['Bea', 'moderator'],
      ['Zeno', 'speaker'],
    ]);
  });
});

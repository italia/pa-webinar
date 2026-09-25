import { describe, it, expect } from 'vitest';

import { youtubeWatchLink } from './youtube-link';

describe('youtubeWatchLink', () => {
  it('accetta i link YouTube nelle forme comuni', () => {
    expect(youtubeWatchLink('https://www.youtube.com/watch?v=aaaaaaaaaaa')).toBe(
      'https://www.youtube.com/watch?v=aaaaaaaaaaa',
    );
    expect(youtubeWatchLink('https://youtu.be/aaaaaaaaaaa')).toBe('https://youtu.be/aaaaaaaaaaa');
    expect(youtubeWatchLink('https://m.youtube.com/watch?v=aaaaaaaaaaa')).toBe(
      'https://m.youtube.com/watch?v=aaaaaaaaaaa',
    );
    expect(youtubeWatchLink('  https://youtube.com/live/aaaaaaaaaaa  ')).toBe(
      'https://youtube.com/live/aaaaaaaaaaa',
    );
  });

  it('niente link quando il campo è vuoto o illeggibile', () => {
    expect(youtubeWatchLink(null)).toBeNull();
    expect(youtubeWatchLink(undefined)).toBeNull();
    expect(youtubeWatchLink('')).toBeNull();
    expect(youtubeWatchLink('non è un indirizzo')).toBeNull();
  });

  it('rifiuta gli schemi che non sono http(s), anche se il testo cita YouTube', () => {
    // La validazione dell'API cerca «youtube.com» nel testo: questo passerebbe.
    expect(youtubeWatchLink('javascript:alert(1)//youtube.com')).toBeNull();
    expect(youtubeWatchLink('data:text/html,youtube.com')).toBeNull();
  });

  it('rifiuta gli host che non sono di YouTube', () => {
    expect(youtubeWatchLink('https://altro.example/?v=youtube.com')).toBeNull();
    expect(youtubeWatchLink('https://youtube.com.altro.example/watch?v=a')).toBeNull();
    expect(youtubeWatchLink('https://notyoutube.com/watch?v=a')).toBeNull();
  });
});

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    event: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

const { generateUniqueSlug } = await import('./slug');

function loc(text: string) {
  return { it: text } as Record<string, string>;
}

describe('generateUniqueSlug', () => {
  it('converts basic title', async () => {
    const slug = await generateUniqueSlug(loc('PA Digitale 2026'));
    expect(slug).toBe('pa-digitale-2026');
  });

  it('handles Italian diacritics', async () => {
    const slug = await generateUniqueSlug(loc('Città Metropolitana'));
    expect(slug).toBe('citta-metropolitana');
  });

  it('removes special characters', async () => {
    const slug = await generateUniqueSlug(loc('Q&A: Domande!'));
    expect(slug).toBe('q-a-domande');
  });

  it('collapses multiple spaces and dashes', async () => {
    const slug = await generateUniqueSlug(loc('a  --  b'));
    expect(slug).toBe('a-b');
  });

  it('trims leading and trailing dashes', async () => {
    const slug = await generateUniqueSlug(loc('---hello---'));
    expect(slug).toBe('hello');
  });

  it('lowercases everything', async () => {
    const slug = await generateUniqueSlug(loc('MAIUSCOLE Miste'));
    expect(slug).toBe('maiuscole-miste');
  });

  it('handles accented characters', async () => {
    const slug = await generateUniqueSlug(loc('Café résumé naïve'));
    expect(slug).toBe('cafe-resume-naive');
  });

  it('appends suffix on duplicate', async () => {
    const { prisma } = await import('@/lib/db');
    const mockFindUnique = vi.mocked(prisma.event.findUnique);
    mockFindUnique
      .mockResolvedValueOnce({ id: 'existing' } as never)
      .mockResolvedValueOnce(null);

    const slug = await generateUniqueSlug(loc('Duplicate Title Here'));
    expect(slug).toBe('duplicate-title-here-2');
  });
});

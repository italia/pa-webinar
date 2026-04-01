import { describe, it, expect, vi } from 'vitest';

// Mock prisma to avoid DB dependency. generateUniqueSlug calls prisma.event.findUnique.
vi.mock('@/lib/db', () => ({
  prisma: {
    event: {
      findUnique: vi.fn().mockResolvedValue(null), // No duplicates by default
    },
  },
}));

const { generateUniqueSlug } = await import('./slug');

describe('generateUniqueSlug', () => {
  it('converts basic title', async () => {
    const slug = await generateUniqueSlug('PA Digitale 2026');
    expect(slug).toBe('pa-digitale-2026');
  });

  it('handles Italian diacritics', async () => {
    const slug = await generateUniqueSlug('Città Metropolitana');
    expect(slug).toBe('citta-metropolitana');
  });

  it('removes special characters', async () => {
    const slug = await generateUniqueSlug('Q&A: Domande!');
    expect(slug).toBe('q-a-domande');
  });

  it('collapses multiple spaces and dashes', async () => {
    const slug = await generateUniqueSlug('a  --  b');
    expect(slug).toBe('a-b');
  });

  it('trims leading and trailing dashes', async () => {
    const slug = await generateUniqueSlug('---hello---');
    expect(slug).toBe('hello');
  });

  it('lowercases everything', async () => {
    const slug = await generateUniqueSlug('MAIUSCOLE Miste');
    expect(slug).toBe('maiuscole-miste');
  });

  it('handles accented characters', async () => {
    const slug = await generateUniqueSlug('Café résumé naïve');
    expect(slug).toBe('cafe-resume-naive');
  });

  it('appends suffix on duplicate', async () => {
    const { prisma } = await import('@/lib/db');
    const mockFindUnique = vi.mocked(prisma.event.findUnique);
    // First call: base slug exists. Second call: slug-2 does not exist.
    mockFindUnique
      .mockResolvedValueOnce({ id: 'existing' } as never)
      .mockResolvedValueOnce(null);

    const slug = await generateUniqueSlug('Duplicate Title Here');
    expect(slug).toBe('duplicate-title-here-2');
  });
});

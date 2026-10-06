// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { GlossaryEntry } from './glossary';
import { buildAsrInitialPrompt } from './asr-prompt';

const voce = (term: string, eventId: string | null = null): GlossaryEntry => ({
  id: term,
  eventId,
  term,
  aliases: [],
  reading: 'auto',
  spoken: {},
  translations: {},
  note: null,
  createdById: null,
});

describe('buildAsrInitialPrompt', () => {
  it('aggiunge i termini del glossario dopo titolo, ente e relatori', () => {
    const out = buildAsrInitialPrompt(
      { title: { it: 'Incontro di prova' }, organizerName: 'Ente', speakersInfo: { it: 'Relatore 1' } },
      [voce('ABC'), voce('XYZ', 'ev')],
    );
    expect(out).toBe('Termini: XYZ, ABC. Incontro di prova Organizzato da Ente. Partecipanti e relatori: Relatore 1.');
  });

  it('senza glossario resta com’era; oltre il limite si taglia la testa, non i relatori', () => {
    expect(buildAsrInitialPrompt({ title: 'T', organizerName: null, speakersInfo: {} })).toBe('T');
    const lungo = buildAsrInitialPrompt(
      { title: 'x'.repeat(790), organizerName: null, speakersInfo: { it: 'Relatore 1' } },
      [voce('ABCDEFGHIJ')],
    );
    expect(lungo!.length).toBe(800);
    expect(lungo!.endsWith('Partecipanti e relatori: Relatore 1.')).toBe(true);
    expect(lungo).not.toContain('Termini');
    // I termini restano nel loro spazio, anche con un glossario lungo.
    const molti = Array.from({ length: 200 }, (_, i) => voce(`T${i}`));
    const conMolti = buildAsrInitialPrompt({ title: 'T', organizerName: null, speakersInfo: {} }, molti)!;
    expect(conMolti.length).toBeLessThanOrEqual('Termini: .'.length + 240 + ' T'.length);
    expect(buildAsrInitialPrompt({ title: '', organizerName: null, speakersInfo: {} })).toBeUndefined();
  });
});

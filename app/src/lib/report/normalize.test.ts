import { describe, expect, it } from 'vitest';

import { normalizzaNarrativa } from './normalize';

describe('normalizzaNarrativa', () => {
  it('tiene la forma attesa e scarta il resto', () => {
    const n = normalizzaNarrativa({
      title: '  Il resoconto  ',
      abstract: 'Breve.',
      summary: 'Uno.\n\n\n\nDue.',
      highlights: ['A', 'a', 'B', 3, { text: 'C' }],
      topics: [
        {
          title: 'Tema',
          explanation: 'Spiegazione',
          keyPoints: ['p1'],
          start: '12:30',
          agreement: 'Misto',
          positions: [
            { stance: 'favore', text: 'Bene' },
            { stance: 'boh', text: 'No' },
          ],
        },
        { title: '', explanation: 'senza titolo' },
        { title: 'Senza minuto', start: 'adesso' },
      ],
      conceptMap: {
        nodes: [
          { id: 'Accessibilità', label: 'Accessibilità', kind: 'tema' },
          { id: 'ente', label: 'Ente', kind: 'boh' },
          { id: 'ente', label: 'Doppione', kind: 'concept' },
        ],
        edges: [
          { from: 'ente', to: 'accessibilita', label: 'cura' },
          { from: 'accessibilita', to: 'ente', label: 'doppio' },
          { from: 'ente', to: 'ente', label: 'cappio' },
          { from: 'ente', to: 'fantasma', label: 'nessuno' },
        ],
      },
      feedback: { quotes: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'] },
      extra: '<script>',
    });
    expect(n).not.toBeNull();
    expect(n!.title).toBe('Il resoconto');
    expect(n!.summary).toBe('Uno.\n\nDue.');
    expect(n!.highlights).toEqual(['A', 'B', 'C']);
    expect(n!.topics).toHaveLength(2);
    expect(n!.topics[0]).toMatchObject({
      start: '12:30',
      agreement: 'mixed',
      positions: [{ stance: 'support', text: 'Bene' }],
    });
    expect(n!.topics[1]!.start).toBeNull();
    expect(n!.conceptMap.nodes).toEqual([
      { id: 'accessibilita', label: 'Accessibilità', kind: 'topic' },
      { id: 'ente', label: 'Ente', kind: 'concept' },
    ]);
    expect(n!.conceptMap.edges).toEqual([
      { from: 'ente', to: 'accessibilita', label: 'cura' },
    ]);
    expect(n!.feedback.quotes).toHaveLength(5);
    expect(n).not.toHaveProperty('extra');
  });

  it("senza testo ne' temi non c'e' resoconto", () => {
    expect(normalizzaNarrativa({ title: 'Solo titolo' })).toBeNull();
    expect(normalizzaNarrativa('stringa')).toBeNull();
    expect(normalizzaNarrativa(null)).toBeNull();
  });

  it('taglia i testi troppo lunghi', () => {
    const n = normalizzaNarrativa({ abstract: 'x'.repeat(5000) });
    expect(n!.abstract.length).toBeLessThanOrEqual(900);
    expect(n!.abstract.endsWith('…')).toBe(true);
  });

  it('toglie email e telefoni, non importi, anni, date e codici pubblici', () => {
    const n = normalizzaNarrativa({
      abstract:
        'Scrivere a mario.rossi@comune.example.it o al 333 123 4567; stanziati 1.200.000.000 euro, 300 000 000 nel piano, 3.000.000.000 in tutto; edizioni 2025 2026, prossima il 06.11.2026 10:30.',
      highlights: [
        'Ufficio: 06 1234 5678',
        'Cellulare 3331234567',
        "Dall'estero +39 (06) 1234567",
        'Chiamare +39 333 123 4567',
        '+10 000 000 visite, crescita +1.500.000 (2024)',
        'Gara con CIG 0123456789, partita IVA 01234567890',
        'Prot. n. 3331234567 del 2024',
        'Periodo 30 2024 2025',
      ],
    })!;
    expect(n.abstract).toBe(
      'Scrivere a […] o al […]; stanziati 1.200.000.000 euro, 300 000 000 nel piano, 3.000.000.000 in tutto; edizioni 2025 2026, prossima il 06.11.2026 10:30.'
    );
    expect(n.highlights).toEqual([
      'Ufficio: […]',
      'Cellulare […]',
      "Dall'estero […]",
      'Chiamare […]',
      '+10 000 000 visite, crescita +1.500.000 (2024)',
      'Gara con CIG 0123456789, partita IVA 01234567890',
      'Prot. n. 3331234567 del 2024',
      'Periodo 30 2024 2025',
    ]);
  });

  it('tiene i nodi della mappa scritti in ogni alfabeto', () => {
    const n = normalizzaNarrativa({
      abstract: 'x',
      conceptMap: {
        nodes: [
          { id: 'διαφάνεια', label: 'Διαφάνεια', kind: 'topic' },
          { id: 'обществени-поръчки', label: 'Обществени поръчки', kind: 'concept' },
        ],
        edges: [{ from: 'διαφάνεια', to: 'обществени-поръчки', label: '→' }],
      },
    })!;
    expect(n.conceptMap.nodes.map((x) => x.id)).toEqual([
      'διαφανεια',
      'обществени-поръчки',
    ]);
    expect(n.conceptMap.edges).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';

import { disponiMappa, righeEtichetta } from './concept-map-layout';

const mappa = {
  nodes: [
    {
      id: 'accessibilita',
      label: 'Accessibilità dei servizi digitali',
      kind: 'topic' as const,
    },
    { id: 'interoperabilita', label: 'Interoperabilità', kind: 'topic' as const },
    { id: 'comuni', label: 'Comuni', kind: 'actor' as const },
    { id: 'linee-guida', label: 'Linee guida', kind: 'concept' as const },
    { id: 'piano', label: 'Piano di adeguamento', kind: 'outcome' as const },
  ],
  edges: [
    { from: 'comuni', to: 'accessibilita', label: 'applicano' },
    { from: 'linee-guida', to: 'accessibilita', label: 'regolano' },
    { from: 'piano', to: 'interoperabilita', label: 'prevede' },
    { from: 'piano', to: 'fantasma', label: 'no' },
  ],
};

describe('disponiMappa', () => {
  it('mette il titolo al centro, i temi attorno e gli altri fuori, tutto dentro il disegno', () => {
    const d = disponiMappa(mappa, 'Evento di prova', { width: 900, height: 640 });
    const centro = d.nodes.find((n) => n.kind === 'center')!;
    expect(centro).toMatchObject({ x: 450, y: 320 });
    const dist = (id: string) => {
      const n = d.nodes.find((x) => x.id === id)!;
      return Math.hypot((n.x - 450) / 900, (n.y - 320) / 640);
    };
    expect(dist('accessibilita')).toBeLessThan(dist('comuni'));
    for (const n of d.nodes) {
      expect(n.x - n.larghezza / 2).toBeGreaterThanOrEqual(0);
      expect(n.x + n.larghezza / 2).toBeLessThanOrEqual(900);
      expect(n.y - n.altezza / 2).toBeGreaterThanOrEqual(0);
      expect(n.y + n.altezza / 2).toBeLessThanOrEqual(640);
    }
  });

  it("disegna solo gli archi tra nodi che esistono, piu' quelli dal centro ai temi", () => {
    const d = disponiMappa(mappa, 'Evento di prova');
    expect(d.edges.filter((e) => e.from === '__centro')).toHaveLength(2);
    expect(d.edges.some((e) => e.to === 'fantasma')).toBe(false);
    expect(d.edges.filter((e) => e.from !== '__centro')).toHaveLength(3);
  });

  it("e' deterministica", () => {
    expect(disponiMappa(mappa, 'X')).toEqual(disponiMappa(mappa, 'X'));
  });

  it('senza temi i nodi stanno su un solo anello, senza centro', () => {
    const d = disponiMappa(
      { nodes: mappa.nodes.filter((n) => n.kind !== 'topic'), edges: [] },
      'X'
    );
    expect(d.nodes.some((n) => n.kind === 'center')).toBe(false);
    expect(d.nodes).toHaveLength(3);
  });
});

describe('disponiMappa con molti concetti', () => {
  it('nessuna scatola si sovrappone a un\'altra', () => {
    const temi = Array.from({ length: 6 }, (_, i) => ({
      id: `t${i}`,
      label: `Tema numero ${i} con un nome lungo`,
      kind: 'topic' as const,
    }));
    const altri = Array.from({ length: 16 }, (_, i) => ({
      id: `n${i}`,
      label: i % 2 ? `Concetto ${i}` : `Soggetto con etichetta lunga ${i}`,
      kind: (['concept', 'actor', 'outcome'] as const)[i % 3]!,
    }));
    // Tutti collegati allo stesso tema: si affollano dallo stesso lato.
    const edges = altri.map((n) => ({ from: n.id, to: 't0', label: 'riguarda' }));
    const d = disponiMappa({ nodes: [...temi, ...altri], edges }, 'Un evento con un titolo lungo');
    for (let i = 0; i < d.nodes.length; i++) {
      for (let j = i + 1; j < d.nodes.length; j++) {
        const a = d.nodes[i]!;
        const b = d.nodes[j]!;
        const sovrapposte =
          Math.abs(a.x - b.x) < (a.larghezza + b.larghezza) / 2 &&
          Math.abs(a.y - b.y) < (a.altezza + b.altezza) / 2;
        expect(sovrapposte, `${a.id} e ${b.id}`).toBe(false);
      }
      const n = d.nodes[i]!;
      expect(n.x - n.larghezza / 2).toBeGreaterThanOrEqual(0);
      expect(n.y + n.altezza / 2).toBeLessThanOrEqual(d.height);
    }
  });
});

describe('righeEtichetta', () => {
  it("spezza in al piu' due righe tra le parole", () => {
    expect(righeEtichetta('Interoperabilità')).toEqual(['Interoperabilità']);
    const r = righeEtichetta(
      "Piano triennale per l'informatica nella pubblica amministrazione"
    );
    expect(r).toHaveLength(2);
    expect(r[1]!.endsWith('…')).toBe(true);
  });
});

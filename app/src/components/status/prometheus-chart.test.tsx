import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PrometheusSparkline from './prometheus-chart';

let container: HTMLDivElement;
let root: Root;

function serie(valori: string[]) {
  return {
    available: true,
    metric: 'responseTime',
    data: {
      resultType: 'matrix',
      result: [{ metric: {}, values: valori.map((v, i) => [1_000 + i * 60, v]) }],
    },
  };
}

async function disegna(valori: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(serie(valori))))
  );
  await act(async () => {
    root.render(<PrometheusSparkline metric="responseTime" unit="s" />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('grafico a linea dello stato', () => {
  it('dove Prometheus scrive NaN la linea si interrompe, senza coordinate NaN', async () => {
    await disegna(['1', '2', 'NaN', 'NaN', '3', '4']);
    const linea = container.querySelectorAll('path')[1]!.getAttribute('d')!;
    expect(linea).not.toContain('NaN');
    expect(linea.match(/M /g)).toHaveLength(2);
    expect(container.textContent).toContain('4.0s');
  });

  it("se manca l'ultimo valore non mostra come attuale uno vecchio", async () => {
    await disegna(['1', '2', '3', 'NaN']);
    expect(container.querySelector('path')).not.toBeNull();
    expect(container.textContent).not.toContain('3.0s');
  });

  it('il tempo resta in scala: il buco finale non stira la linea fino al bordo', async () => {
    await disegna(['1', '2', 'NaN', 'NaN']);
    const linea = container.querySelectorAll('path')[1]!.getAttribute('d')!;
    const xs = [...linea.matchAll(/(\d+(?:\.\d+)?),/g)].map((m) => Number(m[1]));
    expect(Math.max(...xs)).toBeLessThan(150);
  });

  it('un valore isolato fra due buchi resta visibile come punto', async () => {
    await disegna(['1', 'NaN', '2', 'NaN', '3', '4']);
    expect(container.querySelectorAll('circle')).toHaveLength(2);
    expect(
      container.querySelectorAll('path')[1]!.getAttribute('d')!.match(/M /g)
    ).toHaveLength(1);
  });
});

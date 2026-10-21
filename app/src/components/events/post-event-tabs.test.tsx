import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import messaggiEn from '@/i18n/messages/en.json';
import messaggiIt from '@/i18n/messages/it.json';

import PostEventTabs from './post-event-tabs';

let container: HTMLDivElement;
let root: Root;

const sondaggio = {
  id: 'p1',
  question: 'Quale tema?',
  options: ['Accessibilità', 'Sicurezza'],
  voteCounts: [3, 9],
  totalVotes: 12,
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function disegna(locale: 'it' | 'en') {
  act(() => {
    root.render(
      <NextIntlClientProvider
        locale={locale}
        messages={locale === 'it' ? messaggiIt : messaggiEn}
      >
        <PostEventTabs
          questions={[]}
          materials={[]}
          polls={[sondaggio]}
          feedback={null}
          showQA={false}
          showMaterials={false}
          showPolls
          showFeedback={false}
        />
      </NextIntlClientProvider>
    );
  });
}

describe('PostEventTabs — sondaggi', () => {
  it('conta i voti nella lingua della pagina', () => {
    disegna('en');
    expect(container.textContent).toContain('12 votes');
    expect(container.textContent).not.toContain('voti');
  });

  it("ogni barra prende il nome dall'opzione e dice voti e percentuale", () => {
    disegna('it');
    const barre = container.querySelectorAll('[role="progressbar"]');
    expect(barre).toHaveLength(2);
    const prima = barre[0] as HTMLElement;
    const nome = document.getElementById(prima.getAttribute('aria-labelledby') ?? '');
    expect(nome?.textContent).toBe('Accessibilità');
    expect(prima.getAttribute('aria-valuenow')).toBe('25');
    expect(prima.getAttribute('aria-valuetext')).toMatch(/^3 voti, 25\s?%$/);
  });
});

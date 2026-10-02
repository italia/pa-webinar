import { NextIntlClientProvider } from 'next-intl';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import messages from '@/i18n/messages/it.json';

import { Skiplink } from './skiplinks';

/**
 * I link di salto devono arrivare nell'HTML del server: per mesi il componente
 * del kit li ha scartati in silenzio, e la pagina ne era priva.
 */
describe('Skiplink', () => {
  const html = renderToString(
    <NextIntlClientProvider locale="it" messages={messages}>
      <Skiplink />
    </NextIntlClientProvider>,
  );

  it('rende «Vai al contenuto» verso il main e il salto al piè di pagina', () => {
    expect(html).toContain('href="#main-content"');
    expect(html).toContain('href="#footer"');
    expect(html).toContain(messages.nav.skipToContent);
  });

  it('i link restano nascosti finché non hanno il fuoco', () => {
    expect(html.match(/visually-hidden-focusable/g)).toHaveLength(2);
  });
});

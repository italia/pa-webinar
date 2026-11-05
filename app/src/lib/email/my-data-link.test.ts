import { describe, expect, it, vi } from 'vitest';

import { linguaEmail } from './lingua';
import { linkIMieiDati } from './my-data-link';

vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale }: { locale: string }) => {
    const { default: messaggi } = await import(`@/i18n/messages/${locale}.json`);
    return (chiave: 'myDataLink') => messaggi.email[chiave];
  },
}));

describe('linkIMieiDati', () => {
  it("prende il testo dal catalogo, nella lingua dell'email", async () => {
    const { default: de } = await import('@/i18n/messages/de.json');
    const link = await linkIMieiDati('https://esempio.invalid', 'de');
    expect(link.label).toBe(de.email.myDataLink);
  });

  it("una lingua senza email usa il testo della lingua dell'email, e la sua pagina", async () => {
    const link = await linkIMieiDati('https://esempio.invalid', 'pl');
    const { default: messaggi } = await import(
      `@/i18n/messages/${linguaEmail('pl')}.json`
    );
    expect(link.label).toBe(messaggi.email.myDataLink);
    expect(link.url).toContain('/pl/');
  });
});

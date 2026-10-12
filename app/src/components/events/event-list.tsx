import { getLocale } from 'next-intl/server';

import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import { markdownToPlainText } from '@/lib/utils/markdown-text';

import EventListClient, { type EventListClientProps } from './event-list-client';

/**
 * Le schede degli eventi, con la descrizione gia' ridotta a testo semplice.
 * Il Markdown si legge qui, sul server: il lettore resta fuori dal pacchetto
 * del browser delle pagine con l'elenco.
 */
export default async function EventList(props: EventListClientProps) {
  const locale = await getLocale();
  // Al browser va solo il testo: la descrizione in Markdown, in tutte le
  // lingue, resta qui.
  const events = props.events.map(({ description, ...event }) => ({
    ...event,
    description: null,
    descrizioneTesto: markdownToPlainText(getLocalized(description as LocalizedField, locale)),
  }));
  return <EventListClient {...props} events={events} />;
}

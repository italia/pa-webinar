import { cache } from 'react';
import { getLocale } from 'next-intl/server';

import { prisma } from '@/lib/db';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';

import { isEventPageVisible } from './visibility';

const campiPerIlTitolo = cache((slug: string) =>
  prisma.event.findUnique({
    where: { slug },
    select: {
      title: true,
      status: true,
      eventType: true,
      endsAt: true,
      postEventPublic: true,
      postEventPublicUntil: true,
    },
  }),
);

type CampiEvento = NonNullable<Awaited<ReturnType<typeof campiPerIlTitolo>>>;

/**
 * Il titolo dell'evento per il `<title>` delle sue pagine, o `null` se la
 * pagina non lo mostrerebbe: i metadati si calcolano anche quando la pagina
 * risponde «non trovato», e una bozza raggiungibile per slug non deve
 * rivelare il proprio titolo. `visibile` e' la stessa regola che usa la
 * pagina, cosi' titolo e contenuto non divergono.
 */
export async function titoloEventoPubblico(
  slug: string,
  visibile: (event: CampiEvento) => boolean = isEventPageVisible,
): Promise<string | null> {
  const event = await campiPerIlTitolo(slug);
  if (!event || !visibile(event)) return null;
  return getLocalized(event.title as LocalizedField, await getLocale());
}

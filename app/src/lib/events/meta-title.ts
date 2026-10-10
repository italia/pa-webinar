import { cache } from 'react';
import { getLocale } from 'next-intl/server';

import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';

import { PERSONE_PUBBLICHE_INCLUDE } from './public-people';
import { anteprimaEvento, firmaPersone } from './share-metadata';
import { isEventPageVisible } from './visibility';

const campiPerIlTitolo = cache((slug: string) =>
  prisma.event.findUnique({
    where: { slug },
    select: {
      slug: true,
      title: true,
      description: true,
      coverImageUrl: true,
      imageUrl: true,
      updatedAt: true,
      status: true,
      eventType: true,
      endsAt: true,
      postEventPublic: true,
      postEventPublicUntil: true,
      // Enti e persone pubblicati: entrano nell'indirizzo della scheda.
      moderatorName: true,
      moderatorPublicListed: true,
      moderatorOrganization: true,
      moderatorOrganizationLogoUrl: true,
      ...PERSONE_PUBBLICHE_INCLUDE,
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

/**
 * L'anteprima del link di una pagina dell'evento (`percorso`, interno: la sala,
 * l'iscrizione), o `null` se la pagina non la mostrerebbe: stessa regola del
 * titolo. Senza, chi riceve il link vede l'anteprima generica del sito.
 */
export async function anteprimaEventoPubblico(
  slug: string,
  percorso: string,
  visibile: (event: CampiEvento) => boolean = isEventPageVisible,
): Promise<ReturnType<typeof anteprimaEvento> | null> {
  const event = await campiPerIlTitolo(slug);
  if (!event || !visibile(event)) return null;
  return anteprimaEvento(
    { ...event, firmaPersone: firmaPersone(event) },
    await getSettings(),
    await getLocale(),
    percorso,
  );
}

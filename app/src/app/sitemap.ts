import type { MetadataRoute } from 'next';

import { prisma } from '@/lib/db';
import { getPublicEnv } from '@/lib/env';
import { publicEventStatusWhere } from '@/lib/events/visibility';
import { localizedUrl } from '@/lib/utils/localized-url';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getPublicEnv('NEXT_PUBLIC_APP_URL');

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: `${baseUrl}/it`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
      alternates: {
        languages: { it: `${baseUrl}/it`, en: `${baseUrl}/en` },
      },
    },
    {
      url: `${baseUrl}/it/eventi`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.9,
      alternates: {
        languages: {
          it: `${baseUrl}/it/eventi`,
          en: `${baseUrl}/en/events`,
        },
      },
    },
  ];

  const events = await prisma.event.findMany({
    where: publicEventStatusWhere(),
    select: { slug: true, updatedAt: true },
    orderBy: { startsAt: 'desc' },
  });

  const eventPages: MetadataRoute.Sitemap = events.map((event) => ({
    url: localizedUrl(baseUrl, `/events/${event.slug}`, 'it'),
    lastModified: event.updatedAt,
    changeFrequency: 'weekly' as const,
    priority: 0.8,
    alternates: {
      languages: {
        it: localizedUrl(baseUrl, `/events/${event.slug}`, 'it'),
        en: localizedUrl(baseUrl, `/events/${event.slug}`, 'en'),
      },
    },
  }));

  return [...staticPages, ...eventPages];
}

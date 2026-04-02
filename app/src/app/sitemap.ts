import type { MetadataRoute } from 'next';

import { prisma } from '@/lib/db';
import { getPublicEnv } from '@/lib/env';

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
          en: `${baseUrl}/en/eventi`,
        },
      },
    },
  ];

  const events = await prisma.event.findMany({
    where: { status: { in: ['PUBLISHED', 'LIVE', 'ENDED'] } },
    select: { slug: true, updatedAt: true },
    orderBy: { startsAt: 'desc' },
  });

  const eventPages: MetadataRoute.Sitemap = events.map((event) => ({
    url: `${baseUrl}/it/eventi/${event.slug}`,
    lastModified: event.updatedAt,
    changeFrequency: 'weekly' as const,
    priority: 0.8,
    alternates: {
      languages: {
        it: `${baseUrl}/it/eventi/${event.slug}`,
        en: `${baseUrl}/en/eventi/${event.slug}`,
      },
    },
  }));

  return [...staticPages, ...eventPages];
}

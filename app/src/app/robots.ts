import type { MetadataRoute } from 'next';

import { getPublicEnv } from '@/lib/env';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getPublicEnv('NEXT_PUBLIC_APP_URL');

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/admin/'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}

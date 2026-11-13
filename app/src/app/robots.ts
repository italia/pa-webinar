// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

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

import path from 'path';

import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,

  sassOptions: {
    includePaths: [
      path.join(__dirname, 'node_modules'),
      path.join(__dirname, '..', 'node_modules'),
    ],
    silenceDeprecations: ['import', 'global-builtin'],
    quietDeps: true,
  },

  // Security headers
  async headers() {
    const jitsiDomain = process.env.NEXT_PUBLIC_JITSI_DOMAIN ?? 'localhost:8443';

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: `camera=(self "https://${jitsiDomain}"), microphone=(self "https://${jitsiDomain}"), display-capture=(self "https://${jitsiDomain}"), geolocation=()`,
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              `frame-src 'self' https://${jitsiDomain}`,
              `script-src 'self' 'unsafe-eval' 'unsafe-inline' https://${jitsiDomain}`,
              "style-src 'self' 'unsafe-inline'",
              "font-src 'self'",
              "img-src 'self' data: blob:",
              `connect-src 'self' https://${jitsiDomain} wss://${jitsiDomain} wss://*.meet.jitsi https://*.meet.jitsi`,
              "media-src 'self' blob:",
            ].join('; '),
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },

  // Output standalone for Docker — trace from workspace root to include hoisted deps
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '..'),
};

export default withNextIntl(nextConfig);

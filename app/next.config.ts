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

  // Output standalone for Docker — trace from workspace root to include hoisted deps
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '..'),
};

export default withNextIntl(nextConfig);

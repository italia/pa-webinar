import path from 'path';

import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // The Phaser lobby ships as raw TS from the workspace; let Next transpile it.
  // It's only ever loaded via a client-only dynamic import (the flagged
  // experimental waiting-room engine), so Phaser stays out of the main bundle.
  transpilePackages: ['@pa-webinar/lobby'],

  // Don't advertise the framework in the response header — minor
  // information disclosure removed.
  poweredByHeader: false,

  sassOptions: {
    includePaths: [
      path.join(__dirname, 'node_modules'),
      path.join(__dirname, '..', 'node_modules'),
    ],
    silenceDeprecations: ['import', 'global-builtin'],
    quietDeps: true,
  },

  // Lint runs as a separate CI step — skip during next build to avoid
  // blocking on pre-existing warnings in test files.
  eslint: { ignoreDuringBuilds: true },

  // Output standalone for Docker — trace from workspace root to include hoisted deps
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '..'),
};

export default withNextIntl(nextConfig);

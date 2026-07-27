import path from 'path';

import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

import { repairPercentColors } from './src/lib/css/repair-percent-colors';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// The webpack types aren't installed (Next ships its own copy), so declare the
// little that's used here instead of reaching for `any`.
interface WebpackCompilation {
  hooks: {
    processAssets: {
      tap(
        options: { name: string; stage: number },
        callback: (assets: Record<string, unknown>) => void,
      ): void;
    };
  };
  getAsset(name: string): { source: { source(): string | Buffer } } | undefined;
  updateAsset(name: string, source: unknown): void;
}

interface WebpackCompiler {
  hooks: {
    compilation: { tap(name: string, callback: (compilation: WebpackCompilation) => void): void };
  };
}

interface WebpackApi {
  Compilation: { PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE: number };
  sources: { RawSource: new (source: string) => unknown };
}

const REPAIR_PLUGIN = 'RepairPercentColors';

/**
 * Repairs the colour declarations that Next's CSS minifier turns invalid.
 * See src/lib/css/repair-percent-colors.ts for the defect and why the fix
 * belongs here rather than upstream in PostCSS.
 */
function repairCssAssets(compilation: WebpackCompilation, webpack: WebpackApi): void {
  compilation.hooks.processAssets.tap(
    {
      name: REPAIR_PLUGIN,
      // After the minifier (which taps OPTIMIZE_SIZE) and before the content
      // hash is computed, so the filename still matches what it contains.
      stage: webpack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE,
    },
    (assets) => {
      for (const name of Object.keys(assets)) {
        if (!name.endsWith('.css')) continue;
        const asset = compilation.getAsset(name);
        if (!asset) continue;

        const { css, repaired } = repairPercentColors(asset.source.source().toString());
        if (repaired === 0) continue;

        compilation.updateAsset(name, new webpack.sources.RawSource(css));
        // The asset name is deliberately left out: the content hash in the
        // emitted filename is computed after this step, so it wouldn't match
        // anything on disk.
        console.log(`  ${REPAIR_PLUGIN}: restored ${repaired} colour values`);
      }
    },
  );
}

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

  webpack(config, { webpack, dev, isServer }) {
    // Dev doesn't minify, so there's nothing to repair there; the server and
    // edge compilations emit no client stylesheet at all.
    if (!dev && !isServer) {
      config.plugins.push({
        apply: (compiler: WebpackCompiler) =>
          compiler.hooks.compilation.tap(REPAIR_PLUGIN, (compilation) =>
            repairCssAssets(compilation, webpack as WebpackApi),
          ),
      });
    }
    return config;
  },
};

export default withNextIntl(nextConfig);

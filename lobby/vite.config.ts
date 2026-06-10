import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));

// Two build personalities:
//   `vite` / `vite build`            → dev harness (serves index.html, mounts the
//                                       lobby with the Mock* deps). Used for local play.
//   `vite build --mode lib`          → library build (entry: src/lobby/index.ts),
//                                       phaser left external. Used to validate the
//                                       module as a consumable package.
export default defineConfig(({ mode }) => {
  if (mode === 'lib') {
    return {
      build: {
        outDir: 'dist',
        lib: {
          entry: resolve(here, 'src/lobby/index.ts'),
          name: 'PaWebinarLobby',
          fileName: 'lobby',
          formats: ['es'],
        },
        rollupOptions: {
          // The host app provides phaser; don't bundle it into the lib.
          external: ['phaser'],
        },
      },
    };
  }

  return {
    server: { port: 5180, open: true },
    build: { outDir: 'dist-harness' },
  };
});

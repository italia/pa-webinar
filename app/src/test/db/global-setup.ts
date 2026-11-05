import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * Prepara il database delle prove una volta per tutta la corsa: applica le
 * migrazioni vere, quelle che girano in produzione, e non `db push`.
 *
 * Le prove svuotano ogni tabella: il nome del database e' l'unica cosa che
 * impedisce di farlo su dati veri.
 */
export default function preparaDatabase(): void {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is required: the database tests need a disposable PostgreSQL'
    );
  }
  const nome = new URL(url).pathname.replace(/^\//, '');
  if (!nome.endsWith('_test')) {
    throw new Error(`Refusing to run on "${nome}": the database name must end in _test`);
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: path.resolve(__dirname, '../../..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

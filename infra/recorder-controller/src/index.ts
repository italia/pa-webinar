/**
 * Entry-point dell'operator recorder (ADR-013 Fase 3).
 *
 * Due meccanismi che convergono sullo stesso `reconcile`:
 *  - level-triggered: un loop ogni `reconcileIntervalMs` interroga il
 *    portale (`recorder-desired`) e diffonde verso i Job reali — è la spina
 *    dorsale (self-healing, GC dei duplicati);
 *  - edge-triggered: un HTTP server espone `POST /dispatch` che il portale
 *    chiama (best-effort) appena rileva un evento LIVE → reconcile immediato,
 *    azzerando la latenza del tick.
 *
 * Tutta la logica decisionale è in `reconcile.ts` (pura, testata): qui solo
 * orchestrazione I/O.
 */

import { createServer } from 'node:http';

import { readConfig, type ControllerConfig } from './config.js';
import { PortalClient } from './portal.js';
import { reconcile } from './reconcile.js';
import type { RecorderRunner } from './runner.js';

/** Costruisce il runner giusto in base alla config (K8s o Docker). */
async function makeRunner(cfg: ControllerConfig): Promise<RecorderRunner> {
  if (cfg.runner === 'kubernetes') {
    const { KubernetesRunner } = await import('./k8s.js');
    return new KubernetesRunner(cfg.k8s!.namespace, cfg.k8s!.recorderCronJobName);
  }
  const { DockerRunner } = await import('./docker.js');
  return new DockerRunner({
    image: cfg.docker!.image,
    network: cfg.docker!.network,
    recorderEnv: cfg.docker!.recorderEnv,
  });
}

async function runReconcile(
  portal: PortalClient,
  runner: RecorderRunner,
): Promise<void> {
  const [desired, actual] = await Promise.all([
    portal.getRecorderDesired(),
    runner.list(),
  ]);
  const plan = reconcile(desired, actual);

  for (const d of plan.toCreate) {
    try {
      await runner.start(d);
      console.log(`[controller] avviato recorder per recording=${d.recordingId}`);
    } catch (err) {
      console.error(`[controller] start fallita per ${d.recordingId}:`, err);
    }
  }
  for (const name of plan.toDelete) {
    try {
      await runner.stop(name);
      console.log(`[controller] fermato recorder duplicato ${name}`);
    } catch (err) {
      console.error(`[controller] stop fallita per ${name}:`, err);
    }
  }
}

export async function main(): Promise<void> {
  const cfg = readConfig();
  const portal = new PortalClient({
    portalUrl: cfg.portalUrl,
    cronApiKey: cfg.cronApiKey,
  });
  const runner = await makeRunner(cfg);

  // Serializza i reconcile: edge e level non si calpestano.
  let running = false;
  const tick = async (trigger: string): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await runReconcile(portal, runner);
    } catch (err) {
      console.error(`[controller] reconcile (${trigger}) errore:`, err);
    } finally {
      running = false;
    }
  };

  // HTTP: /dispatch (edge) + /healthz.
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/dispatch') {
      void tick('dispatch');
      res.writeHead(202).end('accepted');
      return;
    }
    if (req.method === 'GET' && req.url === '/healthz') {
      res.writeHead(200).end('ok');
      return;
    }
    res.writeHead(404).end('not found');
  });
  server.listen(cfg.port, () => {
    console.log(`[controller] in ascolto su :${cfg.port}`);
  });

  // Loop level-triggered.
  console.log(
    `[controller] runner=${runner.kind} reconcile ogni ${cfg.reconcileIntervalMs}ms ` +
      `(portale=${cfg.portalUrl})`,
  );
  await tick('startup');
  setInterval(() => void tick('interval'), cfg.reconcileIntervalMs);
}

const isMain =
  typeof process.argv[1] === 'string' &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  main().catch((err) => {
    console.error('[controller] errore fatale:', err);
    process.exit(1);
  });
}

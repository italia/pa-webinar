/**
 * Idempotency-key derivation for `PostprodJob`.
 *
 * The orchestrator + webhook may both try to enqueue the same job (a
 * Jibri retry, a manual re-run, a webhook re-delivery). We compute a
 * deterministic key from the inputs that uniquely identify a "work
 * unit" — re-creating the same key on a row that already exists is a
 * no-op thanks to the UNIQUE index on `postprod_jobs.idempotency_key`.
 *
 * Format:  sha256( recordingId | kind | runCount | canonicalPayload ).hex.slice(0,40)
 *
 * `runCount` is included because a manual "re-run" from the admin UI
 * bumps `Recording.runCount`, which must result in distinct jobs
 * (otherwise the retry collides with the original and gets ignored).
 */

import { createHash } from 'crypto';

import type { PostprodJobKind } from '@prisma/client';

/**
 * Stringify in a stable, key-order-independent way. Avoid `JSON.stringify`
 * directly because key order in JS objects is mostly insertion-order
 * stable but not guaranteed for non-integer keys across runtimes.
 */
function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalStringify).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + canonicalStringify(obj[k]))
      .join(',') +
    '}'
  );
}

export interface IdempotencyInput {
  recordingId: string;
  kind: PostprodJobKind;
  runCount: number;
  payload: unknown;
}

export function deriveIdempotencyKey(input: IdempotencyInput): string {
  const h = createHash('sha256');
  h.update(input.recordingId);
  h.update('|');
  h.update(input.kind);
  h.update('|');
  h.update(String(input.runCount));
  h.update('|');
  h.update(canonicalStringify(input.payload));
  return h.digest('hex').slice(0, 40);
}

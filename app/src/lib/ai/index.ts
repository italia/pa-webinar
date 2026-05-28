/**
 * `lib/ai` — postprod AI pipeline contracts (server-side only).
 *
 * Surface:
 *   - Zod schemas for every {kind} of PostprodJob payload (validated
 *     at enqueue + on claim).
 *   - Zod schemas for the worker → app callbacks (progress, artifact
 *     register).
 *   - Provider interfaces (ASR, LLM, Translation, Subtitle) — pluggable
 *     so vLLM / OVH / WhisperX / NeMo can all live behind the same
 *     contract. Implementations are NOT in this file; the workers
 *     (Python) call the LLM/ASR directly, and the Next.js app only
 *     speaks to them through the HTTP claim/progress/artifact endpoints.
 *   - Idempotency key helpers.
 *   - Storage path conventions.
 *
 * Why server-only: importing this module from a client component would
 * leak the worker contracts to the browser. The barrel re-exports
 * everything from `schemas`, `idempotency`, `paths`, `providers`.
 */

export * from './schemas';
export * from './idempotency';
export * from './paths';
export * from './providers';
export * from './metrics';

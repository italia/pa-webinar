const MIN_APP_SECRET_BYTES = 32;

let warnedShort = false;

function isShort(value: string | undefined): boolean {
  return !value || value.length < MIN_APP_SECRET_BYTES;
}

function warnOnce(len: number): void {
  if (warnedShort) return;
  warnedShort = true;
  console.warn(
    `[eventi-dtd] APP_SECRET must be at least ${MIN_APP_SECRET_BYTES} bytes ` +
      `(got ${len}). Allowed in non-production environments only.`,
  );
}

/**
 * Returns APP_SECRET when it meets the minimum length, otherwise null.
 * Use for verify paths that must fail closed without throwing
 * (middleware, session checks).
 */
export function tryGetAppSecret(): string | null {
  const s = process.env.APP_SECRET;
  if (isShort(s)) {
    if (process.env.NODE_ENV !== 'production') warnOnce(s?.length ?? 0);
    return null;
  }
  return s ?? null;
}

/**
 * Returns APP_SECRET or throws. In production a short / missing value is
 * fatal — short HS256 keys are brute-forceable, so we refuse to sign.
 * In dev/test we accept short values with a one-shot warning to keep the
 * local docker-compose flow working.
 */
export function requireAppSecret(): string {
  const s = process.env.APP_SECRET;
  if (isShort(s)) {
    const len = s?.length ?? 0;
    const msg =
      `APP_SECRET must be at least ${MIN_APP_SECRET_BYTES} bytes (got ${len})`;
    if (process.env.NODE_ENV === 'production') {
      throw new Error(msg);
    }
    warnOnce(len);
    return s ?? '';
  }
  return s as string;
}

/** Same as requireAppSecret() but returns a Uint8Array suitable for jose. */
export function requireAppSecretKey(): Uint8Array {
  return new TextEncoder().encode(requireAppSecret());
}

export const MIN_APP_SECRET_LENGTH = MIN_APP_SECRET_BYTES;

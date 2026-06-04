#!/usr/bin/env node
// Mint a Jitsi JWT for load testing with jitsi-meet-torture.
//
// Produces a token compatible with the JWT layout used by pa-webinar
// (see app/src/lib/auth/jwt.ts). The token grants participant-level
// access to a given room on the configured Jitsi tenant.
//
// Usage:
//   node mint-jwt.mjs --room load-test-room --name "Bot 001" [--moderator]
//
// Required env vars (same names used by the app):
//   JITSI_JWT_SECRET       shared HS256 secret configured on Prosody
//   JITSI_JWT_APP_ID       app id claim (default: pa_webinar)
//   JITSI_JWT_ISSUER       iss claim   (default: pa-webinar)
//   JITSI_JWT_AUDIENCE     aud claim   (default: jitsi)
//   JITSI_JWT_SUBJECT      sub claim, typically the Jitsi domain

import { SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    room: { type: 'string' },
    name: { type: 'string', default: 'Load Test Bot' },
    moderator: { type: 'boolean', default: false },
    ttl: { type: 'string', default: '2h' },
  },
});

if (!values.room) {
  console.error('error: --room is required');
  process.exit(1);
}

const secret = process.env.JITSI_JWT_SECRET;
if (!secret) {
  console.error('error: JITSI_JWT_SECRET env var is required');
  process.exit(1);
}

const appId = process.env.JITSI_JWT_APP_ID ?? 'pa_webinar';
const issuer = process.env.JITSI_JWT_ISSUER ?? 'pa-webinar';
const audience = process.env.JITSI_JWT_AUDIENCE ?? 'jitsi';
const subject = process.env.JITSI_JWT_SUBJECT ?? 'meet.jitsi';

const ttlSeconds = parseTtl(values.ttl);

const token = await new SignJWT({
  context: {
    user: {
      id: randomUUID(),
      name: values.name,
      moderator: values.moderator ? 'true' : 'false',
    },
    features: values.moderator
      ? { recording: 'true', livestreaming: 'false', 'screen-sharing': 'true' }
      : { recording: 'false', livestreaming: 'false', 'screen-sharing': 'false' },
  },
  room: values.room,
})
  .setProtectedHeader({ alg: 'HS256' })
  .setIssuedAt()
  .setIssuer(issuer)
  .setAudience(audience)
  .setSubject(subject)
  .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
  .sign(new TextEncoder().encode(secret));

// Emit the app id as the "iss" convention expects, but jitsi also reads it
// from the "iss" claim set above. The appId env var is kept for parity with
// the app and available for debugging.
process.stdout.write(token + '\n');

function parseTtl(str) {
  const m = /^(\d+)([smhd])$/.exec(str);
  if (!m) throw new Error(`invalid --ttl: ${str}`);
  const n = Number(m[1]);
  const mul = { s: 1, m: 60, h: 3600, d: 86400 }[m[2]];
  return n * mul;
}

#!/usr/bin/env node
// Sync the message bundle structure across all locales.
//
// Strategy:
// - en.json is the canonical key set (mirrors it.json by construction).
// - For every other locale, walk en.json and ensure every key exists in
//   the locale file. Where the locale already has a translated string, we
//   keep it. Where the type conflicts with en (e.g. a stale string where
//   en now expects an object), the en structure wins. Keys present only
//   in the locale file are dropped — those are the legacy stale keys
//   from past refactors.
//
// Run with: node scripts/sync-i18n.mjs

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const messagesDir = join(__dirname, '..', 'app', 'src', 'i18n', 'messages');

const REFERENCE = 'en';
const PRESERVED = new Set(['it', 'en']);

const referencePath = join(messagesDir, `${REFERENCE}.json`);
const reference = JSON.parse(readFileSync(referencePath, 'utf8'));

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Build a target object that matches the structure of `ref` exactly.
// For each key:
//   - if ref[k] is an object → recurse with existing[k] (or {})
//   - if ref[k] is a string  → keep existing[k] when it is also a
//     non-empty string, else fall back to ref[k]
//   - arrays are copied verbatim from existing (if same length) or ref
function merge(ref, existing) {
  if (isPlainObject(ref)) {
    const out = {};
    const src = isPlainObject(existing) ? existing : {};
    for (const k of Object.keys(ref)) {
      out[k] = merge(ref[k], src[k]);
    }
    return out;
  }
  if (Array.isArray(ref)) {
    if (Array.isArray(existing) && existing.length === ref.length) return existing;
    return ref;
  }
  if (typeof ref === 'string') {
    if (typeof existing === 'string' && existing.length > 0) return existing;
    return ref;
  }
  return existing ?? ref;
}

const files = readdirSync(messagesDir).filter((f) => f.endsWith('.json'));
let added = 0;
let dropped = 0;

for (const file of files) {
  const locale = file.replace(/\.json$/, '');
  if (PRESERVED.has(locale)) continue;

  const path = join(messagesDir, file);
  const existing = JSON.parse(readFileSync(path, 'utf8'));

  // Count diagnostics before merging.
  const refKeys = collectPaths(reference);
  const existingKeys = collectPaths(existing);
  const missing = [...refKeys].filter((k) => !existingKeys.has(k));
  const stale = [...existingKeys].filter((k) => !refKeys.has(k));
  added += missing.length;
  dropped += stale.length;

  const merged = merge(reference, existing);
  writeFileSync(path, JSON.stringify(merged, null, 2) + '\n', 'utf8');

  console.log(
    `${locale}: +${missing.length} missing keys filled with English, -${stale.length} stale keys dropped`,
  );
}

console.log(`\nTotal: ${added} keys added across locales, ${dropped} stale keys removed.`);

function collectPaths(obj, prefix = '', acc = new Set()) {
  if (isPlainObject(obj)) {
    for (const k of Object.keys(obj)) {
      collectPaths(obj[k], prefix ? `${prefix}.${k}` : k, acc);
    }
  } else {
    acc.add(prefix);
  }
  return acc;
}

#!/usr/bin/env node

/**
 * Generates license-report.json from installed npm dependencies.
 *
 * Uses license-checker under the hood, then strips local filesystem paths
 * and empty optional fields so the report is portable and publishable.
 *
 * Usage: node scripts/generate-license-report.mjs
 */

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const outputPath = resolve(projectRoot, "license-report.json");

const raw = execSync(
  "npx license-checker --json --relativeLicensePath --excludePrivatePackages",
  { cwd: projectRoot, encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 },
);

const parsed = JSON.parse(raw);

const cleaned = {};
for (const [key, entry] of Object.entries(parsed)) {
  const out = { licenses: entry.licenses };

  if (entry.repository) out.repository = entry.repository;
  if (entry.publisher) out.publisher = entry.publisher;
  if (entry.email) out.email = entry.email;
  if (entry.url) out.url = entry.url;
  if (entry.licenseFile) out.licenseFile = entry.licenseFile;

  cleaned[key] = out;
}

writeFileSync(outputPath, JSON.stringify(cleaned, null, 2) + "\n");

const count = Object.keys(cleaned).length;
console.log(`license-report.json written with ${count} packages.`);

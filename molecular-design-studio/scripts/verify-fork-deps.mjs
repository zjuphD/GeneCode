#!/usr/bin/env node
/**
 * A-SUPPLY-001: fork dependency governance.
 *
 * The vendored @genecode/ove fork is a source-level package resolved through
 * the Vite alias — it is never installed or published independently, so it has
 * no lockfile of its own. Its `dependencies` must therefore be governed by the
 * ROOT package-lock.json. This script enforces that contract in CI:
 *
 *   1. every `dependencies` entry in packages/genecode-ove/package.json must
 *      resolve to a root-lockfile package whose version satisfies the declared
 *      range (catches silent spec drift in the vendored engine);
 *   2. the lockfile must only reference the official npm registry (a mirror
 *      lockfile breaks `npm ci` provenance and reproducibility).
 *
 * Exit code 0 = clean, 1 = violation (CI fails the gate).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const forkPkgPath = join(root, "packages/genecode-ove/package.json");
const lockPath = join(root, "package-lock.json");

const forkPkg = JSON.parse(readFileSync(forkPkgPath, "utf8"));
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
const packages = lock.packages ?? {};

const problems = [];

// 1. Fork dependency specs must be satisfiable by the root lockfile.
//    npm aliases (`name: npm:real-pkg@range`) are checked against the aliased
//    package's version, which is what the lockfile records under `name`.
const forkDeps = forkPkg.dependencies ?? {};
for (const [name, range] of Object.entries(forkDeps)) {
  const entry = packages[`node_modules/${name}`];
  if (!entry) {
    problems.push(`fork dep ${name}@${range} has no root lockfile entry`);
    continue;
  }
  const resolved = entry.version;
  const declared = range.startsWith("npm:") ? range.slice("npm:".length) : range;
  const atIndex = declared.indexOf("@");
  const declaredRange = atIndex >= 0 ? declared.slice(atIndex + 1) : declared;
  let ok = false;
  try {
    ok = semver.satisfies(resolved, declaredRange, { includePrerelease: true });
  } catch {
    ok = false;
  }
  if (!ok) {
    problems.push(
      `fork dep ${name}@${range} resolved to ${resolved} in the root lockfile (range not satisfied)`,
    );
  }
}

// 2. Lockfile must point at the official npm registry only.
for (const [key, entry] of Object.entries(packages)) {
  const resolved = entry.resolved;
  if (typeof resolved === "string" && !resolved.startsWith("https://registry.npmjs.org/")) {
    problems.push(`non-official registry URL in lockfile entry ${key}: ${resolved}`);
  }
}

if (problems.length > 0) {
  console.error(`verify-fork-deps: ${problems.length} violation(s)`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(
  `verify-fork-deps: OK — ${Object.keys(forkDeps).length} fork deps satisfy root lockfile, all resolved URLs on registry.npmjs.org`,
);

#!/usr/bin/env node
/**
 * A-REL-002: append distributable bundle artifacts (the signed/notarized DMG,
 * and later Windows/Linux installers) to `dist/release-manifest.json` and the
 * `dist/release-manifest.sha256` sidecar, so ONE manifest verifies both the
 * web bundle and the desktop installers produced by the release pipeline.
 *
 * Usage:
 *   node scripts/add-bundle-manifest.mjs "<logicalPath>=<file>" [ ... ]
 *
 * Example:
 *   node scripts/add-bundle-manifest.mjs \
 *     "macos/GeneCode_0.1.0_x86_64.dmg=src-tauri/target/release/bundle/dmg/GeneCode_0.1.0_x86_64.dmg"
 *
 * - `logicalPath` is relative to the manifest root ("dist/") and becomes the
 *   stable identifier a downstream verifier checks (e.g. `macos/GeneCode.dmg`).
 * - `file` may be absolute or relative to the repo root (process cwd).
 * - Existing entries with the same logical path are replaced — idempotent, so
 *   the release job can be retried safely.
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const DIST = resolve(process.cwd(), "dist");
const manifestPath = resolve(DIST, "release-manifest.json");
const shaPath = resolve(DIST, "release-manifest.sha256");

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: node scripts/add-bundle-manifest.mjs <logicalPath>=<file> [...]");
  process.exit(1);
}

const additions = [];
for (const arg of args) {
  const eq = arg.indexOf("=");
  if (eq < 1) {
    throw new Error(`Expected <logicalPath>=<file>, got: ${arg}`);
  }
  const logical = arg.slice(0, eq);
  const file = resolve(process.cwd(), arg.slice(eq + 1));
  if (!existsSync(file) || statSync(file).isDirectory()) {
    throw new Error(`Bundle artifact not found (or is a directory): ${file}`);
  }
  additions.push({
    path: logical.replace(/\\/g, "/"),
    size: statSync(file).size,
    sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
  });
}

const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8"))
  : { schema: "genecode-release-manifest/1", product: "GeneCode", artifacts: [], sbom: null };

for (const a of additions) {
  const i = manifest.artifacts.findIndex((e) => e.path === a.path);
  if (i >= 0) manifest.artifacts[i] = a;
  else manifest.artifacts.push(a);
}
manifest.artifacts.sort((a, b) => (a.path < b.path ? -1 : 1));

const sbomPath = resolve(DIST, "SBOM.cyclonedx.json");
if (existsSync(sbomPath) && !manifest.sbom) {
  manifest.sbom = {
    path: "SBOM.cyclonedx.json",
    sha256: createHash("sha256").update(readFileSync(sbomPath)).digest("hex"),
  };
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

const lines = [
  `# GeneCode release checksums — generated ${new Date().toISOString()}`,
  ...manifest.artifacts.map((e) => `${e.sha256}  ${e.path}`),
];
if (manifest.sbom) lines.push(`${manifest.sbom.sha256}  ${manifest.sbom.path}`);
writeFileSync(shaPath, lines.join("\n") + "\n");

console.log(`release-manifest: ${manifest.artifacts.length} artifacts (added ${additions.length})`);

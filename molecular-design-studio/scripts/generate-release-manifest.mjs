#!/usr/bin/env node
/**
 * A-REL-002: generate a release manifest with SHA-256 checksums for the
 * production artifacts (frontend bundle, SBOM, and the tauri bundle when
 * present). Emits `dist/release-manifest.json` plus a human-readable
 * `dist/release-manifest.sha256` sidecar.
 *
 * Usage:
 *   node scripts/generate-release-manifest.mjs
 *
 * The manifest is intentionally reproducible: `--output-reproducible`-style
 * ordering, sorted artifact list, no timestamps inside the JSON (the
 * generation time goes in the .sha256 sidecar only).
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const DIST = resolve(process.cwd(), "dist");

// Everything under dist/ is a build artifact — the Vite output (assets, html,
// css) plus the SBOM and generated manifests. Collect every file so a
// downstream consumer can verify the whole deployable tree.
function collectFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

const files = collectFiles(DIST)
  // The manifest is generated from the previous run's output on re-runs;
  // exclude it (and its sidecar) so a manifest never contains a stale copy
  // of itself.
  .filter((f) => {
    const name = f.split("/").pop() ?? "";
    return name !== "release-manifest.json" && name !== "release-manifest.sha256";
  })
  .sort((a, b) => (a < b ? -1 : 1));

const entries = files.map((f) => ({
  path: relative(DIST, f).replace(/\\/g, "/"),
  size: statSync(f).size,
  sha256: sha256(f),
}));

const sbomPath = join(DIST, "SBOM.cyclonedx.json");
const manifest = {
  schema: "genecode-release-manifest/1",
  product: "GeneCode",
  artifacts: entries,
  sbom: existsSync(sbomPath) ? {
    path: "SBOM.cyclonedx.json",
    sha256: sha256(sbomPath),
  } : null,
};

const manifestJson = JSON.stringify(manifest, null, 2) + "\n";
writeFileSync(join(DIST, "release-manifest.json"), manifestJson);

const lines = [
  `# GeneCode release checksums — generated ${new Date().toISOString()}`,
  ...entries.map((e) => `${e.sha256}  ${e.path}`),
];
if (manifest.sbom) lines.push(`${manifest.sbom.sha256}  ${manifest.sbom.path}`);
writeFileSync(join(DIST, "release-manifest.sha256"), lines.join("\n") + "\n");

console.log(`release-manifest: ${entries.length} artifacts, ${manifest.sbom ? "SBOM included" : "no SBOM found"}`);

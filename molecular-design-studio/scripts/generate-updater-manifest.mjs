#!/usr/bin/env node
/**
 * generate-updater-manifest.mjs — builds the JSON manifest (latest.json) that
 * the Tauri updater fetches from `plugins.updater.endpoints`.
 *
 * The plugin expects (tauri-plugin-updater 2.x "Static" format):
 *   {
 *     "version": "0.1.0",            // semver of the NEW release
 *     "notes":   "...",              // optional release notes
 *     "pub_date": "2026-08-08T...Z", // RFC 3339
 *     "platforms": {
 *       "darwin-aarch64":  { "url": "https://…/GeneCode-0.1.0-aarch64.app.tar.gz",  "signature": "…" },
 *       "darwin-x86_64":   { "url": "https://…/GeneCode-0.1.0-x86_64.app.tar.gz",   "signature": "…" },
 *       "windows-x86_64-nsis": { "url": "https://…/GeneCode-0.1.0-x86_64-setup.nsis.zip", "signature": "…" },
 *       "linux-x86_64":    { "url": "https://…/GeneCode-0.1.0-x86_64.AppImage.tar.gz", "signature": "…" }
 *     }
 *   }
 *
 * Platform keys are `{os}-{arch}` (Windows adds `-{installer}` = `-nsis`),
 * matching what the plugin searches for. Artifacts come from
 * `createUpdaterArtifacts: true` — macOS `*.app.tar.gz`, Windows
 * `*.nsis.zip`, Linux `*.AppImage.tar.gz` — each next to its `.sig`.
 *
 * Usage:
 *   node scripts/generate-updater-manifest.mjs \
 *     --version 0.1.0 \
 *     --base-url https://github.com/<owner>/<repo>/releases/latest/download \
 *     --tauri-config src-tauri/tauri.conf.json \
 *     --require-platform darwin-aarch64 \
 *     --out dist/latest.json \
 *     src-tauri/target/release/bundle/macos \
 *     src-tauri/target/x86_64-apple-darwin/release/bundle/macos
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function parseArgs(argv) {
  const args = { dirs: [], requiredPlatforms: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === "--version") args.version = next();
    else if (arg === "--base-url") args.baseUrl = next();
    else if (arg === "--tauri-config") args.tauriConfig = next();
    else if (arg === "--require-platform") args.requiredPlatforms.push(next());
    else if (arg === "--out") args.out = next();
    else if (arg === "--notes") args.notes = next();
    else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else args.dirs.push(arg);
  }
  return args;
}

function publicKeyId(tauriConfigPath) {
  if (!tauriConfigPath) throw new Error("--tauri-config <path> is required");
  const config = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
  const wrapped = config.plugins?.updater?.pubkey;
  if (typeof wrapped !== "string" || !wrapped.trim()) {
    throw new Error("Tauri updater public key is missing");
  }
  const envelope = Buffer.from(wrapped, "base64").toString("utf8");
  const encoded = envelope
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("untrusted comment:"));
  if (!encoded) throw new Error("Tauri updater public-key envelope has no key line");
  const raw = Buffer.from(encoded, "base64");
  if (raw.length !== 42) throw new Error("Tauri updater public-key payload has an invalid length");
  if (!new Set(["Ed", "ED"]).has(raw.subarray(0, 2).toString("ascii"))) {
    throw new Error("Tauri updater public key has an unsupported algorithm marker");
  }
  return raw.subarray(2, 10).toString("hex");
}

function signatureKeyId(signaturePath) {
  const stored = readFileSync(signaturePath, "utf8").trim();
  // Tauri writes updater signatures as base64(minisign envelope). Accept a
  // plain envelope too so the failure message remains useful for hand-made
  // fixtures, but release artifacts normally take the wrapped branch.
  const envelope = stored.startsWith("untrusted comment:")
    ? stored
    : Buffer.from(stored, "base64").toString("utf8");
  const encoded = envelope
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("untrusted comment:"));
  if (!encoded) throw new Error(`Signature envelope has no signature line: ${signaturePath}`);
  const raw = Buffer.from(encoded, "base64");
  if (raw.length !== 74) throw new Error(`Signature payload has an invalid length: ${signaturePath}`);
  if (!new Set(["Ed", "ED"]).has(raw.subarray(0, 2).toString("ascii"))) {
    throw new Error(`Signature has an unsupported algorithm marker: ${signaturePath}`);
  }
  return raw.subarray(2, 10).toString("hex");
}

function validateBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("--base-url must use HTTPS");
  const joined = `${url.hostname}${url.pathname}`.toLowerCase();
  if (url.hostname.endsWith(".invalid") || joined.includes("owner/repo")) {
    throw new Error("--base-url must not be a disabled or placeholder endpoint");
  }
  return value.replace(/\/+$/, "");
}

// artifact extension -> (os, installer) for the platform key
const ARTIFACT_KINDS = [
  { ext: ".app.tar.gz", os: "darwin" },
  { ext: ".nsis.zip", os: "windows", installer: "nsis" },
  { ext: ".AppImage.tar.gz", os: "linux" },
];

function platformKey(kind, arch) {
  return kind.installer ? `${kind.os}-${arch}-${kind.installer}` : `${kind.os}-${arch}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.version) throw new Error("--version <semver> is required");
  if (!args.baseUrl) throw new Error("--base-url <url> is required");
  if (args.dirs.length === 0) throw new Error("at least one bundle directory is required");

  const baseUrl = validateBaseUrl(args.baseUrl);
  const expectedKeyId = publicKeyId(args.tauriConfig);

  const platforms = {};
  const seen = new Set();

  for (const dir of args.dirs) {
    if (!existsSync(dir)) {
      console.warn(`[warn] bundle dir not found, skipping: ${dir}`);
      continue;
    }
    const files = readdirSync(dir);
    for (const kind of ARTIFACT_KINDS) {
      for (const name of files) {
        if (!name.endsWith(kind.ext)) continue;
        const sigPath = join(dir, `${name}.sig`);
        if (!existsSync(sigPath)) {
          console.warn(`[warn] missing signature for ${name} — skipping (unsigned artifact)`);
          continue;
        }
        // extract arch: the token right before the kind extension
        const stem = name.slice(0, -kind.ext.length); // e.g. GeneCode-0.1.0-aarch64
        const arch = stem.split("-").pop();
        if (!arch) {
          console.warn(`[warn] cannot derive arch from ${name} — skipping`);
          continue;
        }
        if (!stem.includes(`-${args.version}-`)) {
          throw new Error(`Artifact version does not match ${args.version}: ${name}`);
        }
        const key = platformKey(kind, arch);
        if (seen.has(key)) {
          throw new Error(`Duplicate platform key ${key}: ${name}`);
        }
        const actualKeyId = signatureKeyId(sigPath);
        if (actualKeyId !== expectedKeyId) {
          throw new Error(
            `Updater signature key id mismatch for ${name}: ${actualKeyId} != ${expectedKeyId}`,
          );
        }
        seen.add(key);
        platforms[key] = {
          url: `${baseUrl}/${encodeURIComponent(name)}`,
          signature: readFileSync(sigPath, "utf8").trim(),
        };
        console.log(`[ok] ${key} <- ${name}`);
      }
    }
  }

  if (Object.keys(platforms).length === 0) {
    throw new Error("No signed updater artifacts found; refusing an empty latest.json");
  }
  for (const required of args.requiredPlatforms) {
    if (!Object.hasOwn(platforms, required)) {
      throw new Error(`Required updater platform is missing: ${required}`);
    }
  }

  const manifest = {
    version: args.version,
    notes: args.notes ?? "",
    pub_date: new Date().toISOString(),
    platforms,
  };

  const out = args.out ?? "latest.json";
  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[ok] wrote ${out} (${Object.keys(platforms).length} platform entries)`);
}

main();

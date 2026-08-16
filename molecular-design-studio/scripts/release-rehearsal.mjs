#!/usr/bin/env node
/**
 * Offline release rehearsal. It validates the fail-closed base updater config,
 * generates the same repository-specific overlay used by CI, and assembles a
 * synthetic latest.json without touching a network, a signing key, or GitHub.
 *
 * The synthetic minisign envelope only exercises key-id/manifest wiring. It is
 * deliberately not a cryptographic signature and is never written outside a
 * temporary directory.
 */

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  DISABLED_UPDATER_ENDPOINT,
  releaseConfigForRepository,
} from "./configure-updater-endpoint.mjs";

const root = resolve(process.cwd());
const tauriConfigPath = join(root, "src-tauri", "tauri.conf.json");
const packagePath = join(root, "package.json");
const workflowPath = join(root, "..", ".github", "workflows", "release.yml");
const generatorPath = join(root, "scripts", "generate-updater-manifest.mjs");

function decodePublicKeyId(pubkey) {
  const envelope = Buffer.from(pubkey, "base64").toString("utf8");
  const encoded = envelope
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("untrusted comment:"));
  assert.ok(encoded, "updater public-key envelope has no key line");
  const raw = Buffer.from(encoded, "base64");
  assert.ok(raw.length >= 10, "updater public-key payload is too short");
  return raw.subarray(2, 10);
}

function syntheticSignature(pubkey) {
  const keyId = decodePublicKeyId(pubkey);
  const signatureRecord = Buffer.concat([
    Buffer.from("Ed", "ascii"),
    keyId,
    Buffer.alloc(64),
  ]).toString("base64");
  const envelope = [
    "untrusted comment: synthetic release rehearsal only",
    signatureRecord,
    "trusted comment: no cryptographic signature was created",
    Buffer.alloc(64).toString("base64"),
    "",
  ].join("\n");
  // Match the on-disk representation emitted by Tauri: the entire minisign
  // envelope is base64-wrapped before being embedded into latest.json.
  return Buffer.from(envelope, "utf8").toString("base64");
}

function main() {
  const base = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
  const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  const endpoint = base.plugins?.updater?.endpoints?.[0];
  assert.equal(
    endpoint,
    DISABLED_UPDATER_ENDPOINT,
    "checked-in updater endpoint must remain fail-closed",
  );
  assert.equal(pkg.version, base.version, "package and Tauri versions must match");
  assert.ok(base.plugins?.updater?.pubkey, "updater public key is required");

  const workflow = readFileSync(workflowPath, "utf8");
  assert.ok(!workflow.includes("OWNER/REPO"), "release workflow contains a placeholder repository");
  assert.ok(
    (workflow.match(/configure-updater-endpoint\.mjs/g) ?? []).length >= 4,
    "every platform build must generate a release updater overlay",
  );
  assert.ok(
    (workflow.match(/--config src-tauri\/target\/tauri\.release\.conf\.json/g) ?? [])
      .length >= 4,
    "every platform build must consume the release updater overlay",
  );
  assert.match(workflow, /RELEASE_SIGNING_READY/);
  assert.match(workflow, /github\.event_name == 'push'/);
  assert.ok(
    !workflow.includes("genecode-release-macos-arm64/molecular-design-studio/"),
    "publish job assumes the wrong upload-artifact root",
  );
  for (const signedPattern of [
    "*.app.tar.gz.sig",
    "*.nsis.zip.sig",
    "*.AppImage.tar.gz.sig",
  ]) {
    assert.ok(workflow.includes(signedPattern), `workflow does not preserve ${signedPattern}`);
  }

  assert.throws(() => releaseConfigForRepository("OWNER/REPO"), /placeholder/i);
  assert.throws(() => releaseConfigForRepository("missing-owner"), /owner.*repo/i);

  const temp = mkdtempSync(join(tmpdir(), "genecode-release-rehearsal-"));
  try {
    const overlay = releaseConfigForRepository("example-org/genecode");
    assert.equal(
      overlay.plugins.updater.endpoints[0],
      "https://github.com/example-org/genecode/releases/latest/download/latest.json",
    );

    const overlayPath = join(temp, "tauri.release.conf.json");
    writeFileSync(overlayPath, `${JSON.stringify(overlay, null, 2)}\n`);

    const bundleDir = join(temp, "bundle", "macos");
    mkdirSync(bundleDir, { recursive: true });
    const artifactName = `GeneCode-${pkg.version}-aarch64.app.tar.gz`;
    writeFileSync(join(bundleDir, artifactName), "synthetic artifact; not releasable\n");
    writeFileSync(
      join(bundleDir, `${artifactName}.sig`),
      syntheticSignature(base.plugins.updater.pubkey),
    );

    const latestPath = join(temp, "latest.json");
    const generated = spawnSync(
      process.execPath,
      [
        generatorPath,
        "--version",
        pkg.version,
        "--base-url",
        "https://github.com/example-org/genecode/releases/latest/download",
        "--tauri-config",
        tauriConfigPath,
        "--require-platform",
        "darwin-aarch64",
        "--out",
        latestPath,
        bundleDir,
      ],
      { encoding: "utf8" },
    );
    assert.equal(generated.status, 0, generated.stderr || generated.stdout);

    const latest = JSON.parse(readFileSync(latestPath, "utf8"));
    assert.equal(latest.version, pkg.version);
    assert.deepEqual(Object.keys(latest.platforms), ["darwin-aarch64"]);
    assert.equal(
      latest.platforms["darwin-aarch64"].url,
      `https://github.com/example-org/genecode/releases/latest/download/${artifactName}`,
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }

  console.log("[ok] fail-closed checked-in updater endpoint");
  console.log("[ok] repository-specific release overlay and workflow wiring");
  console.log("[ok] updater manifest/key-id wiring (synthetic artifact only)");
  console.log("[safe] no network, publication, private key, or real signature was used");
}

main();

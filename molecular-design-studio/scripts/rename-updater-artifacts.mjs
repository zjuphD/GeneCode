#!/usr/bin/env node
/**
 * rename-updater-artifacts.mjs — gives Tauri updater artifacts per-architecture
 * names, because Tauri v2 (2.11.x) has no `bundle.fileName` template.
 *
 * Default artifact names carry no arch (macOS `GeneCode.app.tar.gz` is produced
 * identically by the arm64 and x86_64 builds), which would collide when both
 * are uploaded to a GitHub Release. This renames:
 *
 *   GeneCode.app.tar.gz        -> GeneCode-0.1.0-aarch64.app.tar.gz   (+ .sig)
 *   GeneCode_0.1.0_x64-setup.nsis.zip -> GeneCode-0.1.0-x86_64.nsis.zip (+ .sig)
 *   GeneCode_0.1.0_amd64.AppImage.tar.gz -> GeneCode-0.1.0-x86_64.AppImage.tar.gz (+ .sig)
 *
 * The manifest generator (generate-updater-manifest.mjs) later maps these to
 * `{os}-{arch}` platform keys. The signature is over the artifact bytes, so
 * renaming the file does not invalidate it.
 *
 * Usage (run from molecular-design-studio):
 *   node scripts/rename-updater-artifacts.mjs <bundle-dir> \
 *     --version 0.1.0 --arch aarch64
 */

import { existsSync, readFileSync, renameSync, readdirSync } from "node:fs";
import { join } from "node:path";

function parseArgs(argv) {
  const args = { dirs: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === "--version") args.version = next();
    else if (arg === "--arch") args.arch = next();
    else if (arg === "--name") args.name = next();
    else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else args.dirs.push(arg);
  }
  return args;
}

function productName() {
  // mirror the script's default working dir: molecular-design-studio/
  const conf = join(process.cwd(), "src-tauri", "tauri.conf.json");
  if (existsSync(conf)) {
    try {
      return JSON.parse(readFileSync(conf, "utf8")).productName ?? "GeneCode";
    } catch {
      // fall through to the default
    }
  }
  return "GeneCode";
}

// default artifact extension -> target extension with the version+arch baked in
const KINDS = [".app.tar.gz", ".nsis.zip", ".AppImage.tar.gz"];

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.version) throw new Error("--version <semver> is required");
  if (!args.arch) throw new Error("--arch <aarch64|x86_64> is required");
  if (args.dirs.length === 0) throw new Error("at least one bundle directory is required");

  const name = args.name ?? productName();
  let renamed = 0;

  for (const dir of args.dirs) {
    if (!existsSync(dir)) {
      console.warn(`[warn] bundle dir not found, skipping: ${dir}`);
      continue;
    }
    for (const fileName of readdirSync(dir)) {
      for (const ext of KINDS) {
        if (!fileName.endsWith(ext)) continue;
        // every kind needs its .sig next to it (macOS/NSIS always have one when
        // createUpdaterArtifacts ran; skip the artifact if the sig is missing)
        const sigName = `${fileName}.sig`;
        if (!existsSync(join(dir, sigName))) {
          console.warn(`[warn] missing ${sigName} — skipping ${fileName}`);
          continue;
        }
        const target = `${name}-${args.version}-${args.arch}${ext}`;
        if (fileName === target) {
          console.log(`[ok] ${fileName} already has the final name`);
        } else {
          renameSync(join(dir, fileName), join(dir, target));
          renameSync(join(dir, sigName), join(dir, `${target}.sig`));
          console.log(`[ok] ${fileName} -> ${target} (+ .sig)`);
        }
        renamed += 1;
        break;
      }
    }
  }

  console.log(`[done] renamed ${renamed} updater artifact(s)`);
  if (renamed === 0) {
    console.warn("[warn] nothing renamed — are the artifacts signed (createUpdaterArtifacts)?");
  }
}

main();

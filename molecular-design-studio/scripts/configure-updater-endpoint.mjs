#!/usr/bin/env node
/**
 * Build a Tauri config overlay containing the release repository's updater
 * endpoint. The checked-in config intentionally points at the reserved
 * `.invalid` domain; release builds must opt in with an explicit repository.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const DISABLED_UPDATER_ENDPOINT =
  "https://updates.invalid/genecode/latest.json";

export function normalizeGithubRepository(value) {
  const repository = String(value ?? "").trim();
  if (!repository) {
    throw new Error(
      "GitHub repository is required (--repository <owner/repo> or GITHUB_REPOSITORY)",
    );
  }
  if (/^(?:owner|example)[-_ ]?\/?(?:repo|repository)$/i.test(repository)) {
    throw new Error(`Refusing placeholder repository: ${repository}`);
  }
  const parts = repository.split("/");
  if (parts.length !== 2) {
    throw new Error(`Repository must be exactly <owner>/<repo>: ${repository}`);
  }
  const [owner, repo] = parts;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner)) {
    throw new Error(`Invalid GitHub owner: ${owner}`);
  }
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(repo) || repo === "." || repo === "..") {
    throw new Error(`Invalid GitHub repository name: ${repo}`);
  }
  return `${owner}/${repo}`;
}

export function endpointForRepository(value) {
  const repository = normalizeGithubRepository(value);
  return `https://github.com/${repository}/releases/latest/download/latest.json`;
}

export function releaseConfigForRepository(value) {
  return {
    plugins: {
      updater: {
        endpoints: [endpointForRepository(value)],
      },
    },
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repository") args.repository = argv[++index];
    else if (arg === "--out") args.out = argv[++index];
    else throw new Error(`Unknown option: ${arg}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repository = args.repository ?? process.env.GITHUB_REPOSITORY;
  if (!args.out) throw new Error("--out <path> is required");

  const config = releaseConfigForRepository(repository);
  const out = resolve(args.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  console.log(`[ok] updater release overlay: ${config.plugins.updater.endpoints[0]}`);
  console.log(`[ok] wrote ${out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}

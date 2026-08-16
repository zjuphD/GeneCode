import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import rootConfig from "../../../vite.config.ts";

const ignoreCss = {
  name: "genecode-smoke-ignore-css",
  resolveId(source, importer) {
    if (source.endsWith(".css")) {
      return `\0genecode-css:${importer || "root"}:${source}`;
    }
    return null;
  },
  load(id) {
    if (id.startsWith("\0genecode-css:")) return "export default {};";
    return null;
  }
};

export default defineConfig(async configEnv => {
  const base = await rootConfig(configEnv);
  // The migration test imports useMeltingTemp only to exercise its storage
  // repair function. The published tg-use-local-storage-state ESM bundle has
  // extensionless internal imports that Node/Vitest cannot load in isolation;
  // the real browser build still resolves the package through Vite. Keep this
  // package-only smoke deterministic with a tiny hook shim and leave the
  // integration path covered by the production build/browser smoke.
  const localStorageStateSmokeShim = fileURLToPath(
    new URL("./tg-use-local-storage-state-smoke-shim.mjs", import.meta.url),
  );
  return {
    ...base,
    resolve: {
      ...base.resolve,
      alias: [
        ...(Array.isArray(base.resolve?.alias) ? base.resolve.alias : []),
        { find: "tg-use-local-storage-state", replacement: localStorageStateSmokeShim },
      ],
    },
    plugins: [...(base.plugins || []), ignoreCss],
    root: fileURLToPath(new URL("../../../", import.meta.url)),
    test: {
      ...base.test,
      environment: "jsdom",
      include: [
        "packages/genecode-ove/scripts/redux-smoke.test.mjs",
        "packages/genecode-ove/scripts/create-vector-editor-smoke.test.mjs",
        "packages/genecode-ove/scripts/react18-compatibility.runtime.smoke.test.mjs",
        "packages/genecode-ove/scripts/use-melting-temp-storage.test.mjs",
        "packages/genecode-ove/scripts/sequence-panel-pointer-capture.test.mjs",
        "packages/genecode-ove/scripts/isoschizomer-dialog.test.mjs",
        "packages/genecode-ove/scripts/editor-size-cache.test.mjs"
      ],
      server: {
        deps: {
          inline: ["@teselagen/ui"]
        }
      }
    }
  };
});

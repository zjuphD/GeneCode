import { defineConfig, transformWithEsbuild } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const host = process.env.TAURI_DEV_HOST;

const genecodeOveSource = /[\\/]packages[\\/]genecode-ove[\\/]src[\\/].*\.js$/;
const teselagenUiBundle = /[\\/]node_modules[\\/]@teselagen[\\/]ui[\\/]index\.es\.js$/;
const blueprintToasterCompat = fileURLToPath(
  new URL("./src/vendor/blueprintToasterCompat.ts", import.meta.url),
);

export default defineConfig(async () => ({
  plugins: [
    {
      name: "genecode-ove-jsx-source",
      enforce: "pre",
      transform(code, id) {
        const cleanId = id.split("?", 1)[0] ?? id;
        if (!genecodeOveSource.test(cleanId)) return null;
        return transformWithEsbuild(code, cleanId, {
          loader: "jsx",
          jsx: "automatic",
        });
      },
    },
    {
      // @teselagen/ui@0.10.20 eagerly calls Blueprint v3 Toaster.create()
      // twice at module evaluation. Blueprint's implementation uses the
      // React 17 ReactDOM.render API. Replace only those two documented call
      // sites with our React 18 imperative adapter; fail the build if the
      // upstream bundle changes so this never becomes a silent text patch.
      name: "genecode-teselagen-ui-react18-toaster",
      enforce: "pre",
      transform(code, id) {
        const cleanId = id.split("?", 1)[0] ?? id;
        if (!teselagenUiBundle.test(cleanId)) return null;
        const legacyCalls = code.match(/Toaster\.create\(/g)?.length ?? 0;
        if (legacyCalls !== 2) {
          throw new Error(
            `Expected two @teselagen/ui Toaster.create calls, found ${legacyCalls}`,
          );
        }
        return {
          code: [
            `import { createReact18BlueprintToaster as __genecodeCreateToaster } from ${JSON.stringify(blueprintToasterCompat)};`,
            code.replaceAll(
              "Toaster.create(",
              "__genecodeCreateToaster(Toaster, ",
            ),
          ].join("\n"),
          map: null,
        };
      },
    },
    react(),
  ],
  resolve: {
    alias: [
      // Subpath imports into the vendored fork (e.g. the engine smoke test's
      // pure-module imports) must be matched BEFORE the bare package alias
      // (plain-string entries are prefix-matched in order, so the bare alias
      // would swallow "@teselagen/ove/src/..." and resolve to index.js).
      {
        find: /^@teselagen\/ove\/src\//,
        replacement: fileURLToPath(new URL("./packages/genecode-ove/src/", import.meta.url)),
      },
      {
        find: /^@teselagen\/ove$/,
        replacement: fileURLToPath(new URL("./packages/genecode-ove/src/index.js", import.meta.url)),
      },
      {
        find: "@hypnosphi/create-react-context",
        replacement: fileURLToPath(new URL("./src/vendor/createReactContext.ts", import.meta.url)),
      },
      {
        find: "is-mobile",
        replacement: fileURLToPath(new URL("./src/vendor/isMobile.ts", import.meta.url)),
      },
    ],
  },
  // A-PERF-001: split the single 4MB chunk into stable, cacheable groups.
  //
  // manualChunks is a FUNCTION (not the object/string-array form): the string
  // form silently failed to match react/react-dom in this tree (an empty
  // `react` chunk was emitted), which let Rollup fold the react-dom CJS
  // interop + __vitePreload helper into the engine chunk and forced the entry
  // to statically import the engine just to reach ReactDOM — defeating the
  // lazy OveEditorHost/AgentPanel split. The function form is explicit and
  // order-independent: entry-graph-only modules return undefined and Rollup
  // keeps them in the index chunk.
  //
  // The engine itself (packages/genecode-ove) is intentionally NOT listed here:
  // it is the only consumer of the dynamic import() boundary created by
  // `lazy(() => import("./OveEditorHost"))`, so Rollup already groups the whole
  // engine + host into one on-demand chunk — an explicit "engine" rule would be
  // dead code (this function only sees /node_modules/ ids).
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const clean = id.split("?", 1)[0] ?? id;
          if (!clean.includes("/node_modules/")) return undefined;
          if (clean.includes("@teselagen/bio-parsers")) return "parsers";
          if (clean.includes("@blueprintjs")) return "blueprint";
          if (clean.includes("/react-dom/") || /\/react\/(cjs\/)?/.test(clean)) {
            return "react";
          }
          return undefined;
        },
      },
    },
  },
  assetsInclude: ["**/*.dna"],
  optimizeDeps: {
    include: [
      "@blueprintjs/core",
      "@blueprintjs/datetime",
      "@blueprintjs/select",
      "@hypnosphi/create-react-context",
      "deep-equal",
    ],
    // Keep @teselagen/ui out of esbuild pre-bundling so the React 18 toaster
    // compatibility transform above runs in both dev and production builds.
    exclude: ["@teselagen/ove", "@teselagen/ui"],
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
    // A-API-001 dev flow: the Python sidecar binds 127.0.0.1:8000; some
    // webview/sandbox environments block cross-origin fetches to it, so
    // proxy /api through the Vite origin. The desktop Tauri build talks to
    // the sidecar directly (token injected via IPC) and is unaffected.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
}));

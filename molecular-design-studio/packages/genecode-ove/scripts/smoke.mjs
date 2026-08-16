import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const read = relativePath => readFile(join(packageRoot, relativePath), "utf8");
const packageJson = JSON.parse(await read("package.json"));
const createVectorEditorSource = await read("src/createVectorEditor/index.js");
const makeStoreSource = await read("src/createVectorEditor/makeStore.js");
const editorSource = await read("src/Editor/index.js");
const editorTypes = await read("Editor/index.d.ts");
const createVectorEditorTypes = await read("createVectorEditor/index.d.ts");
const notice = await read("NOTICE");

const checks = [
  [packageJson.name === "@genecode/ove", "fork package name"],
  [packageJson.version === "0.8.42-genecode.0", "fork version"],
  [
    createVectorEditorSource.includes('from "react-dom/client"'),
    "React 18 client root import"
  ],
  [
    !createVectorEditorSource.includes("unmountComponentAtNode"),
    "legacy root unmount removed from entry point"
  ],
  [
    !createVectorEditorSource.includes("legacyStore") &&
      !createVectorEditorSource.includes("getLegacyStore"),
    "implicit module-level store removed"
  ],
  [
    createVectorEditorSource.includes("editor.close") &&
      createVectorEditorSource.includes("closed"),
    "idempotent close contract"
  ],
  [
    createVectorEditorSource.includes("claimStoreIdentity") &&
      createVectorEditorSource.includes("storeKey"),
    "store identity conflict strategy"
  ],
  [
    createVectorEditorSource.includes("React.StrictMode") &&
      createVectorEditorSource.includes("strictMode"),
    "StrictMode-compatible mount path"
  ],
  [createVectorEditorSource.includes("getStore"), "editor store accessor"],
  [createVectorEditorSource.includes("storeFactory"), "custom store factory"],
  [makeStoreSource.includes("export { makeStore }"), "named makeStore export"],
  [editorSource.includes("panelComponents"), "panel component injection"],
  [editorSource.includes("getPanelMap"), "panel map resolver"],
  [
    editorSource.indexOf("...(this.props.panelComponents || {})") <
      editorSource.indexOf("...(this.props.panelMap || {})"),
    "legacy panelMap precedence contract"
  ],
  [editorSource.includes("export const defaultPanelMap"), "default panel registry"],
  [editorTypes.includes("defaultPanelMap"), "panel registry types"],
  [createVectorEditorTypes.includes("storeFactory"), "store factory types"],
  [notice.includes("@teselagen/ove"), "upstream provenance notice"],
  [notice.includes("MIT License"), "license notice"]
];

const failed = checks.filter(([passed]) => !passed);
if (failed.length > 0) {
  throw new Error(`Genecode OVE smoke check failed: ${failed.map(([, label]) => label).join(", ")}`);
}

console.log(`Genecode OVE smoke check passed (${checks.length} checks)`);

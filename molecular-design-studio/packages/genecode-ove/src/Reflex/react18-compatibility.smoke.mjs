import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const reflexRoot = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(dirname(reflexRoot));

const read = relativePath => readFile(join(packageRoot, relativePath), "utf8");

const files = {
  popup: await read("src/withEditorInteractions/createSequenceInputPopup.js"),
  print: await read("src/helperComponents/PrintDialog/index.js"),
  container: await read("src/Reflex/ReflexContainer.js"),
  splitter: await read("src/Reflex/ReflexSplitter.js"),
  element: await read("src/Reflex/ReflexElement.js")
};

const legacyApi =
  /ReactDOM\.(?:render|unmountComponentAtNode|findDOMNode)|\b(?:unmountComponentAtNode|findDOMNode)\b/;
const failed = [];

for (const [name, source] of Object.entries(files)) {
  if (legacyApi.test(source)) failed.push(`${name}: legacy ReactDOM API`);
}

const checks = [
  [files.popup.includes('from "react-dom/client"'), "popup uses client root"],
  [files.popup.includes("createRoot(div)"), "popup creates a root"],
  [files.popup.includes("popupRoot.render(innerEl)"), "popup renders through root"],
  [files.popup.includes("root && root.unmount()"), "popup unmounts through root"],
  [files.print.includes("getDomNode"), "print content exposes a DOM getter"],
  [files.print.includes("contentRef"), "print content uses a ref"],
  [files.container.includes("this.containerRef.current"), "container uses a DOM ref"],
  [files.splitter.includes("this.domRef.current"), "splitter uses a DOM ref"],
  [files.element.includes("measureRef(node)"), "element keeps measure ref wiring"]
];

for (const [passed, label] of checks) {
  if (!passed) failed.push(label);
}

if (failed.length) {
  throw new Error(`React 18 compatibility smoke failed: ${failed.join(", ")}`);
}

console.log(`React 18 compatibility smoke passed (${checks.length + Object.keys(files).length} checks)`);

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.window.requestAnimationFrame = callback =>
  setTimeout(() => callback(Date.now()), 0);
globalThis.window.cancelAnimationFrame = handle => clearTimeout(handle);
Object.defineProperties(dom.window.HTMLElement.prototype, {
  offsetWidth: { configurable: true, get: () => 800 },
  offsetHeight: { configurable: true, get: () => 600 }
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: dom.window.navigator
});

const React = await import("react");
const ReactDOMClient = await import("react-dom/client");
const { default: ReflexContainer } = await import("./ReflexContainer.js");
const { default: ReflexElement } = await import("./ReflexElement.js");
const { default: ReflexSplitter } = await import("./ReflexSplitter.js");

const node = document.createElement("div");
document.body.appendChild(node);
const root = ReactDOMClient.createRoot(node);
const legacyWarnings = [];
const originalError = console.error;
console.error = (...args) => {
  const message = args.join(" ");
  if (
    /findDOMNode|ReactDOM\.render|unmountComponentAtNode/.test(message)
  ) {
    legacyWarnings.push(message);
    originalError(...args);
  }
};

try {
  root.render(
    React.default.createElement(
      ReflexContainer,
      { orientation: "vertical" },
      React.default.createElement(
        ReflexElement,
        { flex: 0.5 },
        React.default.createElement("div", null, "left")
      ),
      React.default.createElement(ReflexSplitter),
      React.default.createElement(
        ReflexElement,
        { flex: 0.5 },
        React.default.createElement("div", null, "right")
      )
    )
  );
  await new Promise(resolve => setTimeout(resolve, 20));
} finally {
  console.error = originalError;
  root.unmount();
}

if (legacyWarnings.length) {
  throw new Error(
    `React 18 runtime smoke found legacy warnings: ${legacyWarnings.join(" | ")}`
  );
}

console.log("React 18 runtime smoke passed (0 legacy ReactDOM warnings)");

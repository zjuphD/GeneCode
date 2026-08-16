// Smoke tests for the IsoschizomerCutsitesDialog body (merged cut-site
// labels). A SnapGene-style merged label ("VpaKutJI +4") carries
// isoschizomerNames on its annotation; double-clicking opens this dialog,
// which must list every enzyme at that cut position with its recognition
// site, dedupe repeats, sort alphabetically, and degrade gracefully for a
// single enzyme.
import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The full @teselagen/ui / withEditorProps HOC stack can't be loaded by this
// smoke config, so test the dependency-light Body component directly.
const { default: IsoschizomerCutsitesBody } = await import(
  "../src/CutsiteFilter/IsoschizomerCutsitesBody.js"
);

function makeProps(overrides = {}) {
  return {
    enzymeNames: ["VpaKutJI", "VpaK11BI", "VchO66I"],
    allRestrictionEnzymes: {
      vpakutji: { name: "VpaKutJI", site: "ggncc" },
      vpak11bi: { name: "VpaK11BI", site: "ggncc" },
      vcho66i: { name: "VchO66I", site: "ggncc" },
      ecori: { name: "EcoRI", site: "gaattc" }
    },
    ...overrides
  };
}

async function renderBody(props) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(IsoschizomerCutsitesBody, props));
  });
  return {
    container,
    cleanup: async () => {
      await act(async () => root.unmount());
      container.remove();
    }
  };
}

describe("IsoschizomerCutsitesBody", () => {
  it("renders every isoschizomer enzyme at the position", async () => {
    const { container, cleanup } = await renderBody(makeProps());
    const text = container.textContent;
    expect(text).toContain("VpaKutJI");
    expect(text).toContain("VpaK11BI");
    expect(text).toContain("VchO66I");
    // enzymes not at this position stay out
    expect(text).not.toContain("EcoRI");
    await cleanup();
  });

  it("shows the recognition site next to each enzyme", async () => {
    const { container, cleanup } = await renderBody(makeProps());
    const tags = [...container.querySelectorAll(".bp3-tag")];
    expect(tags.map(tag => tag.textContent).join(" ")).toContain("(ggncc)");
    await cleanup();
  });

  it("sorts enzyme names alphabetically and dedupes repeats", async () => {
    const props = makeProps({
      enzymeNames: ["VchO66I", "VpaKutJI", "VpaK11BI", "VpaKutJI"]
    });
    const { container, cleanup } = await renderBody(props);
    const tags = [...container.querySelectorAll(".bp3-tag")];
    const names = tags.map(tag => tag.textContent.trim());
    expect(names).toEqual([
      "VchO66I (ggncc)",
      "VpaK11BI (ggncc)",
      "VpaKutJI (ggncc)"
    ]);
    await cleanup();
  });

  it("handles a single-enzyme label without crashing", async () => {
    const { container, cleanup } = await renderBody(
      makeProps({ enzymeNames: ["EcoRI"] })
    );
    const text = container.textContent;
    expect(text).toContain("EcoRI");
    expect(text).not.toContain("VpaKutJI");
    await cleanup();
  });

  it("renders an enzyme with no known site data gracefully", async () => {
    const { container, cleanup } = await renderBody(
      makeProps({ enzymeNames: ["MysteryI"] })
    );
    const tags = [...container.querySelectorAll(".bp3-tag")];
    expect(tags).toHaveLength(1);
    expect(tags[0].textContent.trim()).toBe("MysteryI");
    await cleanup();
  });
});

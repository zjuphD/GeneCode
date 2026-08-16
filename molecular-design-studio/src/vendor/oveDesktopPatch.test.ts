import { describe, expect, it } from "vitest";
import { patchOveDesktopPanels } from "./oveDesktopPatch";

const bundledPanelCode = `
    __publicField(this, "getPanelsToShow", () => {
      const { panelsShown: panelsShown2 } = this.props;
      if (isMobile()) return [flatMap(panelsShown2)];
      return map$3(panelsShown2);
    });
    inner2 = React.createElement(
      "text",
      spread({
          x: 0 + fudge / 2,
          textLength: tlToUse
        })),
      sequence,
    );
`;

describe("patchOveDesktopPanels", () => {
  it("keeps OVE panel groups separate in the published ES module", () => {
    const patched = patchOveDesktopPanels(
      bundledPanelCode,
      "/project/node_modules/@teselagen/ove/index.es.js",
    );

    expect(patched).toContain("return map$3(panelsShown2);");
    expect(patched).not.toContain("flatMap(panelsShown2)");
    expect(patched).toContain('lengthAdjust: "spacingAndGlyphs"');
  });

  it("ignores unrelated modules", () => {
    expect(patchOveDesktopPanels(bundledPanelCode, "/project/src/App.tsx")).toBeNull();
  });

  it("fails loudly when the installed OVE bundle changes", () => {
    expect(() =>
      patchOveDesktopPanels(
        "export const version = 'next';",
        "/project/node_modules/@teselagen/ove/index.es.js",
      ),
    ).toThrow("no longer matches");
  });
});

const OVE_ES_MODULE = "/@teselagen/ove/index.es.js";
const MOBILE_PANEL_BRANCH =
  "if (isMobile()) return [flatMap(panelsShown2)];\n      return map$3(panelsShown2);";
const DESKTOP_PANEL_BRANCH = "return map$3(panelsShown2);";
const SEQUENCE_TEXT_BRANCH =
  "x: 0 + fudge / 2,\n          textLength: tlToUse\n        }))";
const WEBKIT_SEQUENCE_TEXT_BRANCH =
  "x: 0 + fudge / 2,\n          textLength: tlToUse,\n          lengthAdjust: \"spacingAndGlyphs\"\n        }))";

/**
 * OVE 0.8.42 bundles `is-mobile` inside its published ES module. WKWebView's
 * user agent includes a Mobile token, which makes OVE flatten split panels.
 * Its unscrolled DNA text also omits an explicit SVG `lengthAdjust`, so
 * WKWebView compresses the bases at the left edge instead of filling the row.
 */
export function patchOveDesktopPanels(code: string, id: string): string | null {
  const normalizedId = id.replaceAll("\\", "/").split("?")[0] ?? "";
  if (!normalizedId.endsWith(OVE_ES_MODULE)) return null;
  if (!code.includes(MOBILE_PANEL_BRANCH) || !code.includes(SEQUENCE_TEXT_BRANCH)) {
    throw new Error("OVE desktop panel patch no longer matches the installed package");
  }
  return code
    .replace(MOBILE_PANEL_BRANCH, DESKTOP_PANEL_BRANCH)
    .replace(SEQUENCE_TEXT_BRANCH, WEBKIT_SEQUENCE_TEXT_BRANCH);
}

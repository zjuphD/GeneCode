import { afterEach, describe, expect, it } from "vitest";
import isMobile from "./isMobile";

afterEach(() => {
  delete (window as typeof window & { __TAURI_INTERNALS__?: unknown })
    .__TAURI_INTERNALS__;
});

describe("isMobile desktop override", () => {
  it("does not collapse split panes in a Tauri desktop webview", () => {
    (window as typeof window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__ = {};

    expect(isMobile({
      ua: "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Mobile/15E148",
    })).toBe(false);
  });

  it("still recognizes a real mobile browser", () => {
    expect(isMobile({
      ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Mobile/15E148",
    })).toBe(true);
  });
});

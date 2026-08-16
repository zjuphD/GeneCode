/**
 * Platform-aware keyboard shortcut helpers for document toolbar and editor.
 */

const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform ?? "");

const MOD_KEY = IS_MAC ? "\u2318" : "Ctrl";

/**
 * Returns true when the modifier key matches the given platform:
 * macOS → Command only; other platforms → Ctrl only.
 *
 * Accepts an explicit platform string so callers can pass
 * `navigator.platform` and tests can inject a deterministic value.
 */
function isMod(
  platform: string,
  e: { metaKey: boolean; ctrlKey: boolean },
): boolean {
  const isMac = /Mac|iPod|iPhone|iPad/.test(platform);
  return isMac ? e.metaKey : e.ctrlKey;
}

export { IS_MAC, MOD_KEY, isMod };

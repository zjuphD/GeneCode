export type ThemePref = "light" | "dark" | "glass" | "system";
export type ResolvedTheme = "light" | "dark" | "glass";

const KEY = "genecode.theme.pref";
const listeners = new Set<() => void>();
interface SystemThemeMediaQuery {
  matches: boolean;
  addEventListener: (type: string, listener: (event: MediaQueryListEvent) => void) => void;
}

const systemDark: SystemThemeMediaQuery =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : {
        matches: false,
        addEventListener: () => undefined,
      };

const isTauri = (): boolean => "__TAURI_INTERNALS__" in window;

/** Ask the Rust side to toggle macOS window vibrancy. Safe no-op in the
 *  browser preview and on targets without a native equivalent. */
async function syncWindowGlass(enabled: boolean): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_glass", { enabled });
  } catch {
    // window effect is cosmetic — never let it break theme switching
  }
}

export function getThemePref(): ThemePref {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === "light" || raw === "dark" || raw === "glass" || raw === "system") {
      return raw;
    }
  } catch {
    // storage unavailable — fall through to system
  }
  return "system";
}

export function resolveTheme(pref: ThemePref): ResolvedTheme {
  if (pref === "system") return systemDark.matches ? "dark" : "light";
  return pref;
}

/** Stamp the resolved theme on <html> so CSS tokens and the MUI theme agree,
 *  and keep the native window material in step with the glass preference. */
function apply(): ResolvedTheme {
  const resolved = resolveTheme(getThemePref());
  document.documentElement.dataset.theme = resolved;
  void syncWindowGlass(resolved === "glass");
  return resolved;
}

export function setThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    // keep the in-memory choice even when storage is unavailable
  }
  apply();
  emit();
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

systemDark.addEventListener("change", () => {
  if (getThemePref() === "system") {
    apply();
    emit();
  }
});

// Resolve before first paint so the shell never flashes the wrong theme.
apply();

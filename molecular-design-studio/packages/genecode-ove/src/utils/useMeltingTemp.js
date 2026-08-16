import tgUseLocalStorageState from "tg-use-local-storage-state";

const MELTING_TEMP_STORAGE_KEY = "showMeltingTemp";

/**
 * Old OVE builds sometimes left an empty/raw value under this key. The
 * storage hook expects JSON and logs a parse warning on every editor mount.
 * Remove only malformed/non-boolean values; valid user preferences survive.
 */
export const repairStoredMeltingTempPreference = (
  storage = typeof window === "undefined" ? null : window.localStorage
) => {
  if (!storage) return false;
  try {
    const raw = storage.getItem(MELTING_TEMP_STORAGE_KEY);
    if (raw === null) return false;
    const parsed = JSON.parse(raw);
    if (typeof parsed === "boolean") return false;
    storage.removeItem(MELTING_TEMP_STORAGE_KEY);
    return true;
  } catch {
    try {
      storage.removeItem(MELTING_TEMP_STORAGE_KEY);
    } catch {
      // Storage can be unavailable in hardened/private webviews. The hook's
      // own fallback remains responsible for that environment.
    }
    return true;
  }
};

const useMeltingTemp = () => {
  repairStoredMeltingTempPreference();
  return tgUseLocalStorageState(MELTING_TEMP_STORAGE_KEY, {
    defaultValue: false
  });
};

export default useMeltingTemp;

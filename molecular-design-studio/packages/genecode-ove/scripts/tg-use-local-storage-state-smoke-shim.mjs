import { useState } from "react";

/**
 * Test-only replacement for the published hook. The smoke suite targets the
 * malformed-value migration helper, not the third-party hook implementation;
 * the real hook remains exercised by the Vite production/browser build.
 */
export default function useLocalStorageState(_key, options = {}) {
  const [value, setValue] = useState(options.defaultValue);
  return [
    value,
    setValue,
    { isPersistent: true, removeItem: () => setValue(options.defaultValue) },
  ];
}

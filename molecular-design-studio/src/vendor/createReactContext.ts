import React from "react";

/**
 * ESM-compatible replacement for the legacy CommonJS context polyfill used
 * by OVE's react-popper dependency. React 18 already provides the API.
 */
export default function createReactContext<T = unknown>(defaultValue?: T) {
  return React.createContext(defaultValue as T);
}

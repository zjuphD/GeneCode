/* eslint-disable react-refresh/only-export-components -- entry mounts the themed shell; nothing to export */
import React from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider } from "@mui/material";
import App from "./App";
import "./App.css";
import "./ui/workbench.css";
import { geneCodeTheme, geneCodeThemeDark } from "./ui/theme";
import { subscribeTheme } from "./ui/themePreference";

function ThemedShell() {
  // themePreference stamps <html data-theme> and re-broadcasts on changes
  // (including system flips while on "system"), so re-render on any event.
  const [, forceUpdate] = React.useReducer((count: number) => count + 1, 0);
  React.useEffect(() => subscribeTheme(forceUpdate), []);
  // "glass" rides the light MUI palette — its character comes from CSS
  // materials, not from retheming components.
  const useDark = document.documentElement.dataset.theme === "dark";
  return (
    <ThemeProvider theme={useDark ? geneCodeThemeDark : geneCodeTheme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemedShell />
  </React.StrictMode>,
);

import { alpha, createTheme } from "@mui/material/styles";

/**
 * Application-shell theme. The OVE canvas remains visually isolated because
 * it owns a large legacy Blueprint surface; MUI is for GeneCode-owned chrome
 * and overlays, where its accessible primitives add value without leaking
 * styles into sequence rendering.
 *
 * Colors mirror the canonical tokens in ui/workbench.css (:root / [data-theme="dark"])
 * so MUI surfaces and hand-written chrome read as one system in both themes.
 * Radii use the shared 6px card scale; typography uses the system stack
 * App.css actually renders.
 */
function createGeneCodeTheme(mode: "light" | "dark") {
  const dark = mode === "dark";
  const ink = dark ? "#eceeeb" : "#292c2b";
  const accent = dark ? "#87c7ad" : "#217366";

  return createTheme({
    palette: {
      mode,
      primary: {
        main: accent,
        dark: dark ? "#aadcc5" : "#17584d",
        light: dark ? "#253e32" : "#eaf4ef",
        contrastText: dark ? "#0f141a" : "#ffffff",
      },
      secondary: {
        main: dark ? "#9fb0bf" : "#4e5b68",
        light: dark ? "#232b35" : "#eef1f4",
        dark: dark ? "#c3d0db" : "#3a4750",
      },
      success: { main: dark ? "#55b377" : "#277a4d" },
      warning: { main: dark ? "#d9a441" : "#9a6114" },
      error: { main: dark ? "#e07b7b" : "#b64343" },
      background: {
        default: dark ? "#191b1a" : "#f5f5f3",
        paper: dark ? "#242724" : "#ffffff",
      },
      text: { primary: ink, secondary: dark ? "#bbc0b8" : "#5b605c" },
      divider: dark ? "#363a36" : "#e6e8e5",
    },
    shape: { borderRadius: 6 },
    typography: {
      fontFamily: [
        "-apple-system",
        "BlinkMacSystemFont",
        "Segoe UI",
        "Roboto",
        "Helvetica Neue",
        "sans-serif",
      ].join(","),
      button: { fontWeight: 650, letterSpacing: 0, textTransform: "none" },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          "::selection": { backgroundColor: alpha(accent, 0.22) },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: { root: { minHeight: 34, borderRadius: 6 } },
      },
      MuiIconButton: { styleOverrides: { root: { borderRadius: 6 } } },
      MuiChip: {
        styleOverrides: { root: { borderRadius: 6, fontSize: "0.72rem", fontWeight: 650 } },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            backgroundColor: dark ? "#0d1115" : "#18232d",
            borderRadius: 6,
            fontSize: "0.72rem",
            padding: "7px 9px",
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: { borderLeft: dark ? "1px solid #28313c" : "1px solid #e5e9ee" },
        },
      },
    },
  });
}

export const geneCodeTheme = createGeneCodeTheme("light");
export const geneCodeThemeDark = createGeneCodeTheme("dark");

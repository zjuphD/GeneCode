import { alpha, createTheme } from "@mui/material/styles";

/**
 * Application-shell theme. The OVE canvas remains visually isolated because
 * it owns a large legacy Blueprint surface; MUI is for GeneCode-owned chrome
 * and overlays, where its accessible primitives add value without leaking
 * styles into sequence rendering.
 */
const ink = "#18243b";
const primary = "#5b5ce2";

export const geneCodeTheme = createTheme({
  palette: {
    mode: "light",
    primary: { main: primary, dark: "#4849c7", light: "#eef0ff", contrastText: "#ffffff" },
    secondary: { main: "#8a6ce2", light: "#f3edff", dark: "#6e4ec5" },
    success: { main: "#15803d" },
    warning: { main: "#b45309" },
    error: { main: "#b91c1c" },
    background: { default: "#f3f6fb", paper: "#ffffff" },
    text: { primary: ink, secondary: "#66748a" },
    divider: "#e2e8f2",
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: ["Inter", "ui-sans-serif", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"].join(","),
    button: { fontWeight: 650, letterSpacing: 0, textTransform: "none" },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        "::selection": { backgroundColor: alpha(primary, 0.2) },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { minHeight: 34, borderRadius: 10 } },
    },
    MuiIconButton: { styleOverrides: { root: { borderRadius: 10 } } },
    MuiChip: {
      styleOverrides: { root: { borderRadius: 9, fontSize: "0.72rem", fontWeight: 650 } },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: { backgroundColor: "#18243b", borderRadius: 9, fontSize: "0.72rem", padding: "7px 9px" },
      },
    },
    MuiDrawer: { styleOverrides: { paper: { borderLeft: "1px solid #dbe3ee" } } },
  },
});

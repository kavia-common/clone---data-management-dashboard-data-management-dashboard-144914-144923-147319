//
// PUBLIC_INTERFACE
// Dark theme token definition and applicator for the dashboard UI.
//
/**
 * Returns the dark theme tokens based on the design spec.
 * These values are mirrored as CSS variables under :root[data-theme="dark"] in CSS.
 */
export const darkThemeTokens = {
  background: "#1E1A18",
  surface: "#2B2723",
  sidebar: "#1B1816",
  text: {
    primary: "#EAEAEA",
    secondary: "#B0A8A0",
  },
  accent: "#FF6600",
  border: "#3C3532",
  hoverBg: "#3A3330",
};

/**
 * PUBLIC_INTERFACE
 * applyDarkTheme
 * Applies the dark theme by setting data-theme="dark" on the documentElement.
 */
export function applyDarkTheme() {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", "dark");
  }
  return darkThemeTokens;
}

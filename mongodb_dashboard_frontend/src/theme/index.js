import { applyDarkTheme, darkThemeTokens } from "./darkTheme";
export { applyDarkTheme, darkThemeTokens };

/**
 * PUBLIC_INTERFACE
 * setTheme
 * Sets the current theme by name. Currently supports "dark" only.
 * Returns the applied token set for optional use by components that need inline styles.
 */
export function setTheme(themeName = "dark") {
  switch (themeName) {
    case "dark":
    default: {
      return applyDarkTheme();
    }
  }
}

/**
 * PUBLIC_INTERFACE
 * getCurrentTheme
 * Reads the theme flag from the documentElement.
 */
export function getCurrentTheme() {
  if (typeof document !== "undefined") {
    return document.documentElement.getAttribute("data-theme") || "dark";
  }
  return "dark";
}

/** PUBLIC_INTERFACE
 * getCurrentTheme
 * Returns the current theme configuration; shimmed to Ocean Professional.
 * Consumers should call this to get tokens rather than importing specific files.
 */
export function getCurrentTheme() {
  const theme = require('./oceanTheme').default;
  return typeof theme === 'function' ? theme() : theme || {};
}

// PUBLIC_INTERFACE
// Re-export hook-like theme for compatibility with components that expect a default export function.
export { default as oceanTheme } from './oceanTheme';
export { default } from './oceanTheme';

/**
 * PUBLIC_INTERFACE
 * setTheme
 * Applies the requested theme at the document level.
 * Supports:
 *  - "dark": sets data-theme="dark" and returns darkThemeTokens
 *  - any other value: removes data-theme attribute (default/ocean) and returns current theme tokens
 */
export function setTheme(name) {
  if (typeof document !== 'undefined') {
    if (String(name).toLowerCase() === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      // Lazily import to avoid circular/static graph surprises
      const mod = require('./darkTheme');
      return mod.darkThemeTokens;
    }
    document.documentElement.removeAttribute('data-theme');
  }
  return getCurrentTheme();
}

// PUBLIC_INTERFACE
// Re-export dark theme tokens and applier so callers can import from '../../theme'
export { darkThemeTokens, applyDarkTheme } from './darkTheme';

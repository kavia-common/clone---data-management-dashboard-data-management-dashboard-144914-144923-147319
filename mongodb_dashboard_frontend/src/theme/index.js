export { default as oceanTheme } from './oceanTheme';

// PUBLIC_INTERFACE
export function getCurrentTheme() {
  /** Returns the current theme configuration; shimmed to Ocean Professional. */
  const theme = require('./oceanTheme').default;
  return typeof theme === 'function' ? theme() : theme || {};
}

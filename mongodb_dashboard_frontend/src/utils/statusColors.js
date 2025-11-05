//
// PUBLIC_INTERFACE
// statusColors - Shared deterministic color utilities for mapping categories/statuses to colors.
// Ensures consistent, high-contrast colors suitable for dark backgrounds across charts.
//
// Usage:
//   import getOceanColors from "../theme/colors";
//   import { getStatusColor, colorFromString } from "./statusColors";
//   const oc = getOceanColors();
//   const fill = getStatusColor("success", oc); // uses theme-success color
//   const other = colorFromString("custom-type"); // deterministic pastel HSL from string
//

/**
 * PUBLIC_INTERFACE
 * colorFromString
 * Deterministically generate a pastel-ish HSL color from an input string.
 * Produces distinct hues for different strings while keeping saturation/lightness
 * appropriate for dark backgrounds.
 *
 * @param {string} key
 * @param {{saturation?: number, lightness?: number}} [options]
 * @returns {string} hsl() color string
 */
export function colorFromString(key, { saturation = 55, lightness = 55 } = {}) {
  const str = String(key || "");
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    // simple 32-bit hash
    // eslint-disable-next-line no-bitwise
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
    // eslint-disable-next-line no-bitwise
    hash |= 0;
  }
  // eslint-disable-next-line no-bitwise
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

/**
 * PUBLIC_INTERFACE
 * getStatusColor
 * Map a known status/category to a themed color; otherwise fall back to a deterministic color.
 * This aligns with "Ocean Professional" palette for known states on dark backgrounds.
 *
 * Known mappings:
 *  - Processing/In-Progress: primary (blue)
 *  - Success/Completed: success/secondary (amber)
 *  - Failed/Error: error (red)
 *  - Unknown: softened amber
 *
 * @param {string} status
 * @param {{primary:string, success?:string, secondary?:string, error:string}} oc Theme tokens
 * @returns {string} CSS color string
 */
export function getStatusColor(status, oc) {
  const s = String(status || "").toLowerCase().trim();
  if (["processing", "in_progress", "in-progress", "pending", "queued"].includes(s)) {
    return oc.primary;
  }
  if (["success", "succeeded", "ok", "completed", "complete", "done"].includes(s)) {
    return oc.success || oc.secondary;
  }
  if (["failed", "error", "failure"].includes(s)) {
    return oc.error;
  }
  if (s === "unknown" || s === "" || s === "null" || s === "undefined") {
    // mildly toned secondary for unknowns
    return "rgba(245, 158, 11, 0.6)"; // soft amber
  }
  return colorFromString(s);
}

export default getStatusColor;

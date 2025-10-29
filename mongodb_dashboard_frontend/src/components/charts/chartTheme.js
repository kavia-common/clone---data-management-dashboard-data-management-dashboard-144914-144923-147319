//
// PUBLIC_INTERFACE
// getChartTheme
// Dark-mode aware chart color tokens sourced from CSS variables with fallbacks to theme tokens.
//
import { darkThemeTokens } from "../../theme/darkTheme";

/**
 * Read a CSS variable from :root. If unavailable, return fallback.
 * @param {string} name CSS variable name (e.g., --chart-primary)
 * @param {string} fallback hex/rgba fallback
 * @returns {string}
 */
function getCssVar(name, fallback) {
  try {
    if (typeof window !== "undefined") {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name);
      if (v && String(v).trim()) return String(v).trim();
    }
  } catch {
    // ignore
  }
  return fallback;
}

/**
 * Convert hex color to rgba string with alpha.
 * Accepts #RGB or #RRGGBB; falls back to fallbackColor on parse failure.
 * @param {string} hex
 * @param {number} alpha 0..1
 * @param {string} [fallbackColor]
 * @returns {string}
 */
export function withAlpha(hex, alpha, fallbackColor = "rgba(255,102,0,0.4)") {
  try {
    const raw = String(hex || "").replace("#", "");
    const hx = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
    const n = parseInt(hx, 16);
    /* eslint-disable no-bitwise */
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    /* eslint-enable no-bitwise */
    const a = Math.max(0, Math.min(1, Number(alpha) || 0));
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  } catch {
    return fallbackColor;
  }
}

// PUBLIC_INTERFACE
export function getChartTheme() {
  // Pull from CSS variables first; fall back to dark theme tokens
  const accent = getCssVar("--chart-primary", darkThemeTokens.accent || "#FF6600");
  const grid = getCssVar("--chart-grid", "rgba(234,234,234,0.12)");
  const axis = getCssVar("--chart-axis", "rgba(234,234,234,0.6)");
  const tooltipBg = getCssVar("--chart-tooltip-bg", "#1E1A18");
  const tooltipBorder = getCssVar("--chart-tooltip-border", "#3C3532");
  const tooltipText = getCssVar("--color-text-primary", darkThemeTokens.text?.primary || "#EAEAEA");
  const legendText = getCssVar("--color-text-secondary", darkThemeTokens.text?.secondary || "#B0A8A0");

  // Slight variants for hover/active
  const primaryHover = getCssVar("--chart-primary-hover", "#ff7a1a");
  const primaryActive = getCssVar("--chart-primary-active", "#e65c00");

  return {
    primary: accent,
    primaryHover,
    primaryActive,
    grid,
    axisTick: axis,
    label: axis,
    tooltip: {
      bg: tooltipBg,
      border: tooltipBorder,
      text: tooltipText,
    },
    legend: {
      text: legendText,
    },
  };
}

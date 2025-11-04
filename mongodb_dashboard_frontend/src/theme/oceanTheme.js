/**
 * PUBLIC_INTERFACE
 * getOceanTheme (JS)
 * Returns the Ocean Professional base theme tokens (colors and typography hints).
 */
export function getOceanTheme() {
  return {
    name: "Ocean Professional",
    colors: {
      primary: "#2563EB",
      secondary: "#F59E0B",
      success: "#10B981",
      warning: "#F59E0B",
      error: "#EF4444",
      background: "#f9fafb",
      surface: "#ffffff",
      text: "#111827",
      muted: "#6B7280",
      grid: "rgba(0,0,0,0.08)",
      border: "#E5E7EB",
    },
    typography: {
      fontFamily:
        "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,'Apple Color Emoji','Segoe UI Emoji'",
    },
    radius: { md: 12, lg: 16 },
    elevation: {
      sm: "0 1px 2px rgba(0,0,0,0.05)",
      md: "0 2px 8px rgba(0,0,0,0.06)",
    },
  };
}

/**
 * PUBLIC_INTERFACE
 * getCategoricalPalette (JS)
 * Returns a deterministic palette of colors for categorical series, seeded by Ocean colors.
 * Ensures adequate contrast and distinction across up to N categories.
 * @param {number} count
 * @returns {string[]}
 */
export function getCategoricalPalette(count) {
  const { colors } = getOceanTheme();
  const seed = [
    colors.primary,
    colors.secondary,
    "#10B981",
    "#8B5CF6",
    "#EC4899",
    "#14B8A6",
    "#F97316",
    "#22C55E",
    "#0EA5E9",
    "#6366F1",
    "#84CC16",
    "#D946EF",
  ];
  if (count <= seed.length) return seed.slice(0, count);

  const toHsl = (hex) => {
    const raw = String(hex || "").replace("#", "");
    const hx = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
    const n = parseInt(hx, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    const r1 = r / 255, g1 = g / 255, b1 = b / 255;
    const max = Math.max(r1, g1, b1), min = Math.min(r1, g1, b1);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r1: h = (g1 - b1) / d + (g1 < b1 ? 6 : 0); break;
        case g1: h = (b1 - r1) / d + 2; break;
        case b1: h = (r1 - g1) / d + 4; break;
        default: h = 0;
      }
      h /= 6;
    }
    return { h, s, l };
  };
  const fromHsl = (h, s, l) => {
    let r, g, b;
    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }
    const toHex = (x) => Math.round(x * 255).toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  };

  const out = seed.slice();
  let i = 0;
  while (out.length < count) {
    const base = seed[i % seed.length];
    const { h, s, l } = toHsl(base);
    const delta = ((Math.floor(out.length / seed.length) + 1) * 0.08) % 0.36;
    const l2 = Math.max(0.25, Math.min(0.72, l + (i % 2 === 0 ? delta : -delta)));
    out.push(fromHsl(h, s, l2));
    i++;
  }
  return out.slice(0, count);
}

/**
 * PUBLIC_INTERFACE
 * getCategoryColorMap
 * Maps category names to colors using the categorical palette. Stable order is preserved from input array.
 * @param {string[]} categories
 * @returns {Record<string,string>}
 */
export function getCategoryColorMap(categories) {
  const palette = getCategoricalPalette((categories && categories.length) || 1);
  const map = {};
  (categories || []).forEach((k, idx) => {
    map[k] = palette[idx % palette.length];
  });
  return map;
}

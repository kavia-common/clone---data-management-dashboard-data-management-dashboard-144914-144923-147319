//
// PUBLIC_INTERFACE
// Ocean Professional theme color tokens for charting and UI accenting.
// These tokens mirror the style_guide provided in the work item.
//
/**
 * Returns the Ocean Professional theme colors.
 * Values:
 * - primary: #2563EB (used for Processing)
 * - secondary/success: #F59E0B (used for Success)
 * - error: #EF4444 (used for Failed)
 * - background/surface/text to align with the style guide
 */
export function getOceanColors() {
  return {
    name: "Ocean Professional",
    description: "Blue & amber accents",
    primary: "#2563EB", // Processing
    secondary: "#F59E0B", // Success
    success: "#F59E0B", // alias
    error: "#EF4444", // Failed
    gradient: "from-blue-500/10 to-gray-50",
    background: "#f9fafb",
    surface: "#ffffff",
    text: "#111827",
  };
}

export default getOceanColors;

// ============================================================================
// REQUIREMENT TRACEABILITY
// ============================================================================
// Requirement ID: REQ-FE-COSTS-STACKED-001
// User Story: As a user, I want to compare total cost per service with stacks by environment or cost category.
// Acceptance Criteria:
// - X-axis service_name; Y-axis total_cost; stacks by environment or cost_category
// - Robust normalization across multiple services and categories
// - Zero-fill missing combinations
// - Provide categories list and shaped data for Recharts
// GxP Impact: NO - Visualization-only; no data mutation.
// Risk Level: LOW
// Validation Protocol: VP-FE-COSTS-STACKED-001
// ============================================================================

export type StackBy = "environment" | "cost_category";

export interface CostRecord {
  service_name: string;
  environment?: string | null;
  cost_category?: string | null;
  total_cost: number;
}

export interface ShapedSeries {
  data: Array<Record<string, number | string>>;
  categories: string[];
  services: string[];
}

/**
 * PUBLIC_INTERFACE
 * shapeStackedSeries
 * Shapes raw cost aggregate records into a Recharts-friendly dataset with zero-filled stacks.
 *
 * Parameters:
 * - records: CostRecord[] input rows
 * - stackBy: "environment" | "cost_category" (default "environment")
 * - options: optional config {
 *      unknownLabel?: string   // label to use when the stackBy field is missing
 *      serviceLabel?: string   // key name for x-axis label (default "service_name")
 *      sortServices?: boolean  // when true (default), sorts services alphabetically
 *      sortCategories?: boolean // when true (default), sorts categories alphabetically
 *   }
 *
 * Returns:
 * - { data, categories, services }
 *
 * Throws:
 * - Error if records is not an array.
 */
export function shapeStackedSeries(
  records: CostRecord[],
  stackBy: StackBy = "environment",
  options?: {
    unknownLabel?: string;
    serviceLabel?: string;
    sortServices?: boolean;
    sortCategories?: boolean;
  }
): ShapedSeries {
  if (!Array.isArray(records)) {
    throw new Error("shapeStackedSeries: records must be an array");
  }
  const unknownLabel = options?.unknownLabel ?? "Uncategorized";
  const serviceKey = options?.serviceLabel ?? "service_name";
  const sortServices = options?.sortServices ?? true;
  const sortCategories = options?.sortCategories ?? true;

  // Normalize records and collect distinct services and categories
  const servicesSet = new Set<string>();
  const categoriesSet = new Set<string>();

  type NestMap = Record<string, Record<string, number>>; // service -> category -> sum
  const nested: NestMap = {};

  const readCategory = (r: CostRecord) => {
    const v = (r as any)?.[stackBy];
    const label = (v == null || v === "") ? unknownLabel : String(v);
    return label;
  };

  records.forEach((row) => {
    const service = row?.service_name ? String(row.service_name) : "Unknown";
    const cat = readCategory(row);
    const value = Number(row?.total_cost || 0);

    servicesSet.add(service);
    categoriesSet.add(cat);

    if (!nested[service]) nested[service] = {};
    nested[service][cat] = (nested[service][cat] ?? 0) + (Number.isFinite(value) ? value : 0);
  });

  const services = Array.from(servicesSet);
  const categories = Array.from(categoriesSet);

  if (sortServices) services.sort((a, b) => a.localeCompare(b));
  if (sortCategories) categories.sort((a, b) => a.localeCompare(b));

  // Zero fill and build output data rows
  const data: Array<Record<string, number | string>> = services.map((svc) => {
    const row: Record<string, number | string> = { [serviceKey]: svc };
    categories.forEach((cat) => {
      row[cat] = Number(nested[svc]?.[cat] ?? 0);
    });
    return row;
  });

  return { data, categories, services };
}

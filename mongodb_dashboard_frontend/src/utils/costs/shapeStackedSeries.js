/**
 * PUBLIC_INTERFACE
 * shapeStackedSeries (JS)
 * Shapes raw cost aggregate records into a Recharts-friendly dataset with zero-filled stacks.
 *
 * @param {Array<{service_name:string, environment?:string, cost_category?:string, total_cost:number}>} records
 * @param {"environment"|"cost_category"} stackBy
 * @param {{ unknownLabel?: string, serviceLabel?: string, sortServices?: boolean, sortCategories?: boolean }} [options]
 * @returns {{ data: Array<object>, categories: string[], services: string[] }}
 */
export function shapeStackedSeries(records, stackBy = "environment", options) {
  if (!Array.isArray(records)) {
    throw new Error("shapeStackedSeries: records must be an array");
  }
  const unknownLabel = (options && options.unknownLabel) || "Uncategorized";
  const serviceKey = (options && options.serviceLabel) || "service_name";
  const sortServices = options?.sortServices ?? true;
  const sortCategories = options?.sortCategories ?? true;

  const servicesSet = new Set();
  const categoriesSet = new Set();
  const nested = {}; // service -> category -> sum

  const readCategory = (r) => {
    const v = r && r[stackBy];
    const label = v == null || v === "" ? unknownLabel : String(v);
    return label;
  };

  records.forEach((row) => {
    const service = row?.service_name ? String(row.service_name) : "Unknown";
    const cat = readCategory(row);
    const value = Number(row?.total_cost ?? 0);

    servicesSet.add(service);
    categoriesSet.add(cat);

    if (!nested[service]) nested[service] = {};
    nested[service][cat] = (nested[service][cat] ?? 0) + (Number.isFinite(value) ? value : 0);
  });

  const services = Array.from(servicesSet);
  const categories = Array.from(categoriesSet);

  if (sortServices) services.sort((a, b) => a.localeCompare(b));
  if (sortCategories) categories.sort((a, b) => a.localeCompare(b));

  const data = services.map((svc) => {
    const row = { [serviceKey]: svc };
    categories.forEach((cat) => {
      row[cat] = Number(nested[svc]?.[cat] ?? 0);
    });
    return row;
  });

  return { data, categories, services };
}

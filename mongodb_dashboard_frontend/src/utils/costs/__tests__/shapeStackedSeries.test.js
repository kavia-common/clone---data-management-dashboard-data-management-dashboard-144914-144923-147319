import { shapeStackedSeries } from "../shapeStackedSeries";

describe("shapeStackedSeries (JS)", () => {
  const records = [
    { service_name: "A", environment: "prod", cost_category: "compute", total_cost: 10 },
    { service_name: "A", environment: "staging", cost_category: "compute", total_cost: 5 },
    { service_name: "B", environment: "prod", cost_category: "storage", total_cost: 2 },
  ];

  test("zero-fills missing combinations and sorts services/categories", () => {
    const { data, categories, services } = shapeStackedSeries(records, "environment");
    expect(services).toEqual(["A", "B"]);
    expect(categories).toEqual(["prod", "staging"]);
    const rowA = data.find((r) => r.service_name === "A");
    const rowB = data.find((r) => r.service_name === "B");
    expect(rowA.prod).toBe(10);
    expect(rowA.staging).toBe(5);
    expect(rowB.prod).toBe(2);
    expect(rowB.staging).toBe(0);
  });

  test("supports stacking by cost_category", () => {
    const { data, categories } = shapeStackedSeries(records, "cost_category");
    expect(categories).toEqual(["compute", "storage"]);
    const rowA = data.find((r) => r.service_name === "A");
    const rowB = data.find((r) => r.service_name === "B");
    expect(rowA.compute).toBe(15);
    expect(rowA.storage).toBe(0);
    expect(rowB.compute).toBe(0);
    expect(rowB.storage).toBe(2);
  });
});

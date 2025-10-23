import { shapeStackedSeries, CostRecord } from "../../costs/shapeStackedSeries";

describe("shapeStackedSeries", () => {
  const records: CostRecord[] = [
    { service_name: "A", environment: "prod", cost_category: "compute", total_cost: 10 },
    { service_name: "A", environment: "staging", cost_category: "compute", total_cost: 5 },
    { service_name: "B", environment: "prod", cost_category: "storage", total_cost: 2 },
  ];

  test("zero-fills missing combinations and sorts services/categories", () => {
    const { data, categories, services } = shapeStackedSeries(records, "environment");
    // services A and B
    expect(services).toEqual(["A", "B"]);
    // categories include prod and staging
    expect(categories).toEqual(["prod", "staging"]);

    const rowA = data.find((r: any) => r.service_name === "A") as any;
    const rowB = data.find((r: any) => r.service_name === "B") as any;

    expect(rowA.prod).toBe(10);
    expect(rowA.staging).toBe(5);

    // B has only prod; staging should be zero
    expect(rowB.prod).toBe(2);
    expect(rowB.staging).toBe(0);
  });

  test("supports stacking by cost_category", () => {
    const { data, categories } = shapeStackedSeries(records, "cost_category");
    expect(categories).toEqual(["compute", "storage"]);

    const rowA = data.find((r: any) => r.service_name === "A") as any;
    const rowB = data.find((r: any) => r.service_name === "B") as any;
    expect(rowA.compute).toBe(15); // 10 + 5 across envs
    expect(rowA.storage).toBe(0);
    expect(rowB.compute).toBe(0);
    expect(rowB.storage).toBe(2);
  });

  test("handles missing or null fields with 'Uncategorized'", () => {
    const mixed: CostRecord[] = [
      { service_name: "X", environment: null, total_cost: 1, cost_category: "" as any },
      { service_name: "X", total_cost: 2 } as any,
      { service_name: "Y", environment: "prod", total_cost: 3 },
    ];
    const shaped = shapeStackedSeries(mixed, "environment");
    expect(shaped.categories).toContain("Uncategorized");

    const rowX = shaped.data.find((r: any) => r.service_name === "X") as any;
    const rowY = shaped.data.find((r: any) => r.service_name === "Y") as any;

    expect(rowX["Uncategorized"]).toBe(3);
    expect(rowY["Uncategorized"]).toBe(0);
  });

  test("throws on non-array input", () => {
    expect(() => shapeStackedSeries(null as any, "environment")).toThrow();
    expect(() => shapeStackedSeries(undefined as any, "environment")).toThrow();
  });
});

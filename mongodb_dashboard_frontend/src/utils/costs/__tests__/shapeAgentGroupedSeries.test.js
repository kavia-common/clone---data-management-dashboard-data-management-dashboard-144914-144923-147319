import { shapeAgentGroupedSeries } from "../shapeAgentGroupedSeries";

describe("shapeAgentGroupedSeries (JS)", () => {
  const records = [
    { agent_name: "Agent A", environment: "prod", cost_category: "compute", total_cost: 5 },
    { agent_name: "Agent A", environment: "staging", cost_category: "compute", total_cost: 2 },
    { agent_name: "Agent B", environment: "prod", cost_category: "storage", total_cost: 3 },
    { agent_name: "Agent C", environment: "dev", cost_category: "egress", total_cost: 1 },
  ];

  test("zero-fills missing combinations and sorts agents/categories (environment)", () => {
    const { data, categories, agents } = shapeAgentGroupedSeries(records, "environment");
    expect(agents).toEqual(["Agent A", "Agent B", "Agent C"]);
    expect(categories).toEqual(["dev", "prod", "staging"]); // alphabetical

    const rowA = data.find((r) => r.agent_name === "Agent A");
    const rowB = data.find((r) => r.agent_name === "Agent B");
    const rowC = data.find((r) => r.agent_name === "Agent C");

    expect(rowA.prod).toBe(5);
    expect(rowA.staging).toBe(2);
    expect(rowA.dev).toBe(0);

    expect(rowB.prod).toBe(3);
    expect(rowB.staging).toBe(0);
    expect(rowB.dev).toBe(0);

    expect(rowC.dev).toBe(1);
    expect(rowC.prod).toBe(0);
    expect(rowC.staging).toBe(0);
  });

  test("groups by cost_category correctly", () => {
    const { data, categories } = shapeAgentGroupedSeries(records, "cost_category");
    expect(categories).toEqual(["compute", "egress", "storage"]); // alphabetical

    const rowA = data.find((r) => r.agent_name === "Agent A");
    const rowB = data.find((r) => r.agent_name === "Agent B");
    const rowC = data.find((r) => r.agent_name === "Agent C");

    expect(rowA.compute).toBe(7);
    expect(rowA.egress).toBe(0);
    expect(rowA.storage).toBe(0);

    expect(rowB.storage).toBe(3);
    expect(rowB.compute).toBe(0);
    expect(rowB.egress).toBe(0);

    expect(rowC.egress).toBe(1);
    expect(rowC.compute).toBe(0);
    expect(rowC.storage).toBe(0);
  });
});

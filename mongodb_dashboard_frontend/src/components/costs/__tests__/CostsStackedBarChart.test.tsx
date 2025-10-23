import React from "react";
import { render, screen } from "@testing-library/react";
import CostsStackedBarChart from "../CostsStackedBarChart";
import type { CostRecord } from "../../../utils/costs/shapeStackedSeries";

describe("CostsStackedBarChart", () => {
  const data: CostRecord[] = [
    { service_name: "Auth", environment: "prod", cost_category: "compute", total_cost: 10 },
    { service_name: "Auth", environment: "staging", cost_category: "compute", total_cost: 5 },
    { service_name: "Gateway", environment: "prod", cost_category: "egress", total_cost: 2 },
  ];

  test("renders legend and axes with multiple categories", async () => {
    render(
      <CostsStackedBarChart
        records={data}
        stackBy="environment"
        height={240}
        title="Test Chart"
      />
    );
    // Title visible
    expect(screen.getByText("Test Chart")).toBeInTheDocument();
    // No error or loading state
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Container should be present (ResponsiveContainer wraps an svg within a div)
    // Use label to query chart region for accessibility
    expect(screen.getByRole("region", { name: /test chart/i })).toBeInTheDocument();
  });

  test("friendly empty state", () => {
    render(<CostsStackedBarChart records={[]} />);
    expect(screen.getByLabelText(/No stacked cost data available/i)).toBeInTheDocument();
  });

  test("error state", () => {
    render(<CostsStackedBarChart error="Oops" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Oops");
  });
});

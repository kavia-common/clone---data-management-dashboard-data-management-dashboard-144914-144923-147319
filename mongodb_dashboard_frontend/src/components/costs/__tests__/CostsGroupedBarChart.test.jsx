import React from "react";
import { render, screen } from "@testing-library/react";
import CostsGroupedBarChart from "../CostsGroupedBarChart";

describe("CostsGroupedBarChart", () => {
  const records = [
    { agent_name: "Agent A", environment: "prod", cost_category: "compute", total_cost: 2 },
    { agent_name: "Agent A", environment: "staging", cost_category: "storage", total_cost: 1 },
    { agent_name: "Agent B", environment: "prod", cost_category: "compute", total_cost: 3 },
  ];

  test("renders grouped bars and legend for categories", () => {
    render(
      <CostsGroupedBarChart
        records={records}
        groupBy="cost_category"
        height={240}
        showSelector={false}
        title="Test Grouped Chart"
      />
    );

    // Legend should contain our categories
    expect(screen.getByText("compute")).toBeInTheDocument();
    expect(screen.getByText("storage")).toBeInTheDocument();

    // There should be Bar series for each category
    const computeSeries = screen.getByTestId("bar-series-compute");
    const storageSeries = screen.getByTestId("bar-series-storage");
    expect(computeSeries).toBeInTheDocument();
    expect(storageSeries).toBeInTheDocument();

    // Title/region label rendered
    expect(screen.getByRole("region", { name: /Test Grouped Chart/i })).toBeInTheDocument();
  });

  test("shows loading skeleton when loading", () => {
    render(<CostsGroupedBarChart loading height={200} />);
    expect(screen.getByLabelText(/Loading grouped cost chart/i)).toBeInTheDocument();
  });

  test("shows no-data message when no records provided", () => {
    render(<CostsGroupedBarChart records={[]} height={200} />);
    expect(screen.getByLabelText(/No grouped cost data available/i)).toBeInTheDocument();
  });
});

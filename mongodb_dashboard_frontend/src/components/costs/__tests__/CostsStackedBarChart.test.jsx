import React from "react";
import { render, screen } from "@testing-library/react";
import CostsStackedBarChart from "../CostsStackedBarChart";

describe("CostsStackedBarChart (JSX)", () => {
  const data = [
    { service_name: "Auth", environment: "prod", cost_category: "compute", total_cost: 10 },
    { service_name: "Auth", environment: "staging", cost_category: "compute", total_cost: 5 },
    { service_name: "Gateway", environment: "prod", cost_category: "egress", total_cost: 2 },
  ];

  test("renders title and region", () => {
    render(<CostsStackedBarChart records={data} stackBy="environment" height={240} title="Stacked Costs" />);
    expect(screen.getByText("Stacked Costs")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /stacked costs/i })).toBeInTheDocument();
  });

  test("renders empty state", () => {
    render(<CostsStackedBarChart records={[]} />);
    expect(screen.getByLabelText(/No stacked cost data available/i)).toBeInTheDocument();
  });
});

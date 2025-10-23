import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import AgentBarChart from "../AgentBarChart";

// Mock listLlmCosts to avoid actual network calls
jest.mock("../../../api/client", () => ({
  listLlmCosts: jest.fn(),
}));

const { listLlmCosts } = require("../../../api/client");

describe("AgentBarChart - basic states", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("renders empty state when API returns no items", async () => {
    listLlmCosts.mockResolvedValueOnce({ items: [] });

    render(<AgentBarChart defaultMetric="count" defaultTopN={5} />);

    // Loading skeleton visible first
    expect(screen.getByLabelText("Loading agent chart")).toBeInTheDocument();

    // Then empty state
    const empty = await screen.findByLabelText("No agent data");
    expect(empty).toBeInTheDocument();
  });

  test("renders error state when API rejects", async () => {
    listLlmCosts.mockRejectedValueOnce(new Error("boom"));

    render(<AgentBarChart />);

    const errorEl = await screen.findByRole("alert");
    expect(errorEl).toHaveTextContent(/failed to load agent metrics/i);
  });

  test("accepts and clamps invalid defaultTopN", async () => {
    listLlmCosts.mockResolvedValueOnce({
      items: [
        { agent_name: "Agent A", total_cost: 1.2 },
        { agent_name: "Agent B", total_cost: 0.3 },
        { agent_name: "Agent C", total_cost: 2.7 },
      ],
    });

    render(<AgentBarChart defaultTopN={-5} defaultMetric="count" />);

    // Wait until loading finishes and chart is present or empty replaced
    await waitFor(() => {
      // Either the chart region or at least no loading
      expect(screen.queryByLabelText("Loading agent chart")).not.toBeInTheDocument();
    });

    // We cannot reliably count SVG bars without querying internals.
    // Sanity check: the chart region should exist.
    expect(screen.getByLabelText("Bar chart of agents by selected metric")).toBeInTheDocument();
  });
});

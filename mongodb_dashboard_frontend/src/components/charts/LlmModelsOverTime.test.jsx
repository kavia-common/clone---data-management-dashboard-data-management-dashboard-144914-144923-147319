import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import LlmModelsOverTime from "./LlmModelsOverTime.jsx";

// Mock the API client used by the component
jest.mock("../../api/client", () => ({
  getLlmUsageOverTime: jest.fn(),
  seedLlmCostsDemo: jest.fn(),
}));

const { getLlmUsageOverTime, seedLlmCostsDemo } = require("../../api/client");

describe("LlmModelsOverTime", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test("defaults to 90 days when no days prop is provided", async () => {
    // Return minimal valid data
    getLlmUsageOverTime.mockResolvedValueOnce({
      items: [{ date: "2025-01-01", series: {} }],
      meta: { models: [], start: "2025-01-01T00:00:00.000Z", end: "2025-01-01T23:59:59.999Z", days: 1 },
    });

    render(<LlmModelsOverTime height={200} />);

    await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());

    // Ensure the API was invoked with 90
    expect(getLlmUsageOverTime).toHaveBeenCalledTimes(1);
    expect(getLlmUsageOverTime).toHaveBeenCalledWith(90);

    // Title should show (90d)
    expect(screen.getByText(/LLM Model Usage \(90d\)/i)).toBeInTheDocument();
  });

  test("shows empty state when no models and totals are zero", async () => {
    getLlmUsageOverTime.mockResolvedValueOnce({
      items: [
        { date: "2025-01-01", series: {} },
        { date: "2025-01-02", series: {} },
      ],
      meta: { models: [], start: "2025-01-01T00:00:00.000Z", end: "2025-01-02T23:59:59.999Z", days: 2 },
    });

    render(<LlmModelsOverTime days={2} height={200} />);

    // Wait for loading to finish
    await waitFor(() => expect(screen.queryByLabelText(/Loading LLM model usage chart/i)).not.toBeInTheDocument());

    // Verify empty-state message is shown
    expect(
      screen.getByText(/No LLM usage data for the last 2 days/i)
    ).toBeInTheDocument();

    // Buttons should be present
    expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Seed demo data/i })).toBeInTheDocument();
  });

  test("renders legend/model when data is present", async () => {
    getLlmUsageOverTime.mockResolvedValueOnce({
      items: [
        { date: "2025-01-01", series: { "gpt-4o": 0.01 } },
        { date: "2025-01-02", series: { "gpt-4o": 0.02 } },
      ],
      meta: { models: ["gpt-4o"], start: "2025-01-01T00:00:00.000Z", end: "2025-01-02T23:59:59.999Z", days: 2 },
    });

    render(<LlmModelsOverTime days={2} height={200} />);

    await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());

    // The legend should include the model name
    expect(screen.getByText("gpt-4o")).toBeInTheDocument();
  });

  test("seed demo data button triggers seeding and refetch", async () => {
    // First call returns empty
    getLlmUsageOverTime.mockResolvedValueOnce({
      items: [{ date: "2025-01-01", series: {} }],
      meta: { models: [], start: "2025-01-01T00:00:00.000Z", end: "2025-01-01T23:59:59.999Z", days: 1 },
    });
    // Seeding succeeds
    seedLlmCostsDemo.mockResolvedValueOnce({ success: true, inserted: 10 });
    // Refetch returns data
    getLlmUsageOverTime.mockResolvedValueOnce({
      items: [{ date: "2025-01-01", series: { "gpt-4o": 0.01 } }],
      meta: { models: ["gpt-4o"], start: "2025-01-01T00:00:00.000Z", end: "2025-01-01T23:59:59.999Z", days: 1 },
    });

    render(<LlmModelsOverTime days={1} height={200} />);

    await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
    expect(screen.getByText(/No LLM usage data for the last 1 days/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Seed demo data/i }));

    // After seeding, we should eventually see the legend/model text
    await waitFor(() => expect(screen.getByText("gpt-4o")).toBeInTheDocument());
  });
}

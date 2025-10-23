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

  test("defaults to 90 days when no days prop is provided and shows title (90d)", async () => {
    // First fetch on mount
    getLlmUsageOverTime.mockResolvedValueOnce({
      items: [{ date: "2025-01-01", series: {} }],
      meta: { models: [], start: "2025-01-01T00:00:00.000Z", end: "2025-01-01T23:59:59.999Z", days: 1 },
    });

    render(<LlmModelsOverTime height={200} />);

    await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());

    expect(getLlmUsageOverTime).toHaveBeenCalledTimes(1);
    expect(getLlmUsageOverTime).toHaveBeenCalledWith(90);
    expect(screen.getByText(/LLM Model Usage \(90d\)/i)).toBeInTheDocument();

    // Range control visible with four options
    expect(screen.getByRole("button", { name: "7d" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "30d" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "90d" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "180d" })).toBeInTheDocument();
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

    await waitFor(() =>
      expect(screen.queryByLabelText(/Loading LLM model usage chart/i)).not.toBeInTheDocument()
    );

    expect(screen.getByText(/No LLM usage data for the last 2 days/i)).toBeInTheDocument();
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

    expect(screen.getByText("gpt-4o")).toBeInTheDocument();
  });

  test("seed demo data button triggers seeding and refetch", async () => {
    // initial empty
    getLlmUsageOverTime
      .mockResolvedValueOnce({
        items: [{ date: "2025-01-01", series: {} }],
        meta: { models: [], start: "2025-01-01T00:00:00.000Z", end: "2025-01-01T23:59:59.999Z", days: 1 },
      })
      // refetch returns data
      .mockResolvedValueOnce({
        items: [{ date: "2025-01-01", series: { "gpt-4o": 0.01 } }],
        meta: { models: ["gpt-4o"], start: "2025-01-01T00:00:00.000Z", end: "2025-01-01T23:59:59.999Z", days: 1 },
      });

    seedLlmCostsDemo.mockResolvedValueOnce({ success: true, inserted: 10 });

    render(<LlmModelsOverTime days={1} height={200} />);

    await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
    expect(screen.getByText(/No LLM usage data for the last 1 days/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Seed demo data/i }));

    await waitFor(() => expect(screen.getByText("gpt-4o")).toBeInTheDocument());
    expect(getLlmUsageOverTime).toHaveBeenCalledTimes(2);
  });

  test("range selection: clicking 7d triggers API call with 7 and updates title + aria-pressed", async () => {
    getLlmUsageOverTime
      .mockResolvedValueOnce({
        items: [{ date: "2025-01-01", series: {} }],
        meta: { models: [], start: "", end: "", days: 90 },
      })
      .mockResolvedValueOnce({
        items: [{ date: "2025-01-01", series: {} }],
        meta: { models: [], start: "", end: "", days: 7 },
      });

    render(<LlmModelsOverTime height={200} />);

    await waitFor(() => expect(getLlmUsageOverTime).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "7d" }));

    await waitFor(() => expect(getLlmUsageOverTime).toHaveBeenCalledTimes(2));
    const lastCall = getLlmUsageOverTime.mock.calls[getLlmUsageOverTime.mock.calls.length - 1];
    expect(lastCall[0]).toBe(7);

    expect(screen.getByText(/LLM Model Usage \(7d\)/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "7d" })).toHaveAttribute("aria-pressed", "true");
  });

  test("range selection: clicking 30d triggers API call with 30 and updates title", async () => {
    getLlmUsageOverTime
      .mockResolvedValueOnce({
        items: [{ date: "2025-01-01", series: {} }],
        meta: { models: [], start: "", end: "", days: 90 },
      })
      .mockResolvedValueOnce({
        items: [{ date: "2025-01-01", series: {} }],
        meta: { models: [], start: "", end: "", days: 30 },
      });

    render(<LlmModelsOverTime height={200} />);

    await waitFor(() => expect(getLlmUsageOverTime).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "30d" }));

    await waitFor(() => expect(getLlmUsageOverTime).toHaveBeenCalledTimes(2));
    const lastCall = getLlmUsageOverTime.mock.calls[getLlmUsageOverTime.mock.calls.length - 1];
    expect(lastCall[0]).toBe(30);
    expect(screen.getByText(/LLM Model Usage \(30d\)/i)).toBeInTheDocument();
  });

  test("range selection: clicking 90d triggers API call with 90 and updates title", async () => {
    getLlmUsageOverTime
      .mockResolvedValueOnce({
        items: [{ date: "2025-01-01", series: {} }],
        meta: { models: [], start: "", end: "", days: 90 },
      })
      .mockResolvedValueOnce({
        items: [{ date: "2025-01-01", series: {} }],
        meta: { models: [], start: "", end: "", days: 90 },
      });

    render(<LlmModelsOverTime height={200} />);

    await waitFor(() => expect(getLlmUsageOverTime).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "90d" }));

    await waitFor(() => expect(getLlmUsageOverTime).toHaveBeenCalledTimes(2));
    const lastCall = getLlmUsageOverTime.mock.calls[getLlmUsageOverTime.mock.calls.length - 1];
    expect(lastCall[0]).toBe(90);
    expect(screen.getByText(/LLM Model Usage \(90d\)/i)).toBeInTheDocument();
  });

  test("range selection: clicking 180d triggers API call with 180 and updates title", async () => {
    getLlmUsageOverTime
      .mockResolvedValueOnce({
        items: [{ date: "2025-01-01", series: {} }],
        meta: { models: [], start: "", end: "", days: 90 },
      })
      .mockResolvedValueOnce({
        items: [{ date: "2025-01-01", series: {} }],
        meta: { models: [], start: "", end: "", days: 180 },
      });

    render(<LlmModelsOverTime height={200} />);

    await waitFor(() => expect(getLlmUsageOverTime).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "180d" }));

    await waitFor(() => expect(getLlmUsageOverTime).toHaveBeenCalledTimes(2));
    const lastCall = getLlmUsageOverTime.mock.calls[getLlmUsageOverTime.mock.calls.length - 1];
    expect(lastCall[0]).toBe(180);
    expect(screen.getByText(/LLM Model Usage \(180d\)/i)).toBeInTheDocument();
  });
});

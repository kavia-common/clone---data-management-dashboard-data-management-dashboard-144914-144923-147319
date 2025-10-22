import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import LlmModelsOverTime from "./LlmModelsOverTime.jsx";

// Mock API
jest.mock("../../api/client", () => ({
  getLlmUsageOverTime: jest.fn(async () => ({
    items: [
      { date: "2099-01-01", series: { "gpt-4o": 1.2, "claude-3": 0.8 } },
      { date: "2099-01-02", series: { "gpt-4o": 1.8, "claude-3": 1.2 } },
    ],
    meta: { models: ["gpt-4o", "claude-3"], start: "2099-01-01T00:00:00.000Z", end: "2099-01-02T23:59:59.999Z", days: 2 },
  })),
}));

describe("LlmModelsOverTime", () => {
  test("renders title and legend entries", async () => {
    render(<LlmModelsOverTime days={2} height={240} />);
    expect(screen.getByText(/LLM Model Usage \(30d\)/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/gpt-4o/i)).toBeInTheDocument();
      expect(screen.getByText(/claude-3/i)).toBeInTheDocument();
    });
  });
});

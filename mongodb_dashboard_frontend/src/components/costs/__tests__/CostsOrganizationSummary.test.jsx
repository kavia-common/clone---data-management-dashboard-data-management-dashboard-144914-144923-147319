import React from "react";
import { render, screen, act } from "@testing-library/react";
import CostsOrganizationSummary from "../../costs/CostsOrganizationSummary.jsx";

jest.useFakeTimers();

describe("CostsOrganizationSummary", () => {
  it("shows skeleton then renders organization values", async () => {
    render(<CostsOrganizationSummary failChance={0} />);

    // Loading skeletons present
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);

    // Advance timers to resolve mock fetch
    await act(async () => {
      jest.advanceTimersByTime(800);
    });

    // Check values
    expect(screen.getByText("Organization ID")).toBeInTheDocument();
    expect(screen.getByText("T0002")).toBeInTheDocument();
    expect(screen.getByText("Organization")).toBeInTheDocument();
    expect(screen.getByText("KAVIA")).toBeInTheDocument();
    expect(screen.getByText(/Total Cost/i)).toBeInTheDocument();
    expect(screen.getByText(/\$2,663\.216423/)).toBeInTheDocument();
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("25")).toBeInTheDocument();
  });

  it("shows error and allows retry", async () => {
    render(<CostsOrganizationSummary failChance={1} />);

    await act(async () => {
      jest.advanceTimersByTime(800);
    });

    const retry = screen.getByRole("button", { name: /retry/i });
    expect(retry).toBeInTheDocument();
  });
});

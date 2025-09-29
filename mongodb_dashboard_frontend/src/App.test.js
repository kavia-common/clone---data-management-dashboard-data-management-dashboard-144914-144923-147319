import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "./App";

test("renders dashboard overview by default with no authentication", () => {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <App />
    </MemoryRouter>
  );
  // Expect a known overview card title to be present
  expect(screen.getByText(/Activity trend/i)).toBeInTheDocument();
});

import React from "react";
import { render, screen } from "@testing-library/react";
import TreeView from "./TreeView";

describe("TreeView - label formatting", () => {
  it("renders formatted labels for top-level and nested keys", () => {
    const data = {
      user_id: "u-123",
      nested_object: {
        project_id: "p-42",
        sub_nested: {
          api_url: "https://example.com",
        },
      },
      items: [
        { agent_id: "a-1", tokens_total: 1000 },
        "primitive"
      ],
    };

    render(<TreeView data={data} defaultExpandedDepth={4} />);

    // Top-level key label
    expect(screen.getByText("User ID")).toBeInTheDocument();

    // Nested object key labels
    expect(screen.getByText("Nested Object")).toBeInTheDocument();
    expect(screen.getByText("Project ID")).toBeInTheDocument();
    expect(screen.getByText("Sub Nested")).toBeInTheDocument();
    // Acronym handling
    expect(screen.getByText("API URL")).toBeInTheDocument();

    // Array key label and nested object keys within array
    expect(screen.getByText("Items")).toBeInTheDocument();
    expect(screen.getByText("Agent ID")).toBeInTheDocument();
    expect(screen.getByText("Tokens Total")).toBeInTheDocument();
  });
});

import { renderHook } from "@testing-library/react";
import useDeploymentStatusCounts from "../useDeploymentStatusCounts";

describe("useDeploymentStatusCounts", () => {
  test("returns default structure (no mock)", async () => {
    const { result } = renderHook(() => useDeploymentStatusCounts({ strategy: "mock", useServer: false }));
    const { data, loading, error } = result.current;
    expect(Array.isArray(data)).toBe(true);
    expect(data.map((d) => d.status)).toEqual(["Processing", "Success", "Failed"]);
    expect(typeof loading).toBe("boolean");
    expect(typeof error).toBe("string");
  });
});

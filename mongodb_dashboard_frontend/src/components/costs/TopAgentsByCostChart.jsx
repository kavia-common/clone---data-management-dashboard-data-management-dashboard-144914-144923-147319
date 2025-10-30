import React from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from "recharts";

/**
 * PUBLIC_INTERFACE
 * TopAgentsByCostChart
 * Renders a responsive bar chart of top agents by total cost (USD).
 * Props:
 *  - data: array of { agent_name: string, total_cost: number }
 *  - loading: boolean
 *  - error: string
 *  - height: number (default 300)
 */
export default function TopAgentsByCostChart({ data = [], loading = false, error = "", height = 300 }) {
  const brandBlue = "#2563EB";   // Ocean Professional primary
  const gridStroke = "rgba(0,0,0,0.08)";
  const tickStyle = { fontSize: 12, fill: "#1f2937" };

  const prepared = React.useMemo(() => {
    const toNumber = (v) => {
      if (typeof v === "number") return Number.isFinite(v) ? v : 0;
      if (v == null) return 0;
      const s = String(v).replace(/[$,]/g, "").trim();
      const n = Number.parseFloat(s);
      return Number.isFinite(n) ? n : 0;
    };

    const arr = (Array.isArray(data) ? data : [])
      .map((d) => {
        const name = d?.agent_name ?? d?.agent ?? "unknown";
        const total = toNumber(d?.total_cost ?? d?.total ?? 0);
        return { name: name || "unknown", total };
      })
      .filter((x) => Number.isFinite(x.total));

    // Ensure descending sort regardless of server behavior
    arr.sort((a, b) => b.total - a.total);
    return arr;
  }, [data]);

  if (error) {
    return <div className="error" role="alert">{error}</div>;
  }
  if (loading) {
    return <div>Loading top agents...</div>;
  }
  if (!prepared.length) {
    return <div>No agent cost data available.</div>;
  }

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <BarChart data={prepared} margin={{ top: 8, right: 24, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
          <XAxis dataKey="name" tick={tickStyle} />
          <YAxis tick={tickStyle} tickFormatter={(v) => `$${Number(v).toFixed(2)}`} />
          <Tooltip formatter={(v) => [`$${Number(v).toFixed(6)}`, "Total cost"]} />
          <Bar dataKey="total" name="Total cost (USD)" radius={[8, 8, 0, 0]} fill={brandBlue}>
            <LabelList dataKey="total" position="top" formatter={(v) => `$${Number(v).toFixed(2)}`} style={{ fontSize: 11, fill: "#111827" }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

import React from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// PUBLIC_INTERFACE
export default function KPIChart({ data = [], xKey = "label", yKey = "value", color = "var(--chart-primary)" }) {
  /** Simple responsive area chart for KPI trends. */
  const grid = "var(--chart-grid)";
  const axis = "var(--chart-axis)";
  const tooltipStyle = {
    background: "var(--chart-tooltip-bg)",
    border: "1px solid var(--chart-tooltip-border)",
    borderRadius: 8,
    color: "var(--color-text-primary)",
  };
  return (
    <div style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 10, right: 24, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="kpiColor" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.35}/>
              <stop offset="95%" stopColor={color} stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={grid}/>
          <XAxis dataKey={xKey} tick={{ fontSize: 12, fill: axis }} />
          <YAxis tick={{ fontSize: 12, fill: axis }} />
          <Tooltip contentStyle={tooltipStyle} />
          <Area type="monotone" dataKey={yKey} stroke={color} fillOpacity={1} fill="url(#kpiColor)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

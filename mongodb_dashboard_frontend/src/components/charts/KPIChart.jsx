import React from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// PUBLIC_INTERFACE
export default function KPIChart({ data = [], xKey = "label", yKey = "value", color = "#2563EB" }) {
  /** Simple responsive area chart for KPI trends. */
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
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)"/>
          <XAxis dataKey={xKey} tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip />
          <Area type="monotone" dataKey={yKey} stroke={color} fillOpacity={1} fill="url(#kpiColor)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

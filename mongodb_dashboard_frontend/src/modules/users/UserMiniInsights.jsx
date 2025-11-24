import React, { useMemo } from "react";
import PropTypes from "prop-types";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { useUserProjects } from "../../hooks/useUserProjects";

/**
 * PUBLIC_INTERFACE
 * UserMiniInsights
 * Shows per-user mini insights: projects count over time and top categories (if available).
 *
 * Props:
 * - userId: string
 * - tenantId: string
 * - from: ISO start
 * - to: ISO end
 */
export default function UserMiniInsights({ userId, tenantId, from, to }) {
  const { projects, loading, error } = useUserProjects({
    userId,
    tenantId,
    from,
    to,
    enabled: Boolean(userId && tenantId),
  });

  // Build timeline by day from last_activity if present
  const timeline = useMemo(() => {
    const map = new Map();
    for (const p of projects || []) {
      const iso = p?.last_activity || p?.created_at || p?.createdAt;
      if (!iso) continue;
      const day = new Date(iso).toISOString().slice(0, 10);
      map.set(day, (map.get(day) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([date, total]) => ({ date, total }))
      .sort((a, b) => (a.date > b.date ? 1 : -1));
  }, [projects]);

  // Infer categories if available
  const categories = useMemo(() => {
    const map = new Map();
    for (const p of projects || []) {
      const cat = p?.category || p?.project_category || p?.metadata?.category || "Uncategorized";
      map.set(cat, (map.get(cat) || 0) + 1);
    }
    const arr = Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
    return arr;
  }, [projects]);

  const palette = ["#2563EB", "#F59E0B", "#10B981", "#EF4444", "#6366F1", "#14B8A6", "#F97316", "#84CC16", "#06B6D4", "#A855F7"];

  return (
    <div role="region" aria-label="User insights panel" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <div className="card" aria-label="Projects over time mini chart">
        <div className="card-header" style={{ paddingBottom: 0 }}>
          <h4 className="card-title">Projects over time</h4>
          <div className="card-subtitle">Per-user</div>
        </div>
        <div className="card-content" style={{ height: 220 }}>
          {loading ? (
            <div aria-busy="true">
              <div className="skeleton" style={{ height: 12, width: "45%", marginBottom: 8 }} />
              <div className="skeleton" style={{ height: 180, width: "100%" }} />
            </div>
          ) : error ? (
            <div className="error" role="alert">{error}</div>
          ) : timeline.length === 0 ? (
            <div className="screen-center">No timeline data</div>
          ) : (
            <ResponsiveContainer>
              <LineChart data={timeline}>
                <CartesianGrid stroke="#E5E7EB" strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fill: "#6B7280", fontSize: 12 }} />
                <YAxis tick={{ fill: "#6B7280", fontSize: 12 }} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Line dataKey="total" name="Projects" stroke="#2563EB" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="card" aria-label="Top project categories mini chart">
        <div className="card-header" style={{ paddingBottom: 0 }}>
          <h4 className="card-title">Top project categories</h4>
          <div className="card-subtitle">If available</div>
        </div>
        <div className="card-content" style={{ height: 220 }}>
          {loading ? (
            <div aria-busy="true">
              <div className="skeleton" style={{ height: 12, width: "45%", marginBottom: 8 }} />
              <div className="skeleton" style={{ height: 180, width: "100%" }} />
            </div>
          ) : error ? (
            <div className="error" role="alert">{error}</div>
          ) : categories.length === 0 ? (
            <div className="screen-center">No categories</div>
          ) : (
            <ResponsiveContainer>
              <PieChart>
                <Tooltip />
                <Legend />
                <Pie data={categories} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius="80%" paddingAngle={2}>
                  {categories.map((c, idx) => (
                    <Cell key={c.name} fill={palette[idx % palette.length]} stroke={palette[idx % palette.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

UserMiniInsights.propTypes = {
  userId: PropTypes.string,
  tenantId: PropTypes.string,
  from: PropTypes.string,
  to: PropTypes.string,
};

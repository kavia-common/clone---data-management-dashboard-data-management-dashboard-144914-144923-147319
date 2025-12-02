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

/**
 * PUBLIC_INTERFACE
 * UserMiniInsightsBatched
 * Pure-presentational variant that reads per-user projects from a supplied map (no fetching).
 * Use this inside lists/tables when a parent already called useUsersProjectsBatch.
 */
export default function UserMiniInsightsBatched({ userId, projectsByUser }) {
  const projects = useMemo(() => {
    const arr = projectsByUser?.[String(userId)] || [];
    return Array.isArray(arr) ? arr : [];
  }, [userId, projectsByUser]);

  const timeline = useMemo(() => {
    const map = new Map();
    for (const p of projects) {
      const iso = p?.last_activity || p?.created_at || p?.createdAt;
      if (!iso) continue;
      const day = new Date(iso).toISOString().slice(0, 10);
      map.set(day, (map.get(day) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([date, total]) => ({ date, total }))
      .sort((a, b) => (a.date > b.date ? 1 : -1));
  }, [projects]);

  const categories = useMemo(() => {
    const map = new Map();
    for (const p of projects) {
      const cat = p?.category || p?.project_category || p?.metadata?.category || "Uncategorized";
      map.set(cat, (map.get(cat) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
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
          {timeline.length === 0 ? (
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
          {categories.length === 0 ? (
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

UserMiniInsightsBatched.propTypes = {
  userId: PropTypes.string,
  projectsByUser: PropTypes.object, // map { [userId]: projects[] }
};

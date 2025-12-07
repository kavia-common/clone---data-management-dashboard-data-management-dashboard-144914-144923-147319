import React, { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { getSessionTracking } from "../../api/sessionTracking";
import Card from "../common/Card";
import LoadingState from "../common/LoadingState";
import ErrorState from "../common/ErrorState";
import { useAuth } from "../../context/AuthContext";
import { ResponsiveContainer, BarChart, XAxis, YAxis, Tooltip, Legend, Bar, CartesianGrid } from "recharts";
import { getOceanTheme } from "../../theme/oceanTheme";
import "./overview.css";

/**
 * PUBLIC_INTERFACE
 * OverallFeaturesChart
 * Fetches session-tracking documents and renders a feature distribution (by service_type).
 * Ensures correct GET /api/session-tracking usage with session_start filter and organization scoping.
 * Robustly handles loading, error, and empty states and applies Ocean theme styling.
 */
const OverallFeaturesChart = ({ className }) => {
  const auth = useAuth();
  const organizationId = auth?.organizationId || auth?.tenantId || auth?.user?.organization_id || null;

  // Granularity for computing the session_start window
  const [granularity, setGranularity] = useState("day");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState([]);

  // Compute from/to ISO strings by granularity (Daily/Weekly/Monthly/Custom)
  const { fromISO, toISO } = useMemo(() => {
    const now = new Date();
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    if (granularity === "custom") {
      const from = customFrom ? new Date(customFrom) : null;
      const to = customTo ? new Date(customTo) : null;
      // If a date without time is provided, make 'to' inclusive end of day
      const toAdj =
        to && !customTo.includes("T")
          ? new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate(), 23, 59, 59, 999))
          : to;
      return {
        fromISO: from ? from.toISOString() : null,
        toISO: toAdj ? toAdj.toISOString() : null,
      };
    }
    let start = startOfDay;
    if (granularity === "day") {
      start = startOfDay;
    } else if (granularity === "week") {
      start = new Date(end);
      start.setUTCDate(end.getUTCDate() - 6);
      start.setUTCHours(0, 0, 0, 0);
    } else if (granularity === "month") {
      start = new Date(end);
      start.setUTCDate(end.getUTCDate() - 29);
      start.setUTCHours(0, 0, 0, 0);
    }
    return { fromISO: start.toISOString(), toISO: end.toISOString() };
  }, [granularity, customFrom, customTo]);

  useEffect(() => {
    let aborted = false;
    async function run() {
      if (!organizationId) {
        setError("Missing organization context.");
        return;
      }
      setLoading(true);
      setError("");
      try {
        // Build filter for /api/session-tracking
        const filter = { organization_id: organizationId };
        if (fromISO || toISO) {
          filter.session_start = {};
          if (fromISO) filter.session_start.$gte = fromISO;
          if (toISO) filter.session_start.$lte = toISO;
        }

        const params = {
          // NOTE: baseClient preserves object values by JSON.stringify when building the query.
          filter,
          sort: "-session_start",
          limit: 200,
        };

        const res = await getSessionTracking(params);
        const list = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];

        // Aggregate by service_type
        const counts = {};
        for (const doc of list) {
          const key = (doc && (doc.service_type || doc.feature || "Unknown")) || "Unknown";
          counts[key] = (counts[key] || 0) + 1;
        }
        const shaped = Object.entries(counts)
          .map(([feature, count]) => ({ feature: String(feature), count }))
          .sort((a, b) => b.count - a.count);

        if (!aborted) {
          setItems(shaped);
        }
      } catch (err) {
        if (!aborted) setError(err?.message || "Failed to load features usage.");
      } finally {
        if (!aborted) setLoading(false);
      }
    }
    run();
    return () => {
      aborted = true;
    };
  }, [organizationId, fromISO, toISO]);

  const ocean = getOceanTheme();
  const chartColors = {
    bar: ocean?.colors?.primary || "#2563EB",
    grid: ocean?.colors?.border || "#E5E7EB",
    axis: ocean?.colors?.muted || "#6B7280",
  };

  // Inline controls aligned to Overview page conventions
  const Controls = (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span>Range</span>
        <select value={granularity} onChange={(e) => setGranularity(e.target.value)}>
          <option value="day">Day</option>
          <option value="week">Week</option>
          <option value="month">Month</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      <label style={{ display: "flex", gap: 6, alignItems: "center", opacity: 1 }}>
        <span>From</span>
        <input
          type="date"
          value={customFrom ? customFrom.slice(0, 10) : ""}
          onChange={(e) => setCustomFrom(e.target.value ? new Date(e.target.value).toISOString() : "")}
          disabled={granularity !== "custom"}
        />
      </label>
      <label style={{ display: "flex", gap: 6, alignItems: "center", opacity: 1 }}>
        <span>To</span>
        <input
          type="date"
          value={customTo ? customTo.slice(0, 10) : ""}
          onChange={(e) => setCustomTo(e.target.value ? new Date(e.target.value).toISOString() : "")}
          disabled={granularity !== "custom"}
        />
      </label>
    </div>
  );

  return (
    <Card className={className} style={{ background: "#ffffff" }}>
      <div className="overview-card-header">
        <div>
          <h3 className="overview-card-title">Overall Features</h3>
          <p className="overview-card-subtitle">Usage distribution by feature (service_type)</p>
        </div>
        {Controls}
      </div>

      {loading && <LoadingState message="Loading features usage..." />}
      {!loading && !!error && <ErrorState message={error} />}
      {!loading && !error && items.length === 0 && (
        <div className="overview-empty-state">
          <p>No feature usage found for the selected period.</p>
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer>
            <BarChart data={items} margin={{ top: 12, right: 16, left: 0, bottom: 8 }}>
              <defs>
                <linearGradient id="oceanBar" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chartColors.bar} stopOpacity={0.95} />
                  <stop offset="100%" stopColor={chartColors.bar} stopOpacity={0.6} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 3" />
              <XAxis
                dataKey="feature"
                stroke={chartColors.axis}
                tick={{ fontSize: 12 }}
                interval={0}
                height={50}
                angle={-15}
                textAnchor="end"
              />
              <YAxis stroke={chartColors.axis} tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#ffffff",
                  border: "1px solid #E5E7EB",
                  borderRadius: 8,
                }}
                formatter={(value) => [value, "Count"]}
              />
              <Legend />
              <Bar dataKey="count" name="Count" fill="url(#oceanBar)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
};

OverallFeaturesChart.propTypes = {
  className: PropTypes.string,
};

export default OverallFeaturesChart;

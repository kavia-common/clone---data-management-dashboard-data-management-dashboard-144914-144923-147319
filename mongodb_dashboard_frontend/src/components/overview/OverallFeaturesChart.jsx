import React, { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { getSessionTracking } from "../../api/sessionTracking";
import Card from "../common/Card";
import LoadingState from "../common/LoadingState";
import ErrorState from "../common/ErrorState";
import OverviewChartFilters from "./OverviewChartFilters";
import { useAuth } from "../../context/AuthContext";
import { buildOverviewFilterParams } from "../../api/buildOverviewFilterParams";
import { ResponsiveContainer, BarChart, XAxis, YAxis, Tooltip, Legend, Bar, CartesianGrid } from "recharts";
import { getOceanTheme } from "../../theme/oceanTheme";
import "./overview.css";

/**
 * PUBLIC_INTERFACE
 * OverallFeaturesChart
 * A responsive chart that aggregates session_tracking records by service_type (feature)
 * within a selected date window based on session_start. It supports Daily/Weekly/Monthly/Custom
 * filters consistent with the Users-by-Tenant chart and uses the organization_id from the
 * logged-in user context. It handles loading/empty/error states and applies the Ocean theme.
 */
const OverallFeaturesChart = ({ className }) => {
  const { user } = useAuth() || {};
  const organizationId = user?.organization_id || user?.tenant_id || user?.tenant || null;

  // Filter state mirrors Users-by-Tenant chart UX:
  // granularity: "day" | "week" | "month" | "custom"
  // For custom, we pass customFrom/customTo ISO strings.
  const [granularity, setGranularity] = useState("day");
  const [customFrom, setCustomFrom] = useState(null);
  const [customTo, setCustomTo] = useState(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [items, setItems] = useState([]);

  // Compute ISO range based on granularity, aligned with Overview filters logic
  const { fromISO, toISO } = useMemo(() => {
    const now = new Date();
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
    let start;
    if (granularity === "day") {
      // last 1 day window (today)
      start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    } else if (granularity === "week") {
      // last 7 days including today
      const s = new Date(end);
      s.setUTCDate(end.getUTCDate() - 6);
      s.setUTCHours(0, 0, 0, 0);
      start = s;
    } else if (granularity === "month") {
      // last 30 days including today
      const s = new Date(end);
      s.setUTCDate(end.getUTCDate() - 29);
      s.setUTCHours(0, 0, 0, 0);
      start = s;
    } else if (granularity === "custom") {
      start = customFrom ? new Date(customFrom) : null;
      // ensure inclusive end-of-day if date only is passed
      const t = customTo ? new Date(customTo) : null;
      const tAdj = t ? new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), 23, 59, 59, 999)) : null;
      return {
        fromISO: start ? start.toISOString() : null,
        toISO: tAdj ? tAdj.toISOString() : null,
      };
    } else {
      start = new Date(end);
      start.setUTCDate(end.getUTCDate() - 6);
      start.setUTCHours(0, 0, 0, 0);
    }
    return { fromISO: start.toISOString(), toISO: end.toISOString() };
  }, [granularity, customFrom, customTo]);

  useEffect(() => {
    let ignore = false;
    async function load() {
      if (!organizationId) {
        setError("Missing organization context.");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        // Build filter for GET /api/session-tracking:
        // filter: { organization_id, session_start: { $gte: fromISO, $lte: toISO } }
        const filter = {};
        if (organizationId) filter.organization_id = organizationId;
        if (fromISO || toISO) {
          filter.session_start = {};
          if (fromISO) filter.session_start.$gte = fromISO;
          if (toISO) filter.session_start.$lte = toISO;
        }

        // Using client wrapper
        const params = {
          filter: JSON.stringify(filter),
          sort: "-session_start",
          limit: 200, // cap to avoid over-fetch; backend returns array when page params omitted
        };

        const res = await getSessionTracking(params);
        const list = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];

        // Group by service_type and count
        const counts = list.reduce((acc, doc) => {
          const key = (doc?.service_type || "Unknown").toString();
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {});

        const itemsShaped = Object.entries(counts)
          .map(([name, count]) => ({ feature: name, count }))
          .sort((a, b) => b.count - a.count);

        if (!ignore) {
          setItems(itemsShaped);
        }
      } catch (e) {
        if (!ignore) setError(e?.message || "Failed to load features usage.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [organizationId, fromISO, toISO]);

  const ocean = getOceanTheme();
  const chartColors = {
    bar: ocean?.colors?.primary || "#2563EB",
    grid: ocean?.colors?.border || "#E5E7EB",
    axis: ocean?.colors?.muted || "#6B7280",
  };

  return (
    <Card className={className} style={{ background: "#ffffff" }}>
      <div className="overview-card-header">
        <div>
          <h3 className="overview-card-title">Overall Features</h3>
          <p className="overview-card-subtitle">Usage distribution by feature (service_type)</p>
        </div>
        <OverviewChartFilters
          granularity={granularity}
          onGranularityChange={setGranularity}
          customFrom={customFrom}
          customTo={customTo}
          onCustomFromChange={setCustomFrom}
          onCustomToChange={setCustomTo}
          showGranularityOptions={{ day: true, week: true, month: true, custom: true }}
        />
      </div>

      {loading && <LoadingState message="Loading features usage..." />}
      {!loading && error && <ErrorState title="Unable to load" description={error} />}
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

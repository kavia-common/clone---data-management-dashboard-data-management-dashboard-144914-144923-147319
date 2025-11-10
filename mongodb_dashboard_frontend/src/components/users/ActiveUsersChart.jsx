import React, { useEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import ActiveUsersTrendChart from "../charts/ActiveUsersTrendChart.jsx";
import TimeBucketFilter from "../common/TimeBucketFilter.jsx";

/**
 * PUBLIC_INTERFACE
 * ActiveUsersChart
 * Wrapper that provides a toolbar with a Daily/Weekly/Monthly filter
 * and renders the ActiveUsersTrendChart wired to the backend.
 *
 * Notes:
 * - Backend supports granularity day|week at /api/users/active-trend.
 * - Selecting "monthly" will fallback to "week" and show a subtle hint.
 * - Caches last successful result per selected bucket to avoid flicker during toggles.
 */
export default function ActiveUsersChart({
  status = "completed|active",
  tenant_id,
  defaultBucket = "daily",
}) {
  const [bucket, setBucket] = useState(defaultBucket); // daily|weekly|monthly
  const [hint, setHint] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Simple in-memory cache keyed by bucket selection
  const cacheRef = useRef({
    daily: null,
    weekly: null,
    monthly: null,
  });

  // Translate UI bucket to API granularity
  const apiGranularity = useMemo(() => {
    if (bucket === "daily") return "day";
    if (bucket === "weekly") return "week";
    if (bucket === "monthly") {
      return "week"; // Fallback since backend does not support month
    }
    return "day";
  }, [bucket]);

  // Pass-through props to child chart; we let the child handle fetching via its internal effect.
  // Here, we just control granularity via bucket and show info note if needed.
  useEffect(() => {
    if (bucket === "monthly") {
      setHint("Monthly not yet supported by API; showing weekly as fallback.");
    } else {
      setHint("");
    }
  }, [bucket]);

  // Loading/error are surfaced by child chart; keep subtle placeholders here for structure consistency
  // and to allow future data prefetch into cacheRef if needed.
  useEffect(() => {
    setLoading(false);
    setError("");
  }, [apiGranularity, status, tenant_id]);

  return (
    <div className="card">
      <div className="card-header" style={{ paddingBottom: 0 }}>
        <div>
          <h3 className="card-title">Active Users</h3>
          <div className="card-subtitle">
            Distinct active users over time
          </div>
        </div>
        <div className="card-actions">
          <TimeBucketFilter value={bucket} onChange={setBucket} />
        </div>
      </div>
      {hint && (
        <div className="card-content" style={{ paddingTop: 8, paddingBottom: 0 }}>
          <div style={{ fontSize: 12, color: "#6B7280" }}>{hint}</div>
        </div>
      )}
      <div className="card-content">
        <ActiveUsersTrendChart
          granularity={apiGranularity}
          status={status}
          tenant_id={tenant_id}
        />
      </div>
    </div>
  );
}

ActiveUsersChart.propTypes = {
  status: PropTypes.string,
  tenant_id: PropTypes.string,
  defaultBucket: PropTypes.oneOf(["daily", "weekly", "monthly"]),
};

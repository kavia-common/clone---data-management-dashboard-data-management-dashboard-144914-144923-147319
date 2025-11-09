import React, { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { getTenantUsersSummary } from "../../api/usersAnalytics";
import "./../../App.css";

/**
 * UsersByTenantBarChart
 * Renders a responsive bar chart showing user_count per tenant.
 * Fetches data using getTenantUsersSummary with support for date range and status filters.
 *
 * PUBLIC_INTERFACE
 * @component
 * @param {Object} props - Component props
 * @param {string} [props.from] - ISO date string lower bound for filtering
 * @param {string} [props.to] - ISO date string upper bound for filtering
 * @param {string} [props.status] - Session status filter (e.g., "completed|active")
 * @param {boolean} [props.includeInactive=false] - Include tenants with no recent activity
 * @param {(item: { tenant_id: string, tenant_name?: string|null, user_count: number }) => void} [props.onBarClick] - Optional click handler for a bar
 * @returns {JSX.Element}
 */
const UsersByTenantBarChart = ({
  from,
  to,
  status,
  includeInactive = false,
  onBarClick,
}) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Fetch data from API
  useEffect(() => {
    let mounted = true;

    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        // getTenantUsersSummary will construct a strict request containing only organization_id
        const res = await getTenantUsersSummary();
        if (!mounted) return;
        const data = Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : [];
        // Sort by user_count desc by default
        const sorted = [...data].sort((a, b) => (b?.user_count || 0) - (a?.user_count || 0));
        setItems(sorted);
      } catch (e) {
        console.error("Failed to load tenant users summary:", e);
        if (!mounted) return;
        setError(e?.message || "Failed to load data");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchData();
    return () => {
      mounted = false;
    };
  }, [from, to, status, includeInactive]);

  // Prepare chart data and scales
  const { maxValue, bars } = useMemo(() => {
    const maxVal = items.reduce((m, it) => Math.max(m, Number(it?.user_count || 0)), 0);
    // compute bar width percentages relative to max
    const computedBars = items.map((it) => {
      const value = Number(it?.user_count || 0);
      const widthPct = maxVal > 0 ? Math.max((value / maxVal) * 100, 2) : 0; // ensure small visibility
      const label = it?.tenant_name?.trim()
        ? it.tenant_name
        : (it?.tenant_id || "Unknown");
      return { ...it, label, value, widthPct };
    });
    return { maxValue: maxVal, bars: computedBars };
  }, [items]);

  if (loading) {
    return (
      <div className="card" style={{ padding: "16px" }}>
        <div className="skeleton" style={{ height: 16, width: "40%", marginBottom: 8 }} />
        <div className="skeleton" style={{ height: 12, width: "60%", marginBottom: 8 }} />
        <div className="skeleton" style={{ height: 12, width: "55%", marginBottom: 8 }} />
        <div className="skeleton" style={{ height: 12, width: "70%", marginBottom: 8 }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ padding: "16px", color: "#EF4444" }}>
        Error loading user counts by tenant: {error}
      </div>
    );
  }

  if (!bars.length) {
    return (
      <div className="card" style={{ padding: "16px" }}>
        <div style={{ color: "#6B7280" }}>No data available for the selected filters.</div>
      </div>
    );
  }

  // Styles aligned with existing minimalist, responsive design
  const containerStyle = {
    background: "#ffffff",
    borderRadius: 12,
    padding: 16,
    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
  };

  const headerStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  };

  const titleStyle = {
    fontSize: 16,
    fontWeight: 600,
    color: "#111827",
  };

  const subtitleStyle = {
    fontSize: 12,
    color: "#6B7280",
  };

  const listStyle = {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  };

  const rowStyle = {
    display: "grid",
    gridTemplateColumns: "minmax(120px, 280px) 1fr auto",
    alignItems: "center",
    gap: 12,
  };

  const labelStyle = {
    fontSize: 13,
    color: "#111827",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };

  const barTrackStyle = {
    position: "relative",
    width: "100%",
    height: 12,
    background: "linear-gradient(to right, rgba(37,99,235,0.08), rgba(107,114,128,0.08))",
    borderRadius: 9999,
    overflow: "hidden",
  };

  const valueStyle = {
    fontSize: 12,
    color: "#111827",
    fontVariantNumeric: "tabular-nums",
  };

  const barFillBase = {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    background: "linear-gradient(90deg, rgba(37,99,235,0.9) 0%, rgba(37,99,235,0.75) 100%)",
  };

  return (
    <div className="card" style={containerStyle}>
      <div style={headerStyle}>
        <div style={titleStyle}>Users by Tenant</div>
        <div style={subtitleStyle}>
          Max: {maxValue} user{maxValue === 1 ? "" : "s"}
        </div>
      </div>

      <div style={listStyle} role="list" aria-label="Users by tenant bar chart">
        {bars.map((it) => {
          const width = `${it.widthPct}%`;
          const tooltip = `${it.label}: ${it.value} user${it.value === 1 ? "" : "s"}`;
          return (
            <div
              key={`${it.tenant_id || it.label}`}
              style={rowStyle}
              className="hover-row"
              role="listitem"
            >
              <div title={it.label} style={labelStyle}>
                {it.label}
              </div>
              <div
                style={barTrackStyle}
                title={tooltip}
                onClick={() => onBarClick && onBarClick(it)}
                className={onBarClick ? "clickable" : undefined}
              >
                <div
                  aria-label={tooltip}
                  style={{ ...barFillBase, width }}
                />
              </div>
              <div style={valueStyle} title={tooltip}>
                {it.value}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

UsersByTenantBarChart.propTypes = {
  from: PropTypes.string,
  to: PropTypes.string,
  status: PropTypes.string,
  includeInactive: PropTypes.bool,
  onBarClick: PropTypes.func,
};

export default UsersByTenantBarChart;

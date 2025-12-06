import React, { useCallback, useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import "./overview.css";
import Card from "../common/Card";
import LoadingState from "../common/LoadingState";
import ErrorState from "../common/ErrorState";
import { oceanColors } from "../charts/chartTheme.extension";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import apiClient from "../../api/client";

const MAX_BARS = 12;

/**
 * PUBLIC_INTERFACE
 * UsersByTenantChart renders a bar chart of total users grouped by tenant.
 * Uses the shared API client for consistent base URL and headers.
 * Provides inline loading, error (with retry), and empty states.
 * Maintains Ocean Professional styling via oceanColors.
 */
export default function UsersByTenantChart({ organization_id }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [items, setItems] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let shaped = [];

      // Prefer aggregated endpoint when available
      let aggregatedOk = false;
      try {
        const aggRes = await apiClient.get("/api/users/tenant-summary", {
          params: organization_id ? { organization_id } : undefined,
        });
        const aggItems = Array.isArray(aggRes?.data?.items) ? aggRes.data.items : [];
        if (aggItems.length > 0) {
          shaped = aggItems.map((it) => ({
            tenant: it.tenant_name || it.tenant_id || "unknown",
            count: typeof it.user_count === "number" ? it.user_count : 0,
          }));
          aggregatedOk = true;
        }
      } catch {
        // fall back to /api/users
      }

      if (!aggregatedOk) {
        const res = await apiClient.get("/api/users", {
          params: organization_id ? { organization_id } : undefined,
        });
        const payload = res?.data;
        const list = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.data)
          ? payload.data
          : Array.isArray(payload?.items)
          ? payload.items
          : [];
        const grouped = list.reduce((acc, u) => {
          const tenant =
            u.organization_id ||
            u.tenant_id ||
            u.organizationId ||
            u.tenant ||
            u.tenantId ||
            "unknown";
          acc[tenant] = (acc[tenant] || 0) + 1;
          return acc;
        }, {});
        shaped = Object.entries(grouped).map(([tenant, count]) => ({ tenant, count }));
      }

      setItems(shaped.sort((a, b) => b.count - a.count).slice(0, MAX_BARS));
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [organization_id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const isEmpty = useMemo(() => !loading && !error && items.length === 0, [loading, error, items]);

  return (
    <Card title="Total Users by Tenant">
      {loading && (
        <div style={{ padding: "8px 0" }}>
          <LoadingState small message="Loading users by tenant..." />
        </div>
      )}

      {error && (
        <div style={{ padding: "8px 0" }}>
          <ErrorState error={error} />
          <div style={{ marginTop: 8 }}>
            <button className="btn btn-secondary" onClick={load}>
              Retry
            </button>
          </div>
        </div>
      )}

      {isEmpty && (
        <div className="empty-state" style={{ padding: "8px 0" }}>
          No users found for this period.
        </div>
      )}

      {!loading && !error && !isEmpty && (
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={items} margin={{ top: 16, right: 24, left: 8, bottom: 32 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="tenant" angle={-30} textAnchor="end" height={60} interval={0} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill={oceanColors.primary} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

UsersByTenantChart.propTypes = {
  /** Optional tenant/org scope. When provided, sent as organization_id query param. */
  organization_id: PropTypes.string,
};

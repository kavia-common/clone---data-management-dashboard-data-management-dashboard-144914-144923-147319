import React, { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import { getModules, getOverviewMetrics } from "../../api/modulesClient.ts";
import UsersByTenantChart from "../../components/charts/UsersByTenantChart.jsx";
import ActiveUsersTrendChart from "../../components/charts/ActiveUsersTrendChart.jsx";

/**
 * PUBLIC_INTERFACE
 * Dashboard Overview: loads metrics and modules and renders them with Ocean Professional styling.
 * - Fetches totals from /api/dashboard/overview/metrics
 * - Fetches modules from modulesClient
 * - Avoids showing erroneous 'No modules found' when any metrics or modules data is present
 */
export default function Overview() {
  const [modules, setModules] = useState([]);
  const [metrics, setMetrics] = useState({ totalUsers: 0, totalDeployedApps: 0 });
  const [loadingModules, setLoadingModules] = useState(true);
  const [loadingMetrics, setLoadingMetrics] = useState(true);
  const [error, setError] = useState("");

  // Initial load
  useEffect(() => {
    let mounted = true;

    const fetchMetrics = async () => {
      setLoadingMetrics(true);
      try {
        const m = await getOverviewMetrics();
        if (mounted) setMetrics(m);
      } catch (e) {
        console.error("Failed to fetch overview metrics", e);
        if (mounted) setMetrics({ totalUsers: 0, totalDeployedApps: 0 });
      } finally {
        if (mounted) setLoadingMetrics(false);
      }
    };

    const fetchModules = async () => {
      setLoadingModules(true);
      setError("");
      try {
        const items = await getModules();
        if (mounted) setModules(Array.isArray(items) ? items : []);
      } catch (e) {
        console.error("Failed to load modules", e);
        if (mounted) setError("Failed to load modules.");
      } finally {
        if (mounted) setLoadingModules(false);
      }
    };

    // Initial fetch
    fetchMetrics();
    fetchModules();

    return () => {
      mounted = false;
    };
  }, []);

  // Lightweight refresh on window focus: always refresh metrics; refresh modules only if none loaded
  useEffect(() => {
    const onFocus = () => {
      // Always refresh metrics on focus to show latest totals
      (async () => {
        try {
          const m = await getOverviewMetrics();
          setMetrics(m);
        } catch (e) {
          // keep previous metrics if fetch fails
        }
      })();

      // Refresh modules only when empty to avoid unnecessary heavier calls
      if (!modules || modules.length === 0) {
        (async () => {
          try {
            const items = await getModules();
            setModules(Array.isArray(items) ? items : []);
          } catch {
            // ignore focus-time errors
          }
        })();
      }
    };

    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, [modules]);

  const loading = loadingModules || loadingMetrics;
  const hasModules = modules && modules.length > 0;
  const hasMetricData =
    metrics && (Number(metrics.totalUsers) > 0 || Number(metrics.totalDeployedApps) > 0);

  // Detect availability for specific widgets
  const hasUsersSummary = useMemo(
    () => modules.some((m) => m.key === "users" || m.title?.toLowerCase?.().includes("users")),
    [modules]
  );

  return (
    <div className="grid" style={{ padding: 16 }}>
      <Card title="Overview" className="block-full">
        {loading && <div>Loading overview…</div>}
        {!loading && error && (
          <div className="error" role="alert" style={{ color: "#b91c1c" }}>
            {error}
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Metrics row */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                gap: 16,
                marginBottom: 16,
              }}
            >
              {/* Total Users Card */}
              <div
                style={{
                  background: "#fff",
                  borderRadius: 12,
                  border: "1px solid #E5E7EB",
                  padding: 16,
                  boxShadow: "0 6px 14px rgba(0,0,0,0.04)",
                }}
              >
                <div style={{ color: "#6B7280", fontSize: 12, fontWeight: 600 }}>
                  Total Users
                </div>
                <div
                  style={{
                    color: "#2563EB",
                    fontSize: 32,
                    fontWeight: 800,
                    letterSpacing: 0.3,
                    marginTop: 6,
                  }}
                  aria-live="polite"
                >
                  {Number(metrics.totalUsers).toLocaleString()}
                </div>
                <div style={{ color: "#9CA3AF", fontSize: 12, marginTop: 6 }}>
                  Across all tenants
                </div>
              </div>

              {/* Total Deployed Apps Card */}
              <div
                style={{
                  background: "#fff",
                  borderRadius: 12,
                  border: "1px solid #E5E7EB",
                  padding: 16,
                  boxShadow: "0 6px 14px rgba(0,0,0,0.04)",
                }}
              >
                <div style={{ color: "#6B7280", fontSize: 12, fontWeight: 600 }}>
                  Total Deployed Apps
                </div>
                <div
                  style={{
                    color: "#F59E0B",
                    fontSize: 32,
                    fontWeight: 800,
                    letterSpacing: 0.3,
                    marginTop: 6,
                  }}
                  aria-live="polite"
                >
                  {Number(metrics.totalDeployedApps).toLocaleString()}
                </div>
                <div style={{ color: "#9CA3AF", fontSize: 12, marginTop: 6 }}>
                  From app deployments
                </div>
              </div>
            </div>

            {/* Charts row */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 16,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  background: "#fff",
                  borderRadius: 12,
                  border: "1px solid #E5E7EB",
                  padding: 16,
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 8, color: "#111827" }}>
                  Active Users Trend
                </div>
                <ActiveUsersTrendChart height={260} />
              </div>

              {hasUsersSummary ? (
                <div
                  style={{
                    background: "#fff",
                    borderRadius: 12,
                    border: "1px solid #E5E7EB",
                    padding: 16,
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 8, color: "#111827" }}>
                    Users by Tenant
                  </div>
                  <UsersByTenantChart height={260} />
                </div>
              ) : (
                <div
                  style={{
                    background: "#fff",
                    borderRadius: 12,
                    border: "1px solid #E5E7EB",
                    padding: 16,
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 8, color: "#111827" }}>
                    Overview Summary
                  </div>
                  <div style={{ color: "#6B7280", fontSize: 14 }}>
                    Users by Tenant chart will appear when user summary data is available.
                  </div>
                </div>
              )}
            </div>

            {/* Fallback tiles / summaries for modules */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                gap: 16,
              }}
            >
              {/* Only show empty note if nothing at all to show */}
              {!hasModules && !hasMetricData && (
                <div>
                  Nothing to display yet. Once data is available, overview widgets will appear
                  automatically.
                </div>
              )}
              {modules.map((m, idx) => (
                <div
                  key={m._id || m.id || m.key || idx}
                  style={{
                    background: "#fff",
                    borderRadius: 12,
                    border: "1px solid #E5E7EB",
                    padding: 16,
                    boxShadow: "0 6px 14px rgba(0,0,0,0.04)",
                  }}
                >
                  <div style={{ fontWeight: 700, color: "#2563EB", marginBottom: 6 }}>
                    {m.title || m.name || m.projectName || "Module"}
                  </div>
                  <div style={{ color: "#4B5563", fontSize: 14, marginBottom: 8 }}>
                    {m.description || m.status || "Details unavailable"}
                  </div>
                  {/* Lightweight metrics if present */}
                  <div style={{ display: "flex", gap: 12, color: "#111827", fontSize: 13 }}>
                    {typeof m.total === "number" && <span>Total: {m.total}</span>}
                    {typeof m.tenants === "number" && <span>Tenants: {m.tenants}</span>}
                    {typeof m.totalUsers === "number" && <span>Users: {m.totalUsers}</span>}
                    {typeof m.recent === "number" && <span>Recent: {m.recent}</span>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

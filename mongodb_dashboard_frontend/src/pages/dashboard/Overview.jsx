import React, { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import { getModules } from "../../api/modulesClient.ts";
import UsersByTenantChart from "../../components/charts/UsersByTenantChart.jsx";
import ActiveUsersTrendChart from "../../components/charts/ActiveUsersTrendChart.jsx";

/**
 * PUBLIC_INTERFACE
 * Dashboard Overview: loads and displays available modules after authentication.
 * Uses credentials-inclusive fetch inside modulesClient.
 * Renders dynamic widgets when recognized modules are available, otherwise shows lightweight tiles.
 */
export default function Overview() {
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const items = await getModules();
        if (mounted) setModules(Array.isArray(items) ? items : []);
      } catch (e) {
        console.error("Failed to load modules", e);
        if (mounted) setError("Failed to load modules.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const hasAny = modules && modules.length > 0;

  // Detect availability for specific widgets
  const hasUsersSummary = useMemo(
    () => modules.some(m => (m.key === 'users') || (m.title?.toLowerCase?.().includes('users'))),
    [modules]
  );
  const hasDeployments = useMemo(
    () => modules.some(m => (m.key === 'deployments') || (m.title?.toLowerCase?.().includes('deployments'))),
    [modules]
  );
  const hasCosts = useMemo(
    () => modules.some(m => (m.key === 'costs') || (m.title?.toLowerCase?.().includes('cost'))),
    [modules]
  );

  return (
    <div className="grid" style={{ padding: 16 }}>
      <Card title="Overview" className="block-full">
        {loading && <div>Loading modules…</div>}
        {error && <div className="error" role="alert" style={{ color: '#b91c1c' }}>{error}</div>}

        {!loading && !error && (
          <>
            {/* Charts row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              {hasUsersSummary ? (
                <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', padding: 16 }}>
                  <div style={{ fontWeight: 700, marginBottom: 8, color: '#111827' }}>Users by Tenant</div>
                  <UsersByTenantChart height={260} />
                </div>
              ) : null}

              <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', padding: 16 }}>
                <div style={{ fontWeight: 700, marginBottom: 8, color: '#111827' }}>Active Users Trend</div>
                <ActiveUsersTrendChart height={260} />
              </div>
            </div>

            {/* Fallback tiles / summaries */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
              {!hasAny && <div>Nothing to display yet. Once data is available, overview widgets will appear automatically.</div>}
              {modules.map((m, idx) => (
                <div key={m._id || m.id || m.key || idx} style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', padding: 16, boxShadow: '0 6px 14px rgba(0,0,0,0.04)' }}>
                  <div style={{ fontWeight: 700, color: '#2563EB', marginBottom: 6 }}>
                    {m.title || m.name || m.projectName || 'Module'}
                  </div>
                  <div style={{ color: '#4B5563', fontSize: 14, marginBottom: 8 }}>
                    {m.description || m.status || 'Details unavailable'}
                  </div>
                  {/* Lightweight metrics if present */}
                  <div style={{ display: 'flex', gap: 12, color: '#111827', fontSize: 13 }}>
                    {typeof m.total === 'number' && <span>Total: {m.total}</span>}
                    {typeof m.tenants === 'number' && <span>Tenants: {m.tenants}</span>}
                    {typeof m.totalUsers === 'number' && <span>Users: {m.totalUsers}</span>}
                    {typeof m.recent === 'number' && <span>Recent: {m.recent}</span>}
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

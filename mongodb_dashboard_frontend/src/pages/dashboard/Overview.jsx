import React, { useEffect, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import { getModules } from "../../api/modulesClient.ts";

/**
 * PUBLIC_INTERFACE
 * Dashboard Overview: loads and displays available modules after authentication.
 * Uses credentials-inclusive fetch inside modulesClient.
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

  return (
    <div className="grid" style={{ padding: 16 }}>
      <Card title="Overview" className="block-full">
        {loading && <div>Loading modules…</div>}
        {error && <div className="error" role="alert" style={{ color: '#b91c1c' }}>{error}</div>}
        {!loading && !error && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
            {modules.length === 0 && <div>No modules found.</div>}
            {modules.map((m, idx) => (
              <div key={m._id || m.id || idx} style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', padding: 16, boxShadow: '0 6px 14px rgba(0,0,0,0.04)' }}>
                <div style={{ fontWeight: 700, color: '#2563EB', marginBottom: 6 }}>
                  {m.title || m.name || m.projectName || 'Module'}
                </div>
                <div style={{ color: '#4B5563', fontSize: 14 }}>
                  {m.description || m.status || 'Details unavailable'}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

import React, { useEffect, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import KPIChart from "../../components/charts/KPIChart.jsx";
import { listUsers, listSessions, listDeployments } from "../../api/client";

// PUBLIC_INTERFACE
export default function Overview() {
  /** Overview page with basic metrics and activity trends. */
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState({ users: 0, sessions: 0, deployments: 0 });
  const [trend, setTrend] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError("");
      try {
        const [users, sessions, deployments] = await Promise.all([
          listUsers({ limit: 5 }),
          listSessions({ limit: 5 }),
          listDeployments({ limit: 5 }),
        ]);
        setMetrics({
          users: (users?.total || users?.length || 0),
          sessions: (sessions?.total || sessions?.length || 0),
          deployments: (deployments?.total || deployments?.length || 0),
        });
        const t = [
          { label: "Mon", value: (users?.length || 1) * 1 },
          { label: "Tue", value: (sessions?.length || 2) * 2 },
          { label: "Wed", value: (deployments?.length || 3) * 3 },
          { label: "Thu", value: (users?.length || 2) * 2 },
          { label: "Fri", value: (sessions?.length || 1) * 1 },
          { label: "Sat", value: (deployments?.length || 1) * 1 },
          { label: "Sun", value: (users?.length || 1) + (sessions?.length || 1) },
        ];
        setTrend(t);
      } catch (e) {
        setError(e?.response?.data?.message || e?.message || "Failed to load overview data.");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  return (
    <div className="grid">
      <Card title="Users" subtitle="Total referral users" className="kpi-card">
        <div className="kpi">
          <div className="kpi-value">{metrics.users}</div>
          <div className="kpi-label">Users</div>
        </div>
      </Card>
      <Card title="Sessions" subtitle="Active and historical sessions" className="kpi-card">
        <div className="kpi">
          <div className="kpi-value">{metrics.sessions}</div>
          <div className="kpi-label">Sessions</div>
        </div>
      </Card>
      <Card title="Deployments" subtitle="Recent app deployments" className="kpi-card">
        <div className="kpi">
          <div className="kpi-value">{metrics.deployments}</div>
          <div className="kpi-label">Deployments</div>
        </div>
      </Card>

      <Card title="Activity trend" subtitle="Weekly activity overview" className="col-span-3">
        <div className="toolbar" aria-label="Overview toolbar">
          <input className="input-search" placeholder="Search..." aria-label="Search" />
          <div className="spacer" />
          <button className="btn btn-primary">+ Quick Action</button>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        {loading ? <div>Loading...</div> : <KPIChart data={trend} xKey="label" yKey="value" />}
      </Card>
    </div>
  );
}

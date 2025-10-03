import React, { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import KPIChart from "../../components/charts/KPIChart.jsx";
import Button from "../../components/ui/Button.jsx";
import { listUsers, listSessions, listDeployments } from "../../api/client";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

/**
 * PUBLIC_INTERFACE
 * Overview
 * Displays top-level KPIs and a counts chart for Users, Sessions, and Deployments.
 * Fetches list endpoints and uses their totals/lengths to compute aggregate counts.
 */
export default function Overview() {
  /** Overview page with basic metrics and activity trends + counts chart. */
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState({ users: 0, sessions: 0, deployments: 0 });
  const [trend, setTrend] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError("");
      try {
        // Fetch small samples; we only need totals. API normalizer returns { items, total, meta }
        const [usersRes, sessionsRes, deploymentsRes] = await Promise.all([
          listUsers({ page: 1, limit: 1 }),
          listSessions({ page: 1, limit: 1 }),
          listDeployments({ page: 1, limit: 1 }),
        ]);

        const usersCount = usersRes?.total ?? (Array.isArray(usersRes) ? usersRes.length : 0);
        const sessionsCount = sessionsRes?.total ?? (Array.isArray(sessionsRes) ? sessionsRes.length : 0);
        const deploymentsCount = deploymentsRes?.total ?? (Array.isArray(deploymentsRes) ? deploymentsRes.length : 0);

        setMetrics({
          users: usersCount,
          sessions: sessionsCount,
          deployments: deploymentsCount,
        });

        // Keep the existing weekly trend placeholder (visual flair)
        const t = [
          { label: "Mon", value: Math.max(1, usersCount % 7) },
          { label: "Tue", value: Math.max(1, sessionsCount % 7) },
          { label: "Wed", value: Math.max(1, deploymentsCount % 7) },
          { label: "Thu", value: Math.max(1, (usersCount + sessionsCount) % 7) },
          { label: "Fri", value: Math.max(1, (sessionsCount + deploymentsCount) % 7) },
          { label: "Sat", value: Math.max(1, (deploymentsCount + usersCount) % 7) },
          { label: "Sun", value: Math.max(1, (usersCount + sessionsCount + deploymentsCount) % 7) },
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

  // Prepare data for counts bar chart
  const countsData = useMemo(
    () => [
      { name: "Users", count: metrics.users },
      { name: "Sessions", count: metrics.sessions },
      { name: "Deployments", count: metrics.deployments },
    ],
    [metrics]
  );

  const brandBlue = "#2563EB";   // primary per Ocean Professional
  const accentAmber = "#F59E0B"; // for hover/fill gradient accents if needed
  const gridStroke = "rgba(0,0,0,0.08)";

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

      <Card title="Overview counts" subtitle="Users vs Sessions vs Deployments" className="block-full">
        {error && <div className="error" role="alert">{error}</div>}
        {loading ? (
          <div>Loading...</div>
        ) : (
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={countsData} margin={{ top: 8, right: 24, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar
                  dataKey="count"
                  name="Count"
                  radius={[8, 8, 0, 0]}
                  fill={brandBlue}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card title="Activity trend" subtitle="Weekly activity overview" className="block-full">
        {error && <div className="error" role="alert">{error}</div>}
        {loading ? <div>Loading...</div> : <KPIChart data={trend} xKey="label" yKey="value" color={accentAmber} />}
      </Card>
    </div>
  );
}

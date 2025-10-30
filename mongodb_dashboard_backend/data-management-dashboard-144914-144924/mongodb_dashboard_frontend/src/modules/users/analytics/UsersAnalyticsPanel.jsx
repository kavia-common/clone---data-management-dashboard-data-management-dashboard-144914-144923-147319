import React, { useEffect, useState } from 'react';
import { Card, Spin, Alert } from 'antd';
import UsersSummaryCards from './UsersSummaryCards';
import UsersActivityChart from './UsersActivityChart';
import {
  getActiveUsersTrend,
  getKpiSummary,
  getUsersByDepartment,
  getUsersByOrganization,
  getUsersCompliance
} from '../../../api/usersAnalytics';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend
} from 'recharts';

const COLORS = ['#2563EB', '#F59E0B', '#10B981', '#EF4444', '#6366F1', '#14B8A6', '#F97316'];

const PanelSection = ({ title, children, extra }) => (
  <Card title={title} extra={extra} style={{ marginBottom: 16 }}>
    {children}
  </Card>
);

export default function UsersAnalyticsPanel() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const [kpi, setKpi] = useState(null);
  const [trend, setTrend] = useState([]);
  const [byDept, setByDept] = useState([]);
  const [byOrg, setByOrg] = useState([]);
  const [compliance, setCompliance] = useState([]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setErr(null);
    const params = {}; // could wire date filters later
    Promise.all([
      getKpiSummary(params),
      getActiveUsersTrend(params),
      getUsersByDepartment(params),
      getUsersByOrganization(params),
      getUsersCompliance(params)
    ])
      .then(([kpiRes, trendRes, deptRes, orgRes, compRes]) => {
        if (!mounted) return;
        setKpi(kpiRes || null);
        setTrend(trendRes?.items || []);
        setByDept(deptRes?.items || []);
        setByOrg(orgRes?.items || []);
        setCompliance(compRes?.items || []);
      })
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.error(e);
        if (mounted) setErr(e?.message || 'Failed to load analytics');
      })
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, []);

  if (loading) {
    return (
      <Card>
        <Spin />
      </Card>
    );
  }
  if (err) {
    return (
      <Card>
        <Alert type="error" message="Failed to load users analytics" description={err} />
      </Card>
    );
  }

  return (
    <div>
      <UsersSummaryCards data={kpi} />

      <PanelSection title="Active Users Trend">
        <UsersActivityChart data={trend} />
      </PanelSection>

      <PanelSection title="Users by Department">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={byDept}>
            <XAxis dataKey="department" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" fill={COLORS[0]} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </PanelSection>

      <PanelSection title="Users by Organization">
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={byOrg}
              dataKey="count"
              nameKey="organization_id"
              cx="50%"
              cy="50%"
              outerRadius={100}
              label
            >
              {byOrg.map((entry, index) => (
                <Cell key={`cell-org-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </PanelSection>

      <PanelSection title="Compliance">
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie
              data={compliance}
              dataKey="count"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={90}
              label
            >
              {compliance.map((entry, index) => (
                <Cell key={`cell-comp-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </PanelSection>
    </div>
  );
}

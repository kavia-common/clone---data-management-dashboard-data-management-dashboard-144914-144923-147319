import React from 'react';
import { Row, Col, Card, Statistic } from 'antd';

type Kpi = {
  totalUsers?: number;
  activeUsers?: number;
  inactiveUsers?: number;
  adminUsers?: number;
  departmentsCount?: number;
  organizationsCount?: number;
  dau?: number;
  wau?: number;
  mau?: number;
};

interface Props {
  data?: Kpi | null;
}

// PUBLIC_INTERFACE
export default function UsersSummaryCards({ data }: Props) {
  /** Renders KPI summary cards for users analytics */
  const k = data || {};
  const items = [
    { title: 'Total Users', value: k.totalUsers || 0 },
    { title: 'Active Users', value: k.activeUsers || 0 },
    { title: 'Inactive Users', value: k.inactiveUsers || 0 },
    { title: 'Admin Users', value: k.adminUsers || 0 },
    { title: 'Departments', value: k.departmentsCount || 0 },
    { title: 'Organizations', value: k.organizationsCount || 0 },
    { title: 'DAU', value: k.dau || 0 },
    { title: 'WAU', value: k.wau || 0 },
    { title: 'MAU', value: k.mau || 0 },
  ];

  return (
    <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
      {items.map((it) => (
        <Col key={it.title} xs={24} sm={12} md={8} lg={6}>
          <Card>
            <Statistic title={it.title} value={it.value} />
          </Card>
        </Col>
      ))}
    </Row>
  );
}

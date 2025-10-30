import React from 'react';

export interface SummaryValue {
  value: number;
  changePct: number;
}

export interface UsersSummaryCardsProps {
  dau?: SummaryValue;
  wau?: SummaryValue;
  mau?: SummaryValue;
  loading?: boolean;
}

function Delta({ pct }: { pct: number }) {
  const up = pct > 0;
  const color = up ? '#10B981' : pct < 0 ? '#EF4444' : '#6B7280';
  const arrow = up ? '▲' : pct < 0 ? '▼' : '■';
  return (
    <span style={{ color, fontWeight: 600, marginLeft: 8 }}>
      {arrow} {pct.toFixed(1)}%
    </span>
  );
}

function Card({
  title,
  val,
  loading,
}: {
  title: string;
  val?: SummaryValue;
  loading?: boolean;
}) {
  return (
    <div
      style={{
        background: '#ffffff',
        padding: 16,
        borderRadius: 8,
        boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
        minWidth: 180,
        flex: 1,
      }}
    >
      <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 6 }}>{title}</div>
      <div style={{ display: 'flex', alignItems: 'baseline' }}>
        <div style={{ fontSize: 24, fontWeight: 700, color: '#111827' }}>
          {loading ? '…' : (val?.value ?? 0)}
        </div>
        {!loading && val && <Delta pct={val.changePct} />}
      </div>
    </div>
  );
}

const UsersSummaryCards: React.FC<UsersSummaryCardsProps> = ({ dau, wau, mau, loading }) => {
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <Card title="DAU" val={dau} loading={loading} />
      <Card title="WAU" val={wau} loading={loading} />
      <Card title="MAU" val={mau} loading={loading} />
    </div>
  );
};

export default UsersSummaryCards;

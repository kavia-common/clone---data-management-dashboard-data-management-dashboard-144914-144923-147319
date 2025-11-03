import React, { useEffect, useMemo, useState } from 'react';
import { fetchFeatureUsage, FeatureSeries, FeatureUsageResponse } from '../../services/analyticsApi';

// Using recharts if available in project; otherwise, fall back to a simple SVG
// The existing frontend uses plain React with custom components; not seeing recharts imports in repo.
// We'll implement a lightweight SVG line chart to avoid adding dependencies.

type Props = {
  initialServiceType?: string;
};

type ChartPoint = { date: string; [series: string]: number | string };

function toDateLabel(iso: string) {
  return iso.slice(0, 10);
}

function buildDataset(resp: FeatureUsageResponse): {
  data: ChartPoint[];
  most?: FeatureSeries;
  least?: FeatureSeries;
} {
  const { features, mostUsed, leastUsed } = resp;
  const most = features.find(f => f.name === mostUsed);
  const least = features.find(f => f.name === leastUsed);

  const allDates = most?.series.map(p => p.t) || least?.series.map(p => p.t) || [];
  const dateLabels = allDates.map(toDateLabel);

  const data: ChartPoint[] = dateLabels.map((label, idx) => {
    const row: ChartPoint = { date: label };
    if (most) row[most.name] = most.series[idx]?.count ?? 0;
    if (least) row[least.name] = least.series[idx]?.count ?? 0;
    return row;
  });

  return { data, most, least };
}

function getColor(name: string, type: 'most' | 'least') {
  // Ocean Professional theme colors
  if (type === 'most') return '#2563EB'; // primary blue
  return '#F59E0B'; // amber secondary
}

export const FeatureUsageChart: React.FC<Props> = ({ initialServiceType }) => {
  const [serviceType, setServiceType] = useState(initialServiceType || '');
  const [interval, setInterval] = useState<'day' | 'week'>('day');
  const [from, setFrom] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString();
  });
  const [to, setTo] = useState<string>(() => new Date().toISOString());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resp, setResp] = useState<FeatureUsageResponse | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchFeatureUsage({
          serviceType: serviceType || undefined,
          from,
          to,
          interval
        });
        if (mounted) setResp(data);
      } catch (e: any) {
        if (mounted) setError(e?.response?.data?.error || e?.message || 'Failed to load');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [serviceType, from, to, interval]);

  const { data, most, least } = useMemo(() => (resp ? buildDataset(resp) : { data: [], most: undefined, least: undefined }), [resp]);

  const hasLines = !!most || !!least;

  return (
    <div style={{ background: '#ffffff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', padding: 16 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, color: '#111827' }}>Feature usage over time</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label>
            Service Type:
            <input
              placeholder="e.g., chat"
              value={serviceType}
              onChange={e => setServiceType(e.target.value)}
              style={{ marginLeft: 6, padding: '6px 8px', borderRadius: 8, border: '1px solid #e5e7eb' }}
            />
          </label>
          <label>
            From:
            <input
              type="date"
              value={from.slice(0, 10)}
              onChange={e => setFrom(new Date(e.target.value + 'T00:00:00Z').toISOString())}
              style={{ marginLeft: 6, padding: '6px 8px', borderRadius: 8, border: '1px solid #e5e7eb' }}
            />
          </label>
          <label>
            To:
            <input
              type="date"
              value={to.slice(0, 10)}
              onChange={e => setTo(new Date(e.target.value + 'T23:59:59Z').toISOString())}
              style={{ marginLeft: 6, padding: '6px 8px', borderRadius: 8, border: '1px solid #e5e7eb' }}
            />
          </label>
          <label>
            Interval:
            <select
              value={interval}
              onChange={e => setInterval(e.target.value as 'day' | 'week')}
              style={{ marginLeft: 6, padding: '6px 8px', borderRadius: 8, border: '1px solid #e5e7eb' }}
            >
              <option value="day">Day</option>
              <option value="week">Week</option>
            </select>
          </label>
        </div>
      </div>

      {loading && <div style={{ padding: 24, color: '#6b7280' }}>Loading feature usage…</div>}
      {error && <div style={{ padding: 24, color: '#EF4444' }}>Error: {error}</div>}

      {!loading && !error && !hasLines && <div style={{ padding: 24, color: '#6b7280' }}>No data available for the selected range.</div>}

      {!loading && !error && hasLines && (
        <div style={{ marginTop: 16 }}>
          <Legend mostName={most?.name} leastName={least?.name} />
          <MiniLineChart data={data} mostName={most?.name} leastName={least?.name} />
        </div>
      )}
    </div>
  );
};

const Legend: React.FC<{ mostName?: string; leastName?: string }> = ({ mostName, leastName }) => {
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center', paddingBottom: 8 }}>
      {mostName && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 12, background: getColor(mostName, 'most'), borderRadius: 2 }} /> Most used: {mostName}
        </span>
      )}
      {leastName && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 12, background: getColor(leastName, 'least'), borderRadius: 2 }} /> Least used: {leastName}
        </span>
      )}
    </div>
  );
};

// Minimal SVG line chart
const MiniLineChart: React.FC<{ data: ChartPoint[]; mostName?: string; leastName?: string }> = ({ data, mostName, leastName }) => {
  const width = Math.max(320, Math.min(900, (typeof window !== 'undefined' ? window.innerWidth : 900) - 120));
  const height = 260;
  const padding = { top: 16, right: 16, bottom: 28, left: 36 };

  const seriesNames = [mostName, leastName].filter(Boolean) as string[];

  const allValues = data.flatMap(row => seriesNames.map(s => (row[s] as number) || 0));
  const maxY = Math.max(1, ...allValues);
  const stepX = (width - padding.left - padding.right) / Math.max(1, data.length - 1);

  function yScale(v: number) {
    const h = height - padding.top - padding.bottom;
    return padding.top + h - (v / maxY) * h;
  }

  function xPos(index: number) {
    return padding.left + index * stepX;
  }

  function pathForSeries(name: string) {
    const points = data.map((row, i) => {
      const v = (row[name] as number) || 0;
      return `${i === 0 ? 'M' : 'L'} ${xPos(i)} ${yScale(v)}`;
    });
    return points.join(' ');
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={width} height={height} role="img" aria-label="Feature usage line chart">
        {/* Axes */}
        <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} stroke="#e5e7eb" />
        <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} stroke="#e5e7eb" />

        {/* Y ticks */}
        {Array.from({ length: 5 }).map((_, i) => {
          const yVal = Math.round((maxY * i) / 4);
          const y = yScale(yVal);
          return (
            <g key={i}>
              <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="#f3f4f6" />
              <text x={padding.left - 8} y={y + 4} fontSize={10} textAnchor="end" fill="#6b7280">
                {yVal}
              </text>
            </g>
          );
        })}

        {/* X labels */}
        {data.map((row, i) => {
          const x = xPos(i);
          const showLabel = i === 0 || i === data.length - 1 || (data.length > 12 ? i % Math.ceil(data.length / 6) === 0 : true);
          return (
            <text key={i} x={x} y={height - padding.bottom + 18} fontSize={10} textAnchor="middle" fill="#6b7280">
              {showLabel ? row.date : ''}
            </text>
          );
        })}

        {/* Lines */}
        {mostName && (
          <path d={pathForSeries(mostName)} fill="none" stroke={getColor(mostName, 'most')} strokeWidth={2.5} />
        )}
        {leastName && (
          <path d={pathForSeries(leastName)} fill="none" stroke={getColor(leastName, 'least')} strokeWidth={2.5} strokeDasharray="6 4" />
        )}
      </svg>
    </div>
  );
};

export default FeatureUsageChart;

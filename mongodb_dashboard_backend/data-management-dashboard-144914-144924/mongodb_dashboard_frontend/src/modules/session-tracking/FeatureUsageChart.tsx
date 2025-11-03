import React, { useEffect, useMemo, useState } from "react";
import { fetchSessionsByType } from "../../services/analyticsApi";

// Lightweight SVG chart renderer to avoid external deps
type SeriesItem = { date: string; series: Record<string, number>; total: number };

type Props = {
  from?: string;
  to?: string;
  tenantId?: string;
  granularity?: "day" | "week" | "month";
};

function colorFor(idx: number) {
  return `hsl(${(idx * 67) % 360}, 70%, 45%)`;
}

const MiniLineChart: React.FC<{ data: Array<{ date: string; [k: string]: number | string }>; seriesNames: string[] }> = ({
  data,
  seriesNames,
}) => {
  const width = Math.max(320, Math.min(900, (typeof window !== "undefined" ? window.innerWidth : 900) - 140));
  const height = 260;
  const padding = { top: 16, right: 16, bottom: 28, left: 36 };

  const allValues = data.flatMap((row) => seriesNames.map((s) => (row[s] as number) || 0));
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
      return `${i === 0 ? "M" : "L"} ${xPos(i)} ${yScale(v)}`;
    });
    return points.join(" ");
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={width} height={height} role="img" aria-label="Sessions by Type line chart">
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
              {showLabel ? (row.date as string) : ""}
            </text>
          );
        })}

        {/* Lines */}
        {seriesNames.map((name, idx) => (
          <path key={name} d={pathForSeries(name)} fill="none" stroke={colorFor(idx)} strokeWidth={2.2} />
        ))}
      </svg>
    </div>
  );
};

export default function FeatureUsageChart({ from, to, tenantId, granularity = "day" }: Props) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<SeriesItem[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    fetchSessionsByType({ from, to, tenant_id: tenantId, granularity })
      .then((data) => {
        if (!mounted) return;
        const arr = (data?.items as SeriesItem[]) || [];
        const metaTypes = data?.meta?.types || [];
        setItems(arr);
        setTypes(metaTypes);
        if (!arr.length) {
          console.warn("FeatureUsageChart: empty items from API", { from, to, tenantId, granularity });
        } else if (metaTypes.length === 0) {
          console.warn("FeatureUsageChart: meta.types is empty; using keys from first item");
          const inferred = Object.keys(arr[0]?.series || {});
          setTypes(inferred);
        }
      })
      .catch((e) => {
        setError(e?.message || "Failed to load");
        console.error("FeatureUsageChart error", e);
      })
      .finally(() => setLoading(false));
    return () => {
      mounted = false;
    };
  }, [from, to, tenantId, granularity]);

  // Derive most-used and least-used types
  const { mostUsedTypes, leastUsedTypes } = useMemo(() => {
    const totalsByType: Record<string, number> = {};
    const seriesKeys = types.length ? types : Object.keys(items?.[0]?.series || {});
    for (const t of seriesKeys) totalsByType[t] = 0;
    for (const it of items) {
      for (const t of seriesKeys) totalsByType[t] += it.series?.[t] ?? 0;
    }
    const sorted = Object.entries(totalsByType).sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const most = sorted.slice(0, Math.min(5, sorted.length));
    const least = sorted.slice(-5);
    return { mostUsedTypes: most, leastUsedTypes: least };
  }, [items, types]);

  const chartDataAll = useMemo(() => {
    const data = items.map((i) => {
      const row: any = { date: i.date };
      const keys = types.length ? types : Object.keys(i.series || {});
      for (const k of keys) row[k] = i.series?.[k] ?? 0;
      return row;
    });
    const seriesNames = types.length ? types : Object.keys(items?.[0]?.series || {});
    return { data, seriesNames };
  }, [items, types]);

  const chartDataMost = useMemo(() => {
    const data = items.map((i) => {
      const row: any = { date: i.date };
      for (const k of mostUsedTypes) row[k] = i.series?.[k] ?? 0;
      return row;
    });
    return { data, seriesNames: mostUsedTypes };
  }, [items, mostUsedTypes]);

  const chartDataLeast = useMemo(() => {
    const data = items.map((i) => {
      const row: any = { date: i.date };
      for (const k of leastUsedTypes) row[k] = i.series?.[k] ?? 0;
      return row;
    });
    return { data, seriesNames: leastUsedTypes };
  }, [items, leastUsedTypes]);

  const trulyEmpty = !items?.length;

  if (loading) return <div className="p-4 text-gray-600">Loading...</div>;
  if (error) return <div className="p-4 text-red-500">{error}</div>;
  if (trulyEmpty) return <div className="p-4 text-gray-500">No session data in the selected range.</div>;

  return (
    <div className="p-4 bg-white rounded-md shadow space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-2">Sessions by Type — All</h3>
        <MiniLineChart data={chartDataAll.data} seriesNames={chartDataAll.seriesNames} />
      </div>
      <div>
        <h3 className="text-sm font-medium mb-2">Most-used Types</h3>
        {chartDataMost.seriesNames.length ? (
          <MiniLineChart data={chartDataMost.data} seriesNames={chartDataMost.seriesNames} />
        ) : (
          <div className="text-gray-500">Not enough data to determine most-used types.</div>
        )}
      </div>
      <div>
        <h3 className="text-sm font-medium mb-2">Least-used Types</h3>
        {chartDataLeast.seriesNames.length ? (
          <MiniLineChart data={chartDataLeast.data} seriesNames={chartDataLeast.seriesNames} />
        ) : (
          <div className="text-gray-500">Not enough data to determine least-used types.</div>
        )}
      </div>
    </div>
  );
}

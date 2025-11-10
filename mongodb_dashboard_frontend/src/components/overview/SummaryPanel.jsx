import React, { useMemo } from 'react';
import Card from '../ui/Card.jsx';
import Skeleton from '../ui/Skeleton.jsx';

/**
 * PUBLIC_INTERFACE
 * SummaryPanel
 * Displays Top 3 insights derived from the same data as the Weekly activity overview:
 *  1) Most used service (by total count across buckets)
 *  2) Fastest growing service (largest positive delta between the last two buckets)
 *  3) Peak day (date/label with the highest total activity)
 *
 * Inputs:
 * - buckets: Array of time buckets used by the Weekly activity chart. Expected shape per item:
 *   { label: string, value: number, services?: Record<string, number> | Array<{ name|service, count|value }> }
 *   - services is optional; when present, it may be a map or array and will be normalized.
 * - loading: boolean - displays skeletons while loading
 * - className?: string - optional CSS class name
 *
 * Behavior:
 * - If no per-service information is available, the service-based insights degrade gracefully to "Not available".
 * - Peak day is derived from the highest "value" among provided buckets.
 */
export default function SummaryPanel({ buckets = [], loading = false, className = '' }) {
  // Normalize services per bucket into a consistent map<string, number>
  const normalized = useMemo(() => {
    const normBuckets = (buckets || []).map((b) => {
      let servicesMap = null;
      // if services is a map-like object
      if (b && b.services && !Array.isArray(b.services) && typeof b.services === 'object') {
        servicesMap = {};
        Object.entries(b.services).forEach(([k, v]) => {
          if (k == null) return;
          const key = String(k);
          const num = typeof v === 'number' ? v : Number(v);
          if (Number.isFinite(num)) servicesMap[key] = (servicesMap[key] || 0) + num;
        });
      }
      // if services is an array like [{ name|service, count|value }]
      if (!servicesMap && Array.isArray(b?.services)) {
        servicesMap = {};
        b.services.forEach((item) => {
          const name = item?.service || item?.name || item?._id || 'Unknown';
          const rawCount = item?.count ?? item?.value ?? 0;
          const num = typeof rawCount === 'number' ? rawCount : Number(rawCount);
          if (!Number.isFinite(num)) return;
          servicesMap[name] = (servicesMap[name] || 0) + num;
        });
      }
      return { label: b?.label ?? '', value: Number(b?.value ?? 0) || 0, services: servicesMap };
    });
    return normBuckets;
  }, [buckets]);

  // Aggregate total per service across all buckets
  const totalsByService = useMemo(() => {
    const agg = {};
    normalized.forEach((b) => {
      if (!b?.services) return;
      Object.entries(b.services).forEach(([svc, cnt]) => {
        const n = typeof cnt === 'number' ? cnt : Number(cnt);
        if (Number.isFinite(n)) {
          agg[svc] = (agg[svc] || 0) + n;
        }
      });
    });
    return agg;
  }, [normalized]);

  // Compute "Most used service" by total count
  const mostUsedService = useMemo(() => {
    const entries = Object.entries(totalsByService);
    if (entries.length === 0) return { label: 'Most used service', value: 'Not available' };
    const top = entries.sort((a, b) => b[1] - a[1])[0];
    return { label: 'Most used service', value: `${top[0]} (${Number(top[1]).toLocaleString()})` };
  }, [totalsByService]);

  // Compute "Fastest growing service" using last two buckets delta
  const fastestGrowingService = useMemo(() => {
    if (!normalized || normalized.length < 2) {
      return { label: 'Fastest growing service', value: 'Not available' };
    }
    const last = normalized[normalized.length - 1];
    const prev = normalized[normalized.length - 2];
    if (!last?.services || !prev?.services) {
      return { label: 'Fastest growing service', value: 'Not available' };
    }
    // union of services present in either of the last two buckets
    const serviceKeys = Array.from(
      new Set([...Object.keys(prev.services || {}), ...Object.keys(last.services || {})]),
    );
    let best = null;
    serviceKeys.forEach((svc) => {
      const a = Number(prev.services?.[svc] ?? 0) || 0;
      const b = Number(last.services?.[svc] ?? 0) || 0;
      const delta = b - a;
      if (!best || delta > best.delta) {
        best = { svc, delta };
      }
    });
    if (!best || !Number.isFinite(best.delta)) {
      return { label: 'Fastest growing service', value: 'Not available' };
    }
    if (best.delta <= 0) {
      // If no positive growth, fall back to the largest delta (even if zero/negative) for transparency
      const fallback = serviceKeys
        .map((svc) => {
          const a = Number(prev.services?.[svc] ?? 0) || 0;
          const b = Number(last.services?.[svc] ?? 0) || 0;
          return { svc, delta: b - a };
        })
        .sort((x, y) => y.delta - x.delta)[0];
      if (!fallback) return { label: 'Fastest growing service', value: 'Not available' };
      return { label: 'Fastest growing service', value: `${fallback.svc} (${fallback.delta >= 0 ? '+' : ''}${fallback.delta})` };
    }
    return { label: 'Fastest growing service', value: `${best.svc} (+${best.delta})` };
  }, [normalized]);

  // Compute "Peak day" from the highest bucket.value
  const peakDay = useMemo(() => {
    if (!normalized || normalized.length === 0) {
      return { label: 'Peak day', value: 'Not available' };
    }
    const peak = normalized.reduce((acc, b) => {
      if (!acc || (b?.value ?? 0) > (acc?.value ?? 0)) return b;
      return acc;
    }, null);
    if (!peak) return { label: 'Peak day', value: 'Not available' };
    // If label resembles a date string, just display label; otherwise show label with value
    const txt = peak.label ? `${peak.label} (${Number(peak.value).toLocaleString()})` : Number(peak.value).toLocaleString();
    return { label: 'Peak day', value: txt };
  }, [normalized]);

  const items = [mostUsedService, fastestGrowingService, peakDay];

  return (
    <Card title="Summary" subtitle="Key insights from recent activity" className={className}>
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
          <Skeleton height={72} />
          <Skeleton height={72} />
          <Skeleton height={72} />
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
          {items.map((it) => (
            <div
              key={it.label}
              style={{
                border: '1px solid var(--ocean-border, #E5E7EB)',
                borderRadius: 12,
                padding: 14,
                background: 'var(--ocean-surface, #ffffff)',
                boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ fontSize: 12, color: 'var(--ocean-muted, #6B7280)', fontWeight: 600 }}>
                {it.label}
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ocean-text, #111827)' }}>
                {it.value}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

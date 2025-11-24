//
// PUBLIC_INTERFACE
// Utility helpers to bucket session timestamps by day/week and fill missing intervals.
//
/**
 * Bucket JS Date or ISO string timestamps by day (YYYY-MM-DD).
 * @param {Array<string|Date>} timestamps
 * @returns {Map<string, number>} map keyed by YYYY-MM-DD with counts
 */
export function bucketByDay(timestamps = []) {
  const map = new Map();
  timestamps.forEach((t) => {
    const d = new Date(t);
    if (isNaN(d)) return;
    d.setHours(0, 0, 0, 0);
    const key = toYMD(d);
    map.set(key, (map.get(key) || 0) + 1);
  });
  return map;
}

/**
 * Bucket timestamps by ISO week starting Monday; key is YYYY-MM-DD (week start).
 * @param {Array<string|Date>} timestamps
 * @returns {Map<string, number>}
 */
export function bucketByWeek(timestamps = []) {
  const map = new Map();
  timestamps.forEach((t) => {
    const d = startOfWeek(t);
    const key = toYMD(d);
    map.set(key, (map.get(key) || 0) + 1);
  });
  return map;
}

/**
 * Fill a bucket map across a date range and return series [{ label, value }]
 * @param {Map<string, number>} map
 * @param {string|Date} start
 * @param {string|Date} end
 * @param {'daily'|'weekly'} granularity
 * @returns {Array<{label: string, value: number}>}
 */
export function fillSeries(map, start, end, granularity = 'daily') {
  const s = new Date(start);
  const e = new Date(end);
  if (isNaN(s) || isNaN(e)) return [];
  s.setHours(0, 0, 0, 0);
  e.setHours(23, 59, 59, 999);
  const series = [];
  if (granularity === 'weekly') {
    let c = startOfWeek(s);
    while (c <= e) {
      const key = toYMD(c);
      series.push({ label: key, value: map.get(key) || 0 });
      c = new Date(c);
      c.setDate(c.getDate() + 7);
    }
  } else {
    let c = new Date(s);
    while (c <= e) {
      const key = toYMD(c);
      series.push({ label: key, value: map.get(key) || 0 });
      c = new Date(c);
      c.setDate(c.getDate() + 1);
    }
  }
  return series;
}

// Helpers
export function toYMD(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

export function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const diff = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

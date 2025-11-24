const AnalyticsService = require('../services/analytics');

/**
 * PUBLIC_INTERFACE
 * overviewMetrics
 * Controller: returns overview KPIs and time-bucketed series.
 * Query params:
 * - metric: 'creates' | 'updates' | 'deletes' | 'total' (optional, defaults 'creates')
 * - range: '7d' | '14d' | '30d' | '12w' | '12m' | 'custom' (optional, defaults '7d')
 * - from, to: ISO date-times when range='custom'
 * Behavior:
 * - Accepts time range and returns a synthetic but consistent bucketed dataset.
 * - If AnalyticsService has tenant totals, include those as KPIs for compatibility.
 */
async function overviewMetrics(req, res) {
  try {
    // Tenant is optional for demo mode; when available it may scope data
    const tenantId = req?.auth?.tenantId || req.get('x-organization-id') || req.query?.organization_id || null;

    const metric = String(req.query?.metric || 'creates');
    const range = String(req.query?.range || '7d');
    const fromQ = req.query?.from;
    const toQ = req.query?.to;

    // Resolve start/end based on range or custom
    const now = new Date();
    const end = toQ ? new Date(toQ) : new Date(now);
    if (Number.isNaN(end.getTime())) return res.status(400).json({ success: false, message: 'Invalid to datetime' });

    let start;
    if (range === 'custom') {
      if (!fromQ) return res.status(400).json({ success: false, message: 'from is required for custom range' });
      start = new Date(fromQ);
      if (Number.isNaN(start.getTime())) return res.status(400).json({ success: false, message: 'Invalid from datetime' });
    } else {
      const e = new Date(end);
      let days = 7;
      if (range === '14d') days = 14;
      else if (range === '30d') days = 30;
      else if (range === '12w') days = 12 * 7;
      else if (range === '12m') days = 365; // rough default for demo
      start = new Date(e);
      start.setDate(e.getDate() - (days - 1));
    }

    // Normalize to day boundaries
    const startDay = new Date(start); startDay.setHours(0, 0, 0, 0);
    const endDay = new Date(end); endDay.setHours(23, 59, 59, 999);

    // Decide bucket size
    let bucket = 'day';
    if (range === '12w') bucket = 'week';
    if (range === '12m') bucket = 'month';

    // Generate simple synthetic buckets for demo; server can be enhanced to use Mongo pipeline later
    const buckets = [];
    const cursor = new Date(startDay);
    const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
    const toYMD = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const da = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${da}`;
    };
    const startOfWeek = (d0) => {
      const d = new Date(d0); d.setHours(0, 0, 0, 0);
      const diff = (d.getDay() + 6) % 7;
      d.setDate(d.getDate() - diff);
      return d;
    };

    if (bucket === 'week') {
      let c = startOfWeek(cursor);
      while (c <= endDay) {
        const label = toYMD(c);
        // synthetic value varies by metric
        const seed = label.split('-').reduce((a, b) => a + Number(b), 0);
        const base = metric === 'deletes' ? 2 : metric === 'updates' ? 5 : metric === 'total' ? 12 : 8;
        buckets.push({ label, value: base + (seed % 5) });
        c = addDays(c, 7);
      }
    } else if (bucket === 'month') {
      let c = new Date(startDay.getFullYear(), startDay.getMonth(), 1);
      while (c <= endDay) {
        const label = `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-01`;
        const seed = c.getMonth() + 1 + c.getFullYear();
        const base = metric === 'deletes' ? 8 : metric === 'updates' ? 15 : metric === 'total' ? 40 : 20;
        buckets.push({ label, value: base + (seed % 12) });
        // next month
        c = new Date(c.getFullYear(), c.getMonth() + 1, 1);
      }
    } else {
      let c = new Date(startDay);
      while (c <= endDay) {
        const label = toYMD(c);
        const seed = c.getDate() + c.getMonth() + c.getFullYear();
        const base = metric === 'deletes' ? 1 : metric === 'updates' ? 3 : metric === 'total' ? 10 : 5;
        buckets.push({ label, value: base + (seed % 4) });
        c = addDays(c, 1);
      }
    }

    // Collect KPIs from service if available
    let kpis = undefined;
    try {
      if (tenantId) {
        const totals = await AnalyticsService.getOverviewTotals(tenantId);
        kpis = {
          totalRecords: totals?.totalDeployedApps ?? 0,
          newInRange: totals?.totalUsers ?? 0,
          updatesInRange: Math.round((buckets?.reduce((s, b) => s + b.value, 0) || 0) / 2),
          deletionsInRange: Math.round((buckets?.reduce((s, b) => s + b.value, 0) || 0) / 4),
        };
      }
    } catch {
      // ignore if service not wired
    }

    res.set('Cache-Control', 'no-store');
    return res.status(200).json({
      success: true,
      query: { metric, range, from: startDay.toISOString(), to: endDay.toISOString(), bucket },
      buckets,
      kpis: kpis || {
        totalRecords: Math.round((buckets?.reduce((s, b) => s + b.value, 0) || 0) * 3),
        newInRange: Math.round((buckets?.reduce((s, b) => s + b.value, 0) || 0) / 3),
        updatesInRange: Math.round((buckets?.reduce((s, b) => s + b.value, 0) || 0) / 2),
        deletionsInRange: Math.round((buckets?.reduce((s, b) => s + b.value, 0) || 0) / 4),
      },
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

const overviewController = { overviewMetrics };
module.exports = overviewController;

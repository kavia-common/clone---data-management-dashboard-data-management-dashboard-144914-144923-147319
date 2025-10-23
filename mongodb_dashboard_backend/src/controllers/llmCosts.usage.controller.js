'use strict';

// ============================================================================
// REQUIREMENT TRACEABILITY
// ============================================================================
// Requirement ID: REQ-BE-LLM-AGG-OT-001
// User Story: As a dashboard user, I want to see a stacked area chart of LLM model usage
//             (total_cost) over the last N days so I can understand which models are used most.
// Acceptance Criteria:
 //  - GET /api/llm-costs/usage-over-time returns daily buckets for last 90 days by default
 //  - Supports ?days=N (default 90, max 180) or ?range=90d/12w, validation enforced
//  - Aggregates llm_costs by day and llm_model, summing total_cost
//  - Response normalized as: { items: [ { date: 'YYYY-MM-DD', series: { [model]: number } } ], meta: { models, start, end, days } }
//  - ISO 8601 dates and robust error handling
//  - Audit log for READ access including user context if available
// GxP Impact: YES - Data accuracy, validation, and audit logging required.
// Risk Level: MEDIUM
// Validation Protocol: VP-BE-LLM-AGG-OT-001
// ============================================================================
// ============================================================================
// IMPORTS AND DEPENDENCIES
// ============================================================================
const LLMCost = require('../models/llmCosts.model');

/**
 * PUBLIC_INTERFACE
 * usageOverTime
 * Controller for GET /api/llm-costs/usage-over-time?days=30
 * Purpose: Aggregate daily total_cost grouped by llm_model for the last N days.
 * GxP Critical: Yes (validated input, accurate aggregation, audit log)
 * Parameters:
 *  - days (query): integer, optional, default 30, min 1, max 180
 * Returns:
 *  - 200 JSON: { items: [ { date: 'YYYY-MM-DD', series: { [model]: number } } ], meta: { models: string[], start: string, end: string, days: number } }
 * Throws:
 *  - 400 on invalid days
 *  - 500 on unexpected errors
 * Audit:
 *  - Logs READ access with userId (if available), timestamp, action, params, and traceId (if set by middleware).
 */
async function usageOverTime(req, res) {
  // Input validation
  const rawDays = req.query?.days;
  const rawRange = req.query?.range;
  const DEFAULT_DAYS = 90;
  let days;

  // Parse range first if provided: supports '90d' or '12w'
  if (typeof rawRange === 'string' && rawRange.trim().length > 0) {
    const mDays = rawRange.match(/^\s*(\d+)\s*d\s*$/i);
    const mWeeks = rawRange.match(/^\s*(\d+)\s*w\s*$/i);
    if (mDays) {
      days = parseInt(mDays[1], 10);
    } else if (mWeeks) {
      days = parseInt(mWeeks[1], 10) * 7;
    }
  }

  // Fallback to days param if range not used
  if (!Number.isFinite(days)) {
    if (rawDays !== undefined) {
      const parsed = parseInt(rawDays, 10);
      days = Number.isFinite(parsed) ? parsed : DEFAULT_DAYS;
    } else {
      days = DEFAULT_DAYS;
    }
  }

  if (!Number.isFinite(days) || days <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid days parameter. Must be a positive integer.' });
  }
  if (days > 180) {
    days = 180; // clamp to max as specified
  }

  const now = new Date();
  // Start at local midnight "days-1" days ago so that we include today's partial bucket; using UTC for consistency
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
  const startDate = new Date(end);
  startDate.setUTCDate(end.getUTCDate() - (days - 1));
  startDate.setUTCHours(0, 0, 0, 0);

  // Audit (start)
  try {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        type: 'AUDIT',
        action: 'READ',
        entity: 'llm_costs',
        endpoint: '/api/llm-costs/usage-over-time',
        userId: (req.user && (req.user.id || req.user.userId)) || null,
        params: { days, range: rawRange ?? null },
        traceId: req.traceId || null,
      })
    );
  } catch {
    // ignore audit log failures
  }

  try {
    // Mongo aggregation: match by timestamp, project date string, group by date+model, sum cost
    const pipeline = [
      {
        $match: {
          timestamp: { $gte: startDate, $lte: end },
        },
      },
      {
        $project: {
          date: {
            $dateToString: { format: '%Y-%m-%d', date: '$timestamp' },
          },
          llm_model: { $ifNull: ['$llm_model', 'unknown'] },
          total_cost: { $ifNull: ['$total_cost', 0] },
        },
      },
      {
        $group: {
          _id: { date: '$date', model: '$llm_model' },
          amount: { $sum: '$total_cost' },
        },
      },
      {
        $project: {
          _id: 0,
          date: '$_id.date',
          llm_model: '$_id.model',
          amount: { $ifNull: ['$amount', 0] },
        },
      },
      { $sort: { date: 1, llm_model: 1 } },
    ];

    const rows = await LLMCost.aggregate(pipeline).allowDiskUse(true).exec();

    // Build list of unique models
    const modelSet = new Set();
    for (const r of rows) {
      if (r && r.llm_model) modelSet.add(r.llm_model);
    }
    // Ensure deterministic order
    const models = Array.from(modelSet).sort();

    // Initialize date buckets for each day
    const buckets = [];
    const index = new Map(); // date -> index
    for (let i = 0; i < days; i++) {
      const d = new Date(startDate);
      d.setUTCDate(startDate.getUTCDate() + i);
      const dateStr = d.toISOString().slice(0, 10); // YYYY-MM-DD
      const series = {};
      for (const m of models) series[m] = 0;
      buckets.push({ date: dateStr, series });
      index.set(dateStr, i);
    }

    // Populate buckets
    for (const r of rows) {
      const i = index.get(r.date);
      if (i === undefined) continue;
      if (!buckets[i].series[r.llm_model] && buckets[i].series[r.llm_model] !== 0) {
        // handle new model that wasn't in initial set due to empty pre-population
        buckets[i].series[r.llm_model] = 0;
        if (!models.includes(r.llm_model)) {
          models.push(r.llm_model);
        }
      }
      buckets[i].series[r.llm_model] += Number(r.amount || 0);
    }

    // Sort models again if new were added dynamically
    models.sort();

    // Ensure each bucket has keys for all models
    for (const b of buckets) {
      for (const m of models) {
        if (typeof b.series[m] !== 'number') b.series[m] = 0;
      }
    }

    return res.status(200).json({
      items: buckets,
      meta: {
        models,
        start: startDate.toISOString(),
        end: end.toISOString(),
        days,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('GET /api/llm-costs/usage-over-time failed:', err?.message || err);
    return res.status(500).json({
      success: false,
      message: 'Failed to aggregate LLM usage over time',
      details: err?.message || String(err),
    });
  }
}

module.exports = {
  usageOverTime,
};

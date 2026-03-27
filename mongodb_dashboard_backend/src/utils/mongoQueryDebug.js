'use strict';

const util = require('util');

/**
 * PUBLIC_INTERFACE
 * logMongoExecutionPlan
 * Logs the exact MongoDB filter object passed into Mongoose find() and the $match used in aggregate().
 *
 * Contract:
 * - Inputs:
 *   - label: string describing the phase (e.g. 'initial', 'guard-requery')
 *   - modelName: string (Mongoose model name for context)
 *   - findFilter: object passed to Model.find(filter)
 *   - aggregatePipeline: array passed to Model.aggregate(pipeline)
 * - Output: none (side-effect: console logging)
 * - Errors: never throws (best-effort logging)
 *
 * Why:
 * - Makes it unambiguous which exact query objects were executed, which is critical when debugging
 *   “total count filtered but rows not filtered” reports.
 */
function logMongoExecutionPlan({ label, modelName, findFilter, aggregatePipeline }) {
  try {
    const match =
      Array.isArray(aggregatePipeline) &&
      aggregatePipeline[0] &&
      typeof aggregatePipeline[0] === 'object' &&
      aggregatePipeline[0].$match
        ? aggregatePipeline[0].$match
        : null;

    console.log('================ MONGO EXEC PLAN ================');
    console.log('[MONGO PLAN]', {
      label,
      modelName,
      hasFindFilter: !!findFilter,
      hasAggPipeline: Array.isArray(aggregatePipeline),
      aggStages: Array.isArray(aggregatePipeline) ? aggregatePipeline.map((s) => Object.keys(s || {})[0]) : [],
    });

    console.log('[MONGO FIND FILTER]', util.inspect(findFilter, { depth: null, colors: true }));
    console.log('[MONGO AGG $MATCH]', util.inspect(match, { depth: null, colors: true }));
    console.log('=================================================');
  } catch (e) {
    // Best-effort only; do not break request flow for logging.
    try {
      console.log('[MONGO PLAN] logging failed:', e?.message || String(e));
    } catch {}
  }
}

module.exports = { logMongoExecutionPlan };

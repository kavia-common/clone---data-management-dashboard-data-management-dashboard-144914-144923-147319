'use strict';

/**
 * PUBLIC_INTERFACE
 * buildDateRangeFilter
 * Build a MongoDB date-range filter object for a given field (or list of fields) based on req.query.startDate and req.query.endDate.
 * - Accepts ISO 8601 strings.
 * - If both present -> {$gte: start, $lte: end}
 * - If only one bound present -> applies only that bound
 * - If neither present -> returns null (no filtering)
 * - If multiple fields are provided, returns an $or across those fields each with the same range.
 *
 * @param {object} q - Typically req.query
 * @param {string|string[]} fields - Date field(s) to apply the range on (e.g., "created_at" or ["timestamp","created_at","updated_at"])
 * @returns {object|null} A MongoDB query object or null when no valid dates supplied.
 */
function buildDateRangeFilter(q, fields) {
  const startStr = typeof q.startDate === 'string' ? q.startDate.trim() : '';
  const endStr = typeof q.endDate === 'string' ? q.endDate.trim() : '';
  if (!startStr && !endStr) return null;

  const start = startStr ? new Date(startStr) : null;
  const end = endStr ? new Date(endStr) : null;

  if (startStr && Number.isNaN(start?.getTime())) {
    throw Object.assign(new Error('Invalid startDate'), { status: 400 });
  }
  if (endStr && Number.isNaN(end?.getTime())) {
    throw Object.assign(new Error('Invalid endDate'), { status: 400 });
  }

  const range = {};
  if (start) range.$gte = start;
  if (end) range.$lte = end;

  const fieldsArr = Array.isArray(fields) ? fields : [fields];
  if (fieldsArr.length === 1) {
    return { [fieldsArr[0]]: range };
  }
  // Multiple fields -> any of them within range
  return {
    $or: fieldsArr.map((f) => ({ [f]: range })),
  };
}

module.exports = {
  buildDateRangeFilter,
};

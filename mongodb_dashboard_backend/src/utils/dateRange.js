'use strict';

/**
 * PUBLIC_INTERFACE
 * buildDateRangeFilter
 * Build a MongoDB date-range filter object for given field(s)
 * based on req.query.startDate and req.query.endDate.
 * 
 * Supports ISO 8601 and YYYY-MM-DD inputs.
 * 
 * If both provided → {$gte: start, $lte: end}
 * If only one → applies that bound
 * If none → returns null (no filter)
 * 
 * If multiple fields provided → builds an $or across all.
 *
 * @param {object} q - Typically req.query
 * @param {string|string[]} fields - Date field(s) (e.g., "created_at" or ["created_at", "updated_at"])
 * @returns {object|null} MongoDB query filter or null
 */
function buildDateRangeFilter(q, fields) {
  const startStr = q?.startDate ? String(q.startDate).trim() : '';
  const endStr = q?.endDate ? String(q.endDate).trim() : '';

  // No date range provided → no filtering
  if (!startStr && !endStr) return null;

  // Parse dates safely (force ISO parse)
  const start = startStr ? new Date(startStr) : null;
  const end = endStr ? new Date(endStr) : null;

  if (start && isNaN(start.getTime())) {
    throw Object.assign(new Error(`Invalid startDate: ${startStr}`), { status: 400 });
  }
  if (end && isNaN(end.getTime())) {
    throw Object.assign(new Error(`Invalid endDate: ${endStr}`), { status: 400 });
  }

  // Normalize start to beginning of the day (UTC)
  if (start) start.setUTCHours(0, 0, 0, 0);
  // Normalize end to end of the day (UTC)
  if (end) end.setUTCHours(23, 59, 59, 999);

  const range = {};
  if (start) range.$gte = start;
  if (end) range.$lte = end;

  const fieldsArr = Array.isArray(fields) ? fields : [fields];
  if (!fieldsArr.length) return null;

  // Build $or condition across multiple date fields
  if (fieldsArr.length > 1) {
    return { $or: fieldsArr.map((field) => ({ [field]: range })) };
  }

  // Single-field filter
  return { [fieldsArr[0]]: range };
}

module.exports = { buildDateRangeFilter };

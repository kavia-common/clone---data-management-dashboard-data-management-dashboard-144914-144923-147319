'use strict';

/**
 * PUBLIC_INTERFACE
 * buildDateRangeFilter
 * Build a MongoDB date-range filter object for given field(s)
 * based on req.query.startDate/endDate (legacy) and start/end (preferred).
 *
 * Behavior:
 * - Accepts params: start, end, startDate, endDate (strings), using start/end when both present.
 * - Parses ISO 8601 or YYYY-MM-DD.
 * - Applies inclusive UTC day bounds: start → startOfDay(UTC), end → endOfDay(UTC).
 * - Returns null when neither bound is provided.
 * - If multiple fields are provided, returns {$or:[{f1:range},{f2:range},...]}.
 *
 * @param {object} q - Typically req.query
 * @param {string|string[]} fields - Date field(s) (e.g., "created_at" or ["created_at","updated_at"])
 * @returns {object|null} MongoDB query filter or null
 */
function buildDateRangeFilter(q, fields) {
  // Accept both new (start/end) and legacy (startDate/endDate) names; prefer start/end if provided
  const startRaw = q?.start ?? q?.startDate ?? '';
  const endRaw = q?.end ?? q?.endDate ?? '';
  const startStr = startRaw ? String(startRaw).trim() : '';
  const endStr = endRaw ? String(endRaw).trim() : '';

  // No date range provided → no filtering
  if (!startStr && !endStr) return null;

  // Parse dates
  const start = startStr ? new Date(startStr) : null;
  const end = endStr ? new Date(endStr) : null;

  if (start && isNaN(start.getTime())) {
    throw Object.assign(new Error(`Invalid start/startDate: ${startStr}`), { status: 400 });
  }
  if (end && isNaN(end.getTime())) {
    throw Object.assign(new Error(`Invalid end/endDate: ${endStr}`), { status: 400 });
  }

  // Normalize to inclusive UTC day bounds
  if (start) start.setUTCHours(0, 0, 0, 0); // $gte startOfDayUTC
  if (end) end.setUTCHours(23, 59, 59, 999); // $lte endOfDayUTC

  const range = {};
  if (start) range.$gte = start;
  if (end) range.$lte = end;

  const fieldsArr = Array.isArray(fields) ? fields : [fields];
  if (!fieldsArr.length) return null;

  return fieldsArr.length > 1
    ? { $or: fieldsArr.map((field) => ({ [field]: range })) }
    : { [fieldsArr[0]]: range };
}

module.exports = { buildDateRangeFilter };

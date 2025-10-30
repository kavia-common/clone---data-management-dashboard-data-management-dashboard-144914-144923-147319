'use strict';

/**
 * Utilities for Users Analytics endpoints
 * - parseISO: safely parse ISO date strings
 * - startOfDayUTC / endOfDayUTC: normalize to full-day bounds
 * - ensureDateRange: default ranges if not provided
 * - buildMatchFilters: build Mongo $match for collection and field
 */

function parseISO(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function startOfDayUTC(d) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function endOfDayUTC(d) {
  const x = new Date(d);
  x.setUTCHours(23, 59, 59, 999);
  return x;
}

// PUBLIC_INTERFACE
function ensureDateRange(from, to, defaultDays = 30) {
  /**
   * Ensure a valid [from, to) date range.
   * If not supplied, defaults to [now-defaultDays, now).
   * Returns { fromDate, toDate }
   */
  const now = new Date();
  const toParsed = parseISO(to) || now;
  const fromParsed = parseISO(from) || new Date(toParsed.getTime() - defaultDays * 24 * 3600 * 1000);
  return { fromDate: startOfDayUTC(fromParsed), toDate: endOfDayUTC(toParsed) };
}

// PUBLIC_INTERFACE
function buildMatchFilters(params, dateField, options = {}) {
  /**
   * Build a Mongo match object:
   * - organization_id => { organization_id }
   * - department => { department }
   * - status => { status } (if provided; callers set defaults)
   * - dateField range: [from, to) unless options.omitDates
   */
  const { organization_id, department, status, from, to } = params || {};
  const match = {};
  if (organization_id) match.organization_id = organization_id;
  if (department) match.department = department;
  if (status) match.status = status;

  if (!options.omitDates && dateField) {
    if (from || to) {
      const dr = {};
      if (from) dr.$gte = from;
      if (to) dr.$lt = to;
      match[dateField] = dr;
    }
  }

  return match;
}

module.exports = {
  parseISO,
  startOfDayUTC,
  endOfDayUTC,
  ensureDateRange,
  buildMatchFilters,
};

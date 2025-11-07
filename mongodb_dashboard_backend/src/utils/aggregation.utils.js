'use strict';

/**
 * PUBLIC_INTERFACE
 * buildDateRange
 * Utility to create a Mongo $match range object for a given field between start and end dates.
 */
function buildDateRange(field, start, end) {
  const range = {};
  if (start instanceof Date && !Number.isNaN(start.getTime())) range.$gte = start;
  if (end instanceof Date && !Number.isNaN(end.getTime())) range.$lte = end;
  return { [field]: range };
}

module.exports = {
  buildDateRange,
};

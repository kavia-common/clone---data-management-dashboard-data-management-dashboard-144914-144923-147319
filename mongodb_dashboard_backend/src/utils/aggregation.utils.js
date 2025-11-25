 /**
  * PUBLIC_INTERFACE
  * buildDateRange
  * Utility to create a Mongo $match range object for a given field between start and end dates.
  *
  * @param {string} field - The field name (e.g. 'session_start')
  * @param {Date} start - Start date (Date object)
  * @param {Date} end - End date (Date object)
  * @returns {Object} MongoDB $match filter for range
  */
 function buildDateRange(field, start, end) {
   const range = {};
   if (start instanceof Date && !Number.isNaN(start.getTime())) {range.$gte = start;}
   if (end instanceof Date && !Number.isNaN(end.getTime())) {range.$lte = end;}
   return { [field]: range };
 }

 module.exports = {
   buildDateRange,
 };

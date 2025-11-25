 /**
  * Date utilities for analytics and formatting durations.
  * All functions are safe and side-effect free.
  */

 // PUBLIC_INTERFACE
 /**
  * Check if a string is a valid ISO date-time.
  * @param {string} s
  * @returns {boolean}
  */
 function isValidISODate(s) {
   if (!s || typeof s !== 'string') return false;
   const d = new Date(s);
   return !isNaN(d.getTime());
 }

 // PUBLIC_INTERFACE
 /**
  * Parse an ISO date string, returning a fallback if invalid.
  * @param {string} s
  * @param {Date} [fallback=new Date()]
  * @returns {Date}
  */
 function parseISODateSafe(s, fallback = new Date()) {
   const d = new Date(s);
   return isNaN(d.getTime()) ? fallback : d;
 }

 // PUBLIC_INTERFACE
 /**
  * Get the UTC start-of-day for a given date.
  * @param {Date|string|number} date
  * @returns {Date}
  */
 function startOfDayUTC(date) {
   const d = new Date(date);
   return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
 }

 // PUBLIC_INTERFACE
 /**
  * Add days (UTC) to a date.
  * @param {Date|string|number} date
  * @param {number} days
  * @returns {Date}
  */
 function addDaysUTC(date, days) {
   const d = new Date(date);
   const out = new Date(d);
   out.setUTCDate(d.getUTCDate() + days);
   return out;
 }

 // PUBLIC_INTERFACE
 /**
  * Format a date as YYYY-MM-DD (UTC).
  * @param {Date|string|number} date
  * @returns {string}
  */
 function formatYYYYMMDD(date) {
   const d = new Date(date);
   const y = d.getUTCFullYear();
   const m = String(d.getUTCMonth() + 1).padStart(2, '0');
   const day = String(d.getUTCDate()).padStart(2, '0');
   return `${y}-${m}-${day}`;
 }

 // PUBLIC_INTERFACE
 /**
  * Compute { hours, minutes, seconds } from a millisecond duration.
  * @param {number} ms
  * @returns {{hours:number, minutes:number, seconds:number}}
  */
 function computeDuration(ms) {
   const total = Math.max(0, Number(ms) || 0);
   const seconds = Math.floor((total % (1000 * 60)) / 1000);
   const minutes = Math.floor((total % (1000 * 60 * 60)) / (1000 * 60));
   const hours = Math.floor(total / (1000 * 60 * 60));
   return { hours, minutes, seconds };
 }

 // PUBLIC_INTERFACE
 /**
  * Render a human-readable duration like "1h 3m 2s".
  * If ms < 1s, returns "0s".
  * @param {number} ms
  * @returns {string}
  */
 function computeDurationPretty(ms) {
   const { hours, minutes, seconds } = computeDuration(ms);
   const parts = [];
   if (hours) parts.push(`${hours}h`);
   if (minutes) parts.push(`${minutes}m`);
   if (seconds || parts.length === 0) parts.push(`${seconds}s`);
   return parts.join(' ');
 }

 module.exports = {
   isValidISODate,
   parseISODateSafe,
   startOfDayUTC,
   addDaysUTC,
   formatYYYYMMDD,
   computeDuration,
   computeDurationPretty
 };

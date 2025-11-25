 /**
  * Date utilities for analytics
  */

 // PUBLIC_INTERFACE
 function isValidISODate(s) {
   if (!s || typeof s !== 'string') {return false;}
   const d = new Date(s);
   return !isNaN(d.getTime());
 }

 // PUBLIC_INTERFACE
 function parseISODateSafe(s, fallback = new Date()) {
   const d = new Date(s);
   return isNaN(d.getTime()) ? fallback : d;
 }

 // PUBLIC_INTERFACE
 function startOfDayUTC(date) {
   const d = new Date(date);
   return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
 }

 // PUBLIC_INTERFACE
 function addDaysUTC(date, days) {
   const d = new Date(date);
   const out = new Date(d);
   out.setUTCDate(d.getUTCDate() + days);
   return out;
 }

 // PUBLIC_INTERFACE
 function formatYYYYMMDD(date) {
   const d = new Date(date);
   const y = d.getUTCFullYear();
   const m = String(d.getUTCMonth() + 1).padStart(2, '0');
   const day = String(d.getUTCDate()).padStart(2, '0');
   return `${y}-${m}-${day}`;
 }

 module.exports = {
   isValidISODate,
   parseISODateSafe,
   startOfDayUTC,
   addDaysUTC,
   formatYYYYMMDD
 };

//
// Lightweight UTC date helpers to normalize day/weekly/monthly windows
// Produces YYYY-MM-DD strings representing UTC calendar dates without time.
//
// PUBLIC_INTERFACE
export function toUtcDateString(date) {
  /** Convert a Date (or date-like) to a UTC YYYY-MM-DD string */
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// PUBLIC_INTERFACE
export function startOfUtcDay(date) {
  /** Returns a new Date at 00:00:00.000 UTC for given date */
  const d = date instanceof Date ? date : new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

// PUBLIC_INTERFACE
export function endOfUtcDay(date) {
  /** Returns a new Date at 23:59:59.999 UTC for given date */
  const d = date instanceof Date ? date : new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

// PUBLIC_INTERFACE
export function addUtcDays(date, days) {
  /** Add days in UTC context */
  const d = date instanceof Date ? new Date(date.getTime()) : new Date(date);
  const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return new Date(base + days * 24 * 60 * 60 * 1000);
}

// PUBLIC_INTERFACE
export function getWeeklyUtcRange(anchorDate) {
  /**
   * Return [startDate, endDate] inclusive UTC for the calendar week containing anchorDate.
   * Start = Monday 00:00:00.000 UTC, End = Sunday 23:59:59.999 UTC
   */
  const d = anchorDate instanceof Date ? anchorDate : new Date(anchorDate);
  const day = d.getUTCDay(); // 0 (Sun) - 6 (Sat)
  const diffToMonday = (day + 6) % 7; // days since Monday
  const monday = addUtcDays(startOfUtcDay(d), -diffToMonday);
  const sunday = addUtcDays(startOfUtcDay(monday), 6);
  return [monday, endOfUtcDay(sunday)];
}

// PUBLIC_INTERFACE
export function getMonthlyUtcRange(anchorDate) {
  /**
   * Return [startDate, endDate] inclusive UTC for the month containing anchorDate.
   * Start = first day of month 00:00:00.000 UTC
   * End = last day of month 23:59:59.999 UTC
   */
  const d = anchorDate instanceof Date ? anchorDate : new Date(anchorDate);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
  const nextMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  const end = new Date(nextMonth.getTime() - 1); // last ms of previous day
  return [start, end];
}

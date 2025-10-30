import { useEffect, useState } from "react";

/**
 * PUBLIC_INTERFACE
 * useDebouncedValue
 * Returns a debounced copy of a value that updates after the specified delay.
 *
 * @param {any} value - Source value to debounce
 * @param {number} delayMs - Debounce delay in milliseconds (default 250ms)
 * @returns {any} debounced value
 */
export default function useDebouncedValue(value, delayMs = 250) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), Math.max(0, delayMs || 0));
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}

let counter = 0;
let lastLoggedAt = 0;

// PUBLIC_INTERFACE
export function incrementFetchCount() {
  counter += 1;
  const now = Date.now();
  if (counter % 25 === 0 || now - lastLoggedAt > 15000) {
    // Keep it quiet; only debug-level logging
    // eslint-disable-next-line no-console
    console.debug(`[api-metrics] total fetches observed: ${counter}`);
    lastLoggedAt = now;
  }
  return counter;
}

// PUBLIC_INTERFACE
export function getFetchCount() {
  return counter;
}

export function debounce(fn, wait = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

// PUBLIC_INTERFACE
export function leadingTrailingDebounce(fn, wait = 300) {
  /** Debounce that triggers immediately and then at the trailing edge if more calls happened. */
  let timeout = null;
  let lastArgs = null;
  let leadingCalled = false;

  const invoke = (args) => {
    fn(...args);
  };

  return (...args) => {
    lastArgs = args;
    if (!leadingCalled) {
      leadingCalled = true;
      invoke(args);
    }
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      if (lastArgs !== args) {
        invoke(lastArgs);
      }
      leadingCalled = false;
      lastArgs = null;
      timeout = null;
    }, wait);
  };
}

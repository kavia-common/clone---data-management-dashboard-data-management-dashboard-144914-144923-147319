'use strict';

let _last = null;

// PUBLIC_INTERFACE
function getDiagnosticsStore() {
  return {
    set(v) { _last = v; },
    get() { return _last; },
    clear() { _last = null; },
  };
}

module.exports = { getDiagnosticsStore };

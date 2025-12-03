'use strict';

// PUBLIC_INTERFACE
function success(res, data, code = 200) {
  return res.status(code).json(data);
}

// PUBLIC_INTERFACE
function handleError(res, err, code = 500) {
  const message = err && err.message ? err.message : 'Internal Server Error';
  return res.status(code).json({ success: false, message });
}

module.exports = { success, handleError };

function isValidUrl(value) {
  try {
    // URL constructor will throw if invalid
    // Allow http/https only
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidEmail(value) {
  // Simple RFC5322-ish check sufficient for backend gating
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

module.exports = { isValidUrl, isValidEmail };

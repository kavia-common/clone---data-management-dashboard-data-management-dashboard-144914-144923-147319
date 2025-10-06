export function getApiBaseUrl() {
  // Use environment variable configured for this container
  const base = process.env.REACT_APP_API_BASE_URL || '';
  // Ensure we don't end with a trailing slash duplication
  return `${base}`.replace(/\/+$/, '') + '/api';
}

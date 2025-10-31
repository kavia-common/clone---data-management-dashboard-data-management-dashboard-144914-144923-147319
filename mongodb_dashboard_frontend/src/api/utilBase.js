export function getApiBase() {
  const env = process.env.REACT_APP_API_BASE;
  if (env && env.trim()) return env;
  try {
    const url = new URL('https://kavia-dashboard-kavia-dev.cloud.kavia.ai');
    return `${url.protocol}//${url.hostname}:3001`;
  } catch {
    return 'http://localhost:3001';
  }
}

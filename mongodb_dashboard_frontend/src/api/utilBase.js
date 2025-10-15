export function getApiBase() {
  const env = process.env.REACT_APP_API_BASE;
  if (env && env.trim()) return env;
  try {
    const url = new URL(window.location.href);
    return `${url.protocol}//${url.hostname}:7001`;
  } catch {
    return 'http://localhost:7001';
  }
}

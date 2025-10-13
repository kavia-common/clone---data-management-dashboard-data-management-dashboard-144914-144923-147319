import { getApiBaseUrl } from './util';

/**
 * PUBLIC_INTERFACE
 * getModules fetches modules/overview data for the authenticated user/tenant.
 * Ensures cookies/session are sent (credentials: 'include').
 */
export async function getModules(): Promise<any[]> {
  const base = getApiBaseUrl();
  // Try known endpoints in priority order
  const endpoints = ['/api/modules', '/api/dashboard/overview', '/api/app-deployments'];

  for (const ep of endpoints) {
    try {
      const res = await fetch(`${base}${ep}`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!res.ok) {
        if (res.status === 404) continue;
        continue;
      }

      const data = await res.json();
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.data)) return data.data;
      if (data && Array.isArray(data.items)) return data.items;
      if (data && typeof data === 'object') return [data];
      return [];
    } catch (_e) {
      continue;
    }
  }
  return [];
}

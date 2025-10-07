/**
 * Resolve project name from App Deployments enrichment.
 * Uses GET /api/app-deployments with a JSON filter on project_id and limit=1.
 * Adds robust fallback to configured API client and logs for diagnostics.
 */

import axios from 'axios';
import { getApiBaseUrl } from './util';
import { getApiClient } from './client';

// PUBLIC_INTERFACE
export async function fetchProjectNameByProjectId(projectId) {
  /** Returns the project's friendly name or null if not found/failed. */
  if (!projectId) return null;

  try {
    // Prefer using configured axios client (with known baseURL)
    const api = typeof getApiClient === 'function' ? getApiClient() : null;

    // Build query params
    const params = new URLSearchParams();
    params.set('limit', '1');
    params.set('filter', JSON.stringify({ project_id: String(projectId) }));

    if (api) {
      // Use configured baseURL: /api/app-deployments
      const res = await api.get(`/app-deployments?${params.toString()}`);
      const payload = res?.data;
      const list = Array.isArray(payload) ? payload : payload?.data;
      if (Array.isArray(list) && list.length > 0) {
        const first = list[0] || {};
        const name = first.projectName || first.project_name || null;
        if (!name) {
          console.debug('[ProjectName] Name not found on first deployment record', { projectId, record: first });
        }
        return name;
      }
      console.debug('[ProjectName] No deployments found for project', { projectId });
      return null;
    }

    // Fallback: try util base URL or relative /api
    const base = (typeof getApiBaseUrl === 'function' && getApiBaseUrl()) || '/api';
    const url = `${String(base).replace(/\/$/, '')}/app-deployments?${params.toString()}`;
    const res = await axios.get(url);
    const payload = res?.data;
    const list = Array.isArray(payload) ? payload : payload?.data;
    if (Array.isArray(list) && list.length > 0) {
      const first = list[0] || {};
      const name = first.projectName || first.project_name || null;
      if (!name) {
        console.debug('[ProjectName] Name not found on first deployment record (fallback path)', { projectId, record: first });
      }
      return name;
    }
    console.debug('[ProjectName] No deployments found for project (fallback path)', { projectId });
    return null;
  } catch (e) {
    console.error('[ProjectName] Failed to resolve project name', { projectId, error: e?.message || e });
    return null;
  }
}

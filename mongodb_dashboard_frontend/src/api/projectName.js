/**
 * Resolve project name from App Deployments enrichment.
 * Uses GET /api/app-deployments with a JSON filter on project_id and limit=1.
 */

import axios from 'axios';
import { getApiBaseUrl } from './util';

// PUBLIC_INTERFACE
export async function fetchProjectNameByProjectId(projectId) {
  /** Returns the project's friendly name or null if not found/failed. */
  try {
    if (!projectId) return null;
    const base = getApiBaseUrl ? getApiBaseUrl() : '/api';
    const params = new URLSearchParams();
    params.set('limit', '1');
    params.set('filter', JSON.stringify({ project_id: String(projectId) }));

    const url = `${base.replace(/\/$/, '')}/app-deployments?${params.toString()}`;
    const res = await axios.get(url);
    const payload = res?.data;
    const list = Array.isArray(payload) ? payload : payload?.data;
    if (Array.isArray(list) && list.length > 0) {
      const first = list[0] || {};
      return first.projectName || first.project_name || null;
    }
    return null;
  } catch (e) {
    return null;
  }
}

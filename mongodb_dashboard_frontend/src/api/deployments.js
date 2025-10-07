/**
 * Utilities for interacting with app deployments API.
 * Provides helpers to resolve projectName from deployments enrichment.
 */

import client from './client';
import { buildFilterParam } from './util';

/**
 * PUBLIC_INTERFACE
 * Fetch a single deployment by projectId to resolve the projectName.
 * It queries /api/app-deployments with a filter on project_id and limit=1.
 * Returns a string projectName or null if not found.
 */
export async function fetchProjectNameByProjectId(projectId) {
  try {
    if (!projectId) return null;

    // Prefer backend enrichment: query deployments with filter on project_id.
    const params = new URLSearchParams();
    // The backend supports JSON "filter" query parameter; we use util helper if available.
    const filter = { project_id: String(projectId) };
    const filterParam = buildFilterParam ? buildFilterParam(filter) : JSON.stringify(filter);
    params.set('filter', filterParam);
    params.set('limit', '1');

    const res = await client.get(`/api/app-deployments?${params.toString()}`);
    // Response can be either array or { success, data, meta }
    const data = Array.isArray(res.data) ? res.data : res.data?.data;

    if (Array.isArray(data) && data.length > 0) {
      const first = data[0] || {};
      // Backend enrichment should expose projectName or project_name
      return first.projectName || first.project_name || null;
    }
    return null;
  } catch (err) {
    // Let callers decide how to show error; return null for graceful fallback.
    return null;
  }
}

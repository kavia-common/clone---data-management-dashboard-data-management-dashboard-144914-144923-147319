/**
 * Resolve project name via dedicated endpoint.
 * Uses GET /api/projects/{projectId}/name which returns { projectId, projectName } or 404.
 * Provides fallback to base URL utility if configured client isn't available.
 */

import axios from 'axios';
import { getApiBaseUrl } from './util';
import { getApiClient } from './client';

/**
 * PUBLIC_INTERFACE
 */
// PUBLIC_INTERFACE
export async function fetchProjectNameDirect(projectId) {
  /** Returns the project's friendly name or null if not found/failed. */
  if (!projectId) return null;

  try {
    const api = typeof getApiClient === 'function' ? getApiClient() : null;
    if (api) {
      const res = await api.get(`/projects/${encodeURIComponent(String(projectId))}/name`);
      const data = res?.data || {};
      if (!data?.projectName) {
        console.debug('[ProjectName] Missing projectName in response (api client path)', { projectId, data });
      }
      return data?.projectName ?? null;
    }
    // Fallback to base URL + axios
    const base = (typeof getApiBaseUrl === 'function' && getApiBaseUrl()) || '/api';
    const url = `${String(base).replace(/\/$/, '')}/projects/${encodeURIComponent(String(projectId))}/name`;
    const res = await axios.get(url);
    const data = res?.data || {};
    if (!data?.projectName) {
      console.debug('[ProjectName] Missing projectName in response (fallback path)', { projectId, data });
    }
    return data?.projectName ?? null;
  } catch (e) {
    // Gracefully handle 404/not found as null
    const status = e?.response?.status;
    if (status === 404) {
      console.debug('[ProjectName] 404 when fetching project name', { projectId });
      return null;
    }
    console.error('[ProjectName] Failed to fetch project name', { projectId, error: e?.message || e });
    return null;
  }
}

/**
 * Deprecated: deployments-based lookup.
 * Keeping exported for backward compatibility if any old code imports it,
 * but it now delegates to the direct endpoint to avoid double calls.
 */
// PUBLIC_INTERFACE
export async function fetchProjectNameByProjectId(projectId) {
  /** Returns the project's friendly name or null if not found/failed. */
  return fetchProjectNameDirect(projectId);
}

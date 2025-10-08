//
// API client for resolving a project's display name by projectId
//

import { apiGet, API_BASE_URL } from './client';

/**
 * PUBLIC_INTERFACE
 * Fetch the project name for a given projectId from App Deployments.
 * Calls GET /api/app-deployments/project/{projectId}/name on the backend.
 *
 * Behavior:
 * - On success, returns { projectId, projectName }.
 * - If projectName is missing or undefined, returns projectName: null.
 * - On error, throws an Error with contextual information.
 *
 * @param {string} projectId - The project identifier to resolve.
 * @returns {Promise<{ projectId: string, projectName: string|null }>}
 */
export async function getProjectName(projectId) {
  /** This is a public function. */
  if (!projectId || typeof projectId !== 'string') {
    throw new Error('getProjectName(projectId) requires a non-empty string projectId');
  }

  // Construct path relative to API base. The client will prepend API_BASE_URL or '/api'.
  const path = `/app-deployments/project/${encodeURIComponent(projectId)}/name`;

  try {
    const result = await apiGet(path);
    // Backend contract: returns { projectId, projectName } with projectName possibly null
    const normalized = {
      projectId: result?.projectId ?? projectId,
      projectName: result?.projectName ?? null,
    };
    return normalized;
  } catch (err) {
    // Provide helpful context and rethrow so callers can decide what to do (e.g., show fallback UI)
    const url = `${API_BASE_URL.replace(/\/$/, '')}${path}`;
    const e = new Error(`Failed to fetch project name for ${projectId} from ${url}: ${err?.message || err}`);
    e.cause = err;
    throw e;
  }
}

export default getProjectName;

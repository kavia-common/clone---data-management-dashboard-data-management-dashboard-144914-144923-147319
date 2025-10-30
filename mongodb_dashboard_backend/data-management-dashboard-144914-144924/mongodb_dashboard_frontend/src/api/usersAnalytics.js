import client from './client';

// PUBLIC_INTERFACE
export function getActiveUsersTrend(params = {}) {
  /** Fetch active users trend time series. */
  return client.get('/api/users/active-trend', { params }).then(r => r.data);
}

// PUBLIC_INTERFACE
export function getKpiSummary(params = {}) {
  /** Fetch KPI summary for users. */
  return client.get('/api/users/kpi-summary', { params }).then(r => r.data);
}

// PUBLIC_INTERFACE
export function getUsersByDepartment(params = {}) {
  /** Fetch counts grouped by department. */
  return client.get('/api/users/by-department', { params }).then(r => r.data);
}

// PUBLIC_INTERFACE
export function getUsersByOrganization(params = {}) {
  /** Fetch counts grouped by organization_id. */
  return client.get('/api/users/by-organization', { params }).then(r => r.data);
}

// PUBLIC_INTERFACE
export function getUsersCompliance(params = {}) {
  /** Fetch compliance breakdown derived from user fields. */
  return client.get('/api/users/compliance', { params }).then(r => r.data);
}

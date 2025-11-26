'use strict';

// PUBLIC_INTERFACE
/**
 * Minimal helper to generate mock docs for llm-costs with mixed currency formats.
 * This is used by the over-time integration test to validate parsing rules.
 */
function makeCostDoc({ tenant = 'org_test', date = '2025-01-01', amount = '$0.100000', fields = {} } = {}) {
  const d = new Date(`${date}T12:00:00.000Z`);
  return {
    tenant_id: tenant,
    organization_id: tenant,
    timestamp: d,
    created_at: d,
    updated_at: d,
    total_cost: typeof amount === 'number' ? amount : undefined,
    'Total Cost': typeof amount === 'string' ? amount : undefined,
    currency: 'USD',
    ...fields,
  };
}

module.exports = { makeCostDoc };

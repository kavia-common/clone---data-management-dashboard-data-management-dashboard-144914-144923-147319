import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { fetchSessionTenants, selectTenant, normalizeTenantId } from '../utils/tenantClient';

/**
// ============================================================================
// REQUIREMENT TRACEABILITY
// ============================================================================
// Requirement ID: REQ-FE-TENANT-ROUTING-002
// User Story: After login, when reaching protected routes, the app should bootstrap tenant context.
// Acceptance Criteria:
// - On first protected render: GET /api/session/tenants
// - If 0 → navigate to /tenant/select (info state)
// - If 1 → POST /api/tenants/select then navigate to /dashboard/overview
// - If >1 → navigate to /tenant/select
// - Do not interfere with /tenant/select itself
// GxP Impact: NO (routing)
// Risk Level: LOW
// Validation Protocol: VP-FE-TENANT-ROUTING
// ============================================================================

/**
 * PUBLIC_INTERFACE
 * TenantBootstrap
 * A lightweight effect-only component that runs the tenant selection bootstrap logic
 * once when a protected route is first rendered.
 *
 * Design decisions:
 * - Effect is guarded to run once per page lifecycle using a ref flag.
 * - Skips when currently on /tenant/select to avoid loops.
 * - Uses backend cookie via POST /api/tenants/select and mirrors localStorage for UI hints.
 */
export default function TenantBootstrap() {
  const navigate = useNavigate();
  const location = useLocation();
  const ranRef = React.useRef(false);

  React.useEffect(() => {
    // Avoid loops and double-invocation in StrictMode dev
    if (ranRef.current) return;
    if (location.pathname.startsWith('/tenant/select')) return;
    ranRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        const tenants = await fetchSessionTenants();
        if (cancelled) return;

        const count = Array.isArray(tenants) ? tenants.length : 0;
        if (count <= 0) {
          navigate('/tenant/select', { replace: true, state: { empty: true } });
          return;
        }
        if (count === 1) {
          const tid = normalizeTenantId(tenants[0]);
          if (tid) {
            try {
              await selectTenant(tid, 'auto-select:single-tenant');
              if (!cancelled) navigate('/dashboard/overview', { replace: true });
            } catch (postErr) {
              // eslint-disable-next-line no-console
              if (process.env.NODE_ENV !== 'production') console.warn('Tenant auto-select failed', postErr);
              if (!cancelled) navigate('/tenant/select', { replace: true });
            }
            return;
          }
        }
        // Multiple tenants or no valid id → go to selector
        navigate('/tenant/select', { replace: true });
      } catch (e) {
        // On error, fail open to the selector to let the user manually proceed
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.warn('TenantBootstrap: error fetching tenants, redirecting to selector', e);
        }
        if (!cancelled) navigate('/tenant/select', { replace: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [location.pathname, navigate]);

  return null;
}

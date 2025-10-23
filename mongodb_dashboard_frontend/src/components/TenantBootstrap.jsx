import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { fetchSessionTenants, selectTenant, normalizeTenantId, getActiveTenant } from '../utils/tenantClient';

/**
// ============================================================================
// REQUIREMENT TRACEABILITY
// ============================================================================
// Requirement ID: REQ-FE-TENANT-ROUTING-002
// User Story: After login, when reaching protected routes, the app should bootstrap tenant context.
// Acceptance Criteria:
// - On first protected render: if no active tenant, GET /api/session/tenants.
// - If tenants.length > 1 → navigate('/tenant/select')
// - If tenants.length === 1 → POST /api/tenants/select then navigate('/dashboard/overview')
// - If tenants.length === 0 → show info (we route to /tenant/select with info state)
// - Do not interfere with /tenant/select itself
// - Do not eagerly redirect to overview before this bootstrap runs
// GxP Impact: NO (routing)
// Risk Level: LOW
// Validation Protocol: VP-FE-TENANT-ROUTING
// ============================================================================ */

/**
 * PUBLIC_INTERFACE
 * TenantBootstrap
 * Effect-only component that runs tenant selection bootstrap logic once per page lifecycle.
 *
 * Behaviors:
 * - If already on /tenant/select → no-op (avoid loops).
 * - If an active tenant exists and the user is on a neutral landing (/ or /dashboard) → navigate to /dashboard/overview.
 * - If no active tenant → fetch authorized tenants and navigate per count:
 *   - 0 → /tenant/select (with info in state)
 *   - 1 → POST select then /dashboard/overview
 *   - >1 → /tenant/select
 * - Uses a ref guard to avoid double invocation (e.g., React.StrictMode).
 */
export default function TenantBootstrap() {
  const navigate = useNavigate();
  const location = useLocation();
  const ranRef = React.useRef(false);

  React.useEffect(() => {
    // Avoid loops on tenant selector and avoid double-run in StrictMode
    if (ranRef.current) return;
    if (location.pathname.startsWith('/tenant/select')) return;

    ranRef.current = true;

    const isNeutralLanding =
      location.pathname === '/' || location.pathname === '/dashboard';

    let cancelled = false;

    (async () => {
      try {
        // If an active tenant is already present, default to overview only from neutral landing
        const active = getActiveTenant();
        if (active) {
          if (isNeutralLanding) {
            navigate('/dashboard/overview', { replace: true });
          }
          return;
        }

        // No active tenant: fetch and decide
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

        // Multiple tenants or invalid id → tenant selector
        navigate('/tenant/select', { replace: true });
      } catch (e) {
        // On error, fail open to the selector
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

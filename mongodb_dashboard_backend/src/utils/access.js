'use strict';

/**
 * PUBLIC_INTERFACE
 * isSuperAdmin
 * Checks if the current request has a Super Admin role based on either:
 *  - req.user.roles (preferred after attachAuthContext)
 *  - req.auth.roles or req.auth.role
 * Returns boolean.
 */
function isSuperAdmin(req) {
  try {
    const roles =
      (Array.isArray(req?.user?.roles) && req.user.roles) ||
      (Array.isArray(req?.auth?.roles) && req.auth.roles) ||
      (typeof req?.auth?.role === 'string' ? [req.auth.role] : []) ||
      [];
    return roles.map((r) => String(r).toLowerCase()).includes('super admin'.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * PUBLIC_INTERFACE
 * normalizeTenantId
 * Normalizes a tenant/organization id string to reduce mismatches such as:
 *  - trim whitespace
 *  - collapse multiple zeros after a prefix where applicable (e.g., T000 vs T0000 -> T0-based)
 *  - uppercase for consistent comparison
 * NOTE: This does not modify stored data; only used for comparison/equality checks.
 * Special case usage: other middleware may treat values like T0000 as a global selector for Super Admin.
 */
function normalizeTenantId(id) {
  if (id == null) return id;
  const s = String(id).trim();
  // Uppercase for consistent compare
  let out = s.toUpperCase();

  // Optional heuristic: collapse multiple leading zeros following a single alpha prefix, e.g., T00012 -> T00012 (keep), T000 vs T0000 both treated equal by removing trailing zeros when numeric part is only zeros
  // We won't mutate numeric values with digits other than zero.
  // Example: T000 -> T0, T0000 -> T0. T0012 stays T0012
  const m = out.match(/^([A-Z])0+$/);
  if (m) {
    out = `${m[1]}0`;
  }
  return out;
}

module.exports = {
  isSuperAdmin,
  normalizeTenantId,
};

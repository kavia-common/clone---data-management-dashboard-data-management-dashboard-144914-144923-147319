import React from "react";
import Card from "../ui/Card.jsx";
import Skeleton from "../ui/Skeleton.jsx";
import ErrorState from "../common/ErrorState.jsx";
import Button from "../ui/Button.jsx";
import { formatCurrencyAmount } from "../../utils/formatCurrency.js";
import api from "../../utils/api";

/**
 * PUBLIC_INTERFACE
 * CostsOrganizationSummary
 * Displays a tenant/organization-level credits or cost summary using live backend.
 *
 * Backend alignment notes:
 *  - Current OpenAPI provides:
 *      GET /api/tenants/{tenantId}/credits-summary  -> tenant credit summary and usage breakdowns
 *    There is no explicit /api/orgs/:orgId/summary in the spec.
 *  - We will call the credits-summary endpoint as the closest match.
 *  - TODO: If backend adds a costs-focused org summary, update the endpoint here.
 */
export default function CostsOrganizationSummary({ orgId, onLoaded }) {
  const [state, setState] = React.useState({
    loading: false,
    error: "",
    data: null,
  });

  const load = React.useCallback(async () => {
    if (!orgId) return;
    setState((s) => ({ ...s, loading: true, error: "" }));
    try {
      const res = await api.get(`/api/tenants/${encodeURIComponent(orgId)}/credits-summary`);
      const payload = normalizeSummary(orgId, res?.data || {});
      setState({ loading: false, error: "", data: payload });
      if (onLoaded) onLoaded(payload);
    } catch (e) {
      setState({
        loading: false,
        error: e?.message || "Failed to load organization summary.",
        data: null,
      });
    }
  }, [orgId, onLoaded]);

  React.useEffect(() => {
    load();
  }, [load]);

  const { loading, error, data } = state;

  if (!orgId) {
    return null;
  }

  return (
    <Card
      title="Organization Summary"
      subtitle="Overview of organization-level costs and usage"
      className="mb-4"
      actions={
        <Button variant="ghost" onClick={load} aria-label="Refresh organization summary">
          Refresh
        </Button>
      }
    >
      {loading ? (
        <div className="org-summary-grid" aria-busy="true" aria-label="Loading organization summary" style={styles.grid}>
          <SummaryItem label="Organization ID">
            <Skeleton width={160} height={16} />
          </SummaryItem>
          <SummaryItem label="Organization">
            <Skeleton width={120} height={16} />
          </SummaryItem>
          <SummaryItem label="Total Cost" emphasize>
            <Skeleton width={140} height={24} />
          </SummaryItem>
          <SummaryItem label="Users">
            <Skeleton width={64} height={16} />
          </SummaryItem>
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !data ? (
        <div>No organization data available.</div>
      ) : (
        <div className="org-summary-grid" style={styles.grid}>
          <SummaryItem label="Organization ID">{data.organizationId}</SummaryItem>
          <SummaryItem label="Organization">{data.organizationName}</SummaryItem>
          <SummaryItem label="Total Cost" emphasize>
            {formatCurrencyAmount(data.totalCost, { currency: "USD", maximumFractionDigits: 6 })}
          </SummaryItem>
          <SummaryItem label="Users">{Number(data.users ?? 0).toLocaleString()}</SummaryItem>
        </div>
      )}
    </Card>
  );
}

/**
 * Normalize backend response from credits-summary to expected UI fields.
 */
function normalizeSummary(orgId, data) {
  const totalCost =
    typeof data.total_usage_cost === "number"
      ? data.total_usage_cost
      : typeof data.totalCost === "number"
      ? data.totalCost
      : 0;

  const usersCount =
    typeof data.total_users === "number"
      ? data.total_users
      : typeof data.usersCount === "number"
      ? data.usersCount
      : typeof data.users === "number"
      ? data.users
      : 0;

  return {
    organizationId: orgId,
    organizationName: data.tenant_name || data.organizationName || orgId,
    totalCost,
    users: usersCount,
  };
}

/**
 * SummaryItem
 * Renders a label/value pair with emphasis and Ocean theme styles.
 */
// PUBLIC_INTERFACE
function SummaryItem({ label, children, emphasize = false }) {
  return (
    <div
      className="org-summary-item"
      style={{
        background: "#ffffff",
        border: "1px solid #E5E7EB",
        borderRadius: 12,
        boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
        padding: 12,
        transition: "box-shadow 160ms ease, transform 160ms ease",
      }}
    >
      <div
        className="org-summary-label"
        style={{
          fontSize: 12,
          color: "#6B7280",
          marginBottom: 6,
          letterSpacing: 0.2,
        }}
      >
        {label}
      </div>
      <div
        className="org-summary-value"
        style={{
          fontSize: emphasize ? 20 : 16,
          fontWeight: emphasize ? 700 : 600,
          color: emphasize ? "#2563EB" : "#111827",
          whiteSpace: "nowrap",
        }}
      >
        {children}
      </div>
    </div>
  );
}

const styles = {
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
    alignItems: "stretch",
  },
};

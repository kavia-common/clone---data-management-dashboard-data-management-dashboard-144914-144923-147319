import React from "react";
import Card from "../ui/Card.jsx";
import Skeleton from "../ui/Skeleton.jsx";
import ErrorState from "../common/ErrorState.jsx";
import Button from "../ui/Button.jsx";
import { formatCurrencyAmount } from "../../utils/formatCurrency.js";

/**
 * PUBLIC_INTERFACE
 * CostsOrganizationSummary
 * Displays an organization summary with:
 *  - Organization ID
 *  - Organization
 *  - Total Cost (emphasized, currency formatted with thousand separators and up to 6 decimals)
 *  - Users
 *
 * Includes loading and error states. TODO: Replace local simulated fetch with real API call.
 *
 * Props:
 * - onLoaded?: (data) => void   // optional callback when data loads successfully
 * - failChance?: number         // 0..1 chance to simulate failure; default 0.1 (10%)
 */
export default function CostsOrganizationSummary({ onLoaded, failChance = 0.1 }) {
  const [state, setState] = React.useState({
    loading: true,
    error: "",
    data: null,
  });

  const load = React.useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: "" }));
    try {
      // TODO: Wire to real backend API when available.
      // Placeholder: provide empty values to render gracefully.
      const payload = {
        organizationId: "",
        organizationName: "",
        totalCost: 0,
        users: 0,
      };
      setState({ loading: false, error: "", data: payload });
      if (onLoaded) onLoaded(payload);
    } catch (e) {
      setState({ loading: false, error: e?.message || "Failed to load organization summary.", data: null });
    }
  }, [onLoaded]);

  React.useEffect(() => {
    load();
  }, [load]);

  const { loading, error, data } = state;

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
        <ErrorState
          message={error}
          onRetry={load}
        />
      ) : (
        <div className="org-summary-grid" style={styles.grid}>
          <SummaryItem label="Organization ID">{data.organizationId}</SummaryItem>
          <SummaryItem label="Organization">{data.organizationName}</SummaryItem>
          <SummaryItem label="Total Cost" emphasize>
            {formatCurrencyAmount(data.totalCost, { currency: "USD", maximumFractionDigits: 6 })}
          </SummaryItem>
          <SummaryItem label="Users">{Number(data.users).toLocaleString()}</SummaryItem>
        </div>
      )}
    </Card>
  );
}

/**
 * SummaryItem
 * Renders a label/value pair with emphasis and Ocean theme styles.
 */
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

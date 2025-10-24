import React from "react";
import Card from "../ui/Card.jsx";
import Skeleton from "../ui/Skeleton.jsx";
import ErrorState from "../common/ErrorState.jsx";
import Button from "../ui/Button.jsx";
import { formatCurrencyAmount } from "../../utils/formatCurrency.js";
import { listOrganizations, getOrganizationSummary } from "../../api/organizations";

/**
 * PUBLIC_INTERFACE
 * CostsOrganizationSummary
 * Organization-driven summary with dropdown selection using real backend endpoints.
 *
 * Displays:
 *  - Organization ID
 *  - Organization (name)
 *  - Total Cost (emphasized; currency formatted with thousand separators and up to 6 decimals)
 *  - Users
 *
 * Behavior:
 *  - On mount: loads organizations list and selects the first by default.
 *  - On selection: fetches organization summary using GET /api/tenants/:tenantId/users/usage
 *    and, when necessary, GET /api/tenants/:tenantId/navigation to resolve name.
 *  - Keeps loading skeletons and error states with retry for both list and summary calls.
 *  - Dropdown is disabled while summary is loading.
 *
 * Props:
 * - onLoaded?: (data) => void   // optional callback when summary loads successfully
 * - failChance?: number         // If provided, activates mock mode for tests; 0..1 failure chance
 */
export default function CostsOrganizationSummary({ onLoaded, failChance }) {
  const useMock = typeof failChance === "number";

  // Organizations list state
  const [orgsState, setOrgsState] = React.useState({
    loading: true,
    error: "",
    items: [],
  });

  // Selected organization id
  const [selectedOrgId, setSelectedOrgId] = React.useState("");

  // Summary state
  const [summaryState, setSummaryState] = React.useState({
    loading: true,
    error: "",
    data: null,
  });

  // Load organizations list
  const loadOrganizations = React.useCallback(async () => {
    setOrgsState((s) => ({ ...s, loading: true, error: "" }));
    try {
      let items;
      if (useMock) {
        items = await mockFetchOrganizations(failChance);
      } else {
        items = await listOrganizations();
      }
      setOrgsState({ loading: false, error: "", items });
      // Select first by default if none selected
      if (!selectedOrgId && items.length > 0) {
        setSelectedOrgId(items[0].id);
      }
      // If empty, also clear any summary
      if (items.length === 0) {
        setSummaryState({ loading: false, error: "", data: null });
      }
    } catch (e) {
      setOrgsState({
        loading: false,
        error: e?.message || "Failed to load organizations.",
        items: [],
      });
    }
  }, [useMock, failChance, selectedOrgId]);

  // Load summary for selected organization
  const loadSummary = React.useCallback(
    async (orgId, orgName = null) => {
      if (!orgId) {
        setSummaryState({ loading: false, error: "", data: null });
        return;
      }
      setSummaryState({ loading: true, error: "", data: null });
      try {
        let payload;
        if (useMock) {
          payload = await mockFetchOrganizationSummary(failChance);
        } else {
          const summary = await getOrganizationSummary(orgId);
          payload = {
            ...summary,
            // Prefer dropdown label when API name is not available
            name: summary.name ?? orgName ?? null,
          };
        }
        setSummaryState({ loading: false, error: "", data: payload });
        if (onLoaded) onLoaded(payload);
      } catch (e) {
        setSummaryState({
          loading: false,
          error: e?.message || "Failed to load organization summary.",
          data: null,
        });
      }
    },
    [useMock, failChance, onLoaded]
  );

  // On mount: load organizations
  React.useEffect(() => {
    loadOrganizations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When selected organization changes, load its summary
  React.useEffect(() => {
    if (!selectedOrgId) return;
    const selected = (orgsState.items || []).find((o) => o.id === selectedOrgId);
    loadSummary(selectedOrgId, selected?.name ?? null);
  }, [selectedOrgId, orgsState.items, loadSummary]);

  const { loading: orgsLoading, error: orgsError, items: orgs } = orgsState;
  const { loading, error, data } = summaryState;

  // Build dropdown UI (keeps theme styles from global form styles)
  const dropdown = (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <label htmlFor="org-select" style={{ fontSize: 12, color: "var(--ocean-muted)" }}>
        Organization
      </label>
      <select
        id="org-select"
        value={selectedOrgId}
        onChange={(e) => setSelectedOrgId(e.target.value)}
        disabled={loading || orgsLoading || (orgs?.length || 0) === 0}
        aria-label="Select organization"
        style={{ minWidth: 200 }}
      >
        {(orgs || []).map((o) => (
          <option key={o.id} value={o.id}>
            {o.name || o.id}
          </option>
        ))}
      </select>
    </div>
  );

  // Actions on the card header
  const actions = (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {dropdown}
      <Button
        variant="ghost"
        onClick={() => {
          if (orgsError) {
            loadOrganizations();
          } else {
            const selected = (orgs || []).find((o) => o.id === selectedOrgId);
            loadSummary(selectedOrgId, selected?.name ?? null);
          }
        }}
        aria-label="Refresh organization summary"
      >
        Refresh
      </Button>
    </div>
  );

  return (
    <Card
      title="Organization Summary"
      subtitle="Overview of organization-level costs and usage"
      className="mb-4 themedSurface"
      actions={actions}
    >
      {/* Handle organizations loading/error/empty states at the top of the card */}
      {orgsLoading ? (
        <div
          className="org-summary-grid"
          aria-busy="true"
          aria-label="Loading organizations"
          style={styles.grid}
        >
          <SummarySkeleton />
        </div>
      ) : orgsError ? (
        <ErrorState message={orgsError} onRetry={loadOrganizations} />
      ) : (orgs?.length || 0) === 0 ? (
        <div className="screen-center" style={{ minHeight: 120 }}>
          <div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>No organizations found</div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              Ask an administrator to grant you access or try refreshing.
            </div>
            <Button variant="secondary" onClick={loadOrganizations} aria-label="Reload organizations">
              Reload
            </Button>
          </div>
        </div>
      ) : (
        // With organizations loaded, render the summary states
        <>
          {loading ? (
            <div
              className="org-summary-grid"
              aria-busy="true"
              aria-label="Loading organization summary"
              style={styles.grid}
            >
              <SummarySkeleton />
            </div>
          ) : error ? (
            <ErrorState
              message={error}
              onRetry={() => {
                const selected = (orgs || []).find((o) => o.id === selectedOrgId);
                loadSummary(selectedOrgId, selected?.name ?? null);
              }}
            />
          ) : (
            <div className="org-summary-grid" style={styles.grid}>
              <SummaryItem label="Organization ID">{data?.id || "—"}</SummaryItem>
              <SummaryItem label="Organization">
                {data?.name || orgs.find((o) => o.id === selectedOrgId)?.name || "—"}
              </SummaryItem>
              <SummaryItem label="Total Cost" emphasize>
                {formatCurrencyAmount(data?.totalCost ?? 0, {
                  currency: "USD",
                  maximumFractionDigits: 6,
                })}
              </SummaryItem>
              <SummaryItem label="Users">
                {Number(data?.usersCount ?? 0).toLocaleString()}
              </SummaryItem>
            </div>
          )}
        </>
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
      className={`org-summary-item surface-dark${emphasize ? " org-summary-item--emphasis" : ""}`}
      role="group"
      aria-label={`${label} summary tile`}
      tabIndex={0}
    >
      <div className="org-summary-label">{label}</div>
      <div className={`org-summary-value${emphasize ? " org-summary-value--emphasis" : ""}`}>
        {children}
      </div>
    </div>
  );
}

function SummarySkeleton() {
  return (
    <>
      <SummaryItem label="Organization ID">
        <Skeleton width={160} height={16} />
      </SummaryItem>
      <SummaryItem label="Organization">
        <Skeleton width={180} height={16} />
      </SummaryItem>
      <SummaryItem label="Total Cost" emphasize>
        <Skeleton width={160} height={24} />
      </SummaryItem>
      <SummaryItem label="Users">
        <Skeleton width={64} height={16} />
      </SummaryItem>
    </>
  );
}

/**
 * Mock helpers used only when `failChance` prop is provided (test harness).
 * This preserves tests while enabling real API in production.
 */
async function mockFetchOrganizations(failChance = 0.1) {
  await delay(200 + Math.random() * 300);
  if (Math.random() < (Number.isFinite(failChance) ? failChance : 0.1)) {
    throw new Error("Network error: Unable to fetch organizations");
  }
  // Provide a single org that matches the summary mock
  return [{ id: "T0002", name: "KAVIA" }];
}

async function mockFetchOrganizationSummary(failChance = 0.1) {
  await delay(350 + Math.random() * 400); // 350-750ms delay
  if (Math.random() < (Number.isFinite(failChance) ? failChance : 0.1)) {
    throw new Error("Network error: Unable to fetch organization summary");
  }
  return {
    id: "T0002",
    name: "KAVIA",
    totalCost: 2663.216423,
    usersCount: 25,
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const styles = {
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
    alignItems: "stretch",
  },
};

import React, { useMemo, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import DataTable from "../../components/DataTable.jsx";
import Button from "../../components/ui/Button.jsx";
import { useDataContext } from "../../context/DataContext.jsx";

/**
 * PUBLIC_INTERFACE
 * Sessions
 * Session Tracking table restricted to show only the following columns (in this exact order):
 * - Task Id
 * - Tenant Id
 * - Organization Name
 * - Service Type
 * - Total Cost
 *
 * Data is sourced exclusively from the centralized DataContext and cached at app mount.
 * No direct API fetching occurs within this tab; switching between tabs uses cached data instantly.
 */
export default function Sessions() {
  const { sessions, sessionsLoading, sessionsError, refreshSessions } = useDataContext();

  // Allowed and ordered fields per requirement
  const allowedOrdered = useMemo(
    () => ["task_id", "tenant_id", "organization_name", "service_type", "total_cost"],
    []
  );

  // PUBLIC_INTERFACE
  function toLabel(key) {
    /** Convert snake_case to Title Case label. */
    return String(key || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (m) => m.toUpperCase());
  }

  // Build columns strictly from allowed list with simple renderers
  const columns = useMemo(() => {
    return allowedOrdered.map((k) => {
      if (k === "total_cost") {
        return {
          key: k,
          label: toLabel(k),
          render: (v) =>
            typeof v === "number" ? (
              <span className="amount-positive">
                {v.toLocaleString(undefined, { style: "currency", currency: "USD" })}
              </span>
            ) : v == null || v === "" ? "—" : String(v),
          priority: 2,
        };
      }
      return {
        key: k,
        label: toLabel(k),
        render: (v) => (v == null || v === "" ? "—" : String(v)),
        priority: 2,
      };
    });
  }, [allowedOrdered]);

  // Local UI state for search on cached data
  const [query, setQuery] = useState("");

  const filteredItems = useMemo(() => {
    const q = (query || "").trim().toLowerCase();
    if (!q) return sessions || [];
    return (sessions || []).filter((s) => {
      const vals = allowedOrdered
        .map((f) => s?.[f])
        .filter((v) => v !== undefined && v !== null)
        .map((v) => String(v).toLowerCase());
      return vals.some((v) => v.includes(q));
    });
  }, [sessions, query, allowedOrdered]);

  // Reset pagination when search changes
  const tableKey = useMemo(
    () => `${(query || "").trim().toLowerCase()}|${filteredItems.length}`,
    [query, filteredItems.length]
  );

  return (
    <div>
      <Card
        title="Session Tracking"
        subtitle="Selected columns only — using cached data"
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button
              variant="secondary"
              onClick={() => setQuery("")}
              aria-label="Reset search"
              title="Reset search"
            >
              Reset
            </Button>
            <Button
              variant="primary"
              onClick={refreshSessions}
              disabled={sessionsLoading}
              aria-label="Refresh sessions"
              title="Refresh sessions"
            >
              Refresh
            </Button>
          </div>
        }
      >
        <div className="toolbar" aria-label="Sessions toolbar">
          <input
            className="input-search"
            placeholder="Search by visible fields..."
            aria-label="Search sessions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="spacer" />
        </div>

        {sessionsError && <div className="error" role="alert">{sessionsError}</div>}

        <DataTable
          key={tableKey}
          columns={columns}
          data={filteredItems}
          loading={sessionsLoading}
          pageSize={10}
          initialPage={1}
          paginationTitle="Sessions pages"
        />
      </Card>
    </div>
  );
}

import React, { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import DataTable from "../../components/DataTable.jsx";
import Tabs from "../../components/ui/Tabs.jsx";
import { deleteSession, listSessions } from "../../api/client";
import { inferColumns } from "../../components/schemaUtils";

// PUBLIC_INTERFACE
export default function Sessions() {
  /** Session tracking viewer: list and delete only (no create/update). */
  const [allItems, setAllItems] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [meta, setMeta] = useState({ page: 1, limit: 10, total: 0 });

  // Allowed fields for the session-tracking collection
  const allowed = useMemo(
    () => [
      "_id",
      "task_id",
      "tenant_id",
      "organization_name",
      "user_name",
      "service_type",
      "session_start",
      "session_end",
      "status",
      "total_cost",
      "created_at",
      "updated_at",
    ],
    []
  );

  const [columns, setColumns] = useState([{ key: "_id", label: "ID" }]);
  const [activeTab, setActiveTab] = useState("all");

  async function load(page = 1, limit = meta.limit || 10) {
    setLoading(true);
    setError("");
    try {
      const res = await listSessions({ page, limit });
      const arr = res?.items ?? (Array.isArray(res) ? res : []);
      setAllItems(arr);
      setItems(arr);
      setMeta({ page: res?.meta?.page || page, limit: res?.meta?.limit || limit, total: res?.meta?.total ?? arr.length });
      setColumns(
        inferColumns(arr, allowed, { dateFields: ["session_start", "session_end", "created_at", "updated_at"] }).map(
          (c) =>
            c.key === "status"
              ? { ...c, render: (v) => (v ? <span className="status-badge">{v}</span> : "—") }
              : c.key === "total_cost"
                ? {
                    ...c,
                    render: (v) =>
                      typeof v === "number" ? <span className="amount-positive">{v.toLocaleString()}</span> : "—",
                  }
                : c
        )
      );
    } catch (e) {
      setAllItems([]);
      setItems([]);
      setColumns([{ key: "_id", label: "ID" }]);
      setError(e?.response?.data?.message || e?.message || "Failed to load sessions.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const q = (query || "").trim().toLowerCase();
    if (!q) {
      setItems(allItems);
      return;
    }
    const filtered = (allItems || []).filter((s) => {
      const vals = allowed
        .map((f) => s?.[f])
        .concat([s?.id])
        .filter((v) => v !== undefined && v !== null)
        .map((v) => String(v).toLowerCase());
      return vals.some((v) => v.includes(q));
    });
    setItems(filtered);
  }, [query, allItems, allowed]);

  function onDelete(row) {
    setConfirmDelete(row);
  }

  async function confirmDeleteAction() {
    if (confirmDelete?._id) {
      try {
        await deleteSession(confirmDelete._id);
        setConfirmDelete(null);
        await load();
      } catch (e) {
        setError(e?.response?.data?.message || e?.message || "Failed to delete session.");
      }
    }
  }

  return (
    <div>
      <Card
        title="Session Tracking"
        subtitle="View and delete session records"
      >
        <Tabs
          tabs={[
            { key: "all", label: "All" },
            { key: "active", label: "Active" },
            { key: "completed", label: "Completed" }
          ]}
          activeKey={activeTab}
          onChange={setActiveTab}
          aria-label="Sessions tabs"
        />
        <div className="toolbar" aria-label="Sessions toolbar">
          <input
            className="input-search"
            placeholder="Search sessions..."
            aria-label="Search sessions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="spacer" />
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        <DataTable
          columns={columns}
          data={items}
          loading={loading}
          onDelete={onDelete}
          pageSize={meta.limit || 10}
          initialPage={meta.page || 1}
          serverTotal={meta.total}
          fetchPage={async (page, limit) => {
            await load(page, limit);
          }}
          paginationTitle="Sessions pages"
        />
      </Card>

      {confirmDelete && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Delete session">
          <div className="modal-card">
            <div className="modal-header">
              <h3>Delete session</h3>
              <Button variant="ghost" aria-label="Close" onClick={() => setConfirmDelete(null)}>✕</Button>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to delete this session?</p>
            </div>
            <div className="modal-footer">
              <div className="modal-actions">
                <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
                <Button variant="danger" onClick={confirmDeleteAction}>Delete</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

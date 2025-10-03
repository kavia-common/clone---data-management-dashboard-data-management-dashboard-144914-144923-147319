import React, { useMemo } from "react";
import Modal from "./ui/Modal.jsx";

/**
 * PUBLIC_INTERFACE
 * UserProfileModal
 * Accessible modal that shows a selected user's full profile in a clean, structured layout.
 * - Renders common profile fields prominently
 * - Shows all remaining fields in a key/value list
 * - Includes a raw JSON section for completeness
 */
// PUBLIC_INTERFACE
export default function UserProfileModal({ open, onClose, user }) {
  /** Modal with structured user details; expects a plain object "user". */
  const safeUser = user || {};

  // Derive avatar initial
  const avatarChar = useMemo(() => {
    const name = safeUser?.name || safeUser?.full_name || safeUser?.username || safeUser?.email || "";
    return String(name).trim().charAt(0).toUpperCase() || "U";
  }, [safeUser]);

  // Resolve tenant/organization display from multiple possible keys
  const tenantDisplay = useMemo(() => {
    return (
      safeUser?.tenant_id ??
      safeUser?.organization_name ??
      safeUser?.organization ??
      safeUser?.organization_id ??
      "—"
    );
  }, [safeUser]);

  // Common fields we want to highlight in a two-column grid
  const mainFields = useMemo(
    () => [
      { key: "name", label: "Name" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone" },
      { key: "department", label: "Department" },
      { key: "role", label: "Role" },
      { key: "status", label: "Status" },
      { key: "_id", label: "ID" },
      { key: "__tenant", label: "Tenant Id" }, // synthetic (from combined tenant/organization keys)
      { key: "created_at", label: "Created At", type: "date" },
      { key: "updated_at", label: "Updated At", type: "date" },
    ],
    []
  );

  function formatValue(v, type) {
    if (v == null || v === "") return "—";
    if (type === "date") {
      try {
        return new Date(v).toLocaleString();
      } catch {
        return String(v);
      }
    }
    if (typeof v === "object") {
      try {
        return JSON.stringify(v);
      } catch {
        return String(v);
      }
    }
    return String(v);
  }

  const mainFieldBlocks = mainFields.map((f) => {
    const raw =
      f.key === "__tenant" ? tenantDisplay : safeUser?.[f.key];
    const display = formatValue(raw, f.type);
    return (
      <div key={f.key} style={{ display: "grid", gap: 6 }}>
        <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{f.label}</div>
        <div style={{ fontWeight: 500, color: "var(--text-primary)", wordBreak: "break-word" }}>{display}</div>
      </div>
    );
  });

  // Compute "additional fields": those not shown in main grid and not synthetic
  const mainKeys = new Set(mainFields.map((f) => f.key).filter((k) => k !== "__tenant"));
  const additionalEntries = useMemo(() => {
    const entries = Object.entries(safeUser || {});
    return entries
      .filter(([k]) => !mainKeys.has(k))
      .sort(([a], [b]) => a.localeCompare(b));
  }, [safeUser, mainKeys]);

  function prettyJson(obj) {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      try {
        return String(obj);
      } catch {
        return "Unable to render";
      }
    }
  }

  const title =
    (safeUser?.name && `User Profile — ${safeUser.name}`) ||
    (safeUser?.email && `User Profile — ${safeUser.email}`) ||
    "User Profile";

  return (
    <Modal
      title={title}
      open={open}
      onClose={onClose}
      footer={
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      }
    >
      {/* Summary header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <div
          aria-hidden="true"
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            background: "var(--brand-primary)",
            color: "#fff",
            display: "grid",
            placeItems: "center",
            fontWeight: 800,
          }}
        >
          {avatarChar}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: "var(--text-primary)" }}>
            {safeUser?.name || safeUser?.full_name || "—"}
          </div>
          <div className="muted" style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
            {safeUser?.email || "—"}
          </div>
        </div>
      </div>

      {/* Main fields grid */}
      <div className="form-grid" style={{ marginBottom: 12 }}>
        {mainFieldBlocks}
      </div>

      {/* Additional fields (all remaining keys) */}
      {additionalEntries.length > 0 && (
        <>
          <div style={{ fontWeight: 600, margin: "8px 0", color: "var(--text-primary)" }}>Additional details</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
            {additionalEntries.map(([k, v]) => (
              <React.Fragment key={k}>
                <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{k}</div>
                <div style={{ color: "var(--text-primary)" }}>
                  {typeof v === "object" ? (
                    <code style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{formatValue(v)}</code>
                  ) : (
                    formatValue(v)
                  )}
                </div>
              </React.Fragment>
            ))}
          </div>
        </>
      )}

      {/* Raw JSON block for completeness */}
      <div style={{ fontWeight: 600, margin: "12px 0 6px 0", color: "var(--text-primary)" }}>Raw document</div>
      <pre
        style={{
          background: "#F8FAFC",
          border: "1px solid var(--input-border)",
          borderRadius: 8,
          padding: 12,
          overflow: "auto",
          fontSize: 12,
          maxHeight: 220,
        }}
        aria-label="Raw user JSON"
      >
        {prettyJson(safeUser)}
      </pre>
    </Modal>
  );
}

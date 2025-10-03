import React, { useMemo } from "react";
import Modal from "./ui/Modal.jsx";

/**
 * PUBLIC_INTERFACE
 * UserProfileModal
 * Accessible modal that shows a selected user's core profile information only.
 * - Renders a concise set of fields in a clean two‑column grid.
 * - Removes any "Additional details" or raw document/JSON sections to keep the modal focused.
 */
// PUBLIC_INTERFACE
export default function UserProfileModal({ open, onClose, user }) {
  /** Modal with structured core user details; expects a plain object "user". */
  const safeUser = user || {};

  // Derive avatar initial
  const avatarChar = useMemo(() => {
    const name =
      safeUser?.name ||
      safeUser?.full_name ||
      safeUser?.username ||
      safeUser?.email ||
      "";
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

  // Core fields to highlight in a two-column grid
  const mainFields = useMemo(
    () => [
      { key: "name", label: "Name" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone" },
      { key: "department", label: "Department" },
      { key: "role", label: "Role" },
      { key: "status", label: "Status" },
      { key: "__tenant", label: "Tenant Id" }, // synthetic (resolved from multiple keys)
      { key: "_id", label: "ID" },
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
    if (typeof v === "number") return String(v);
    if (typeof v === "boolean") return v ? "Yes" : "No";
    return String(v);
  }

  const mainFieldBlocks = mainFields.map((f) => {
    const raw = f.key === "__tenant" ? tenantDisplay : safeUser?.[f.key];
    const display = formatValue(raw, f.type);
    return (
      <div key={f.key} style={{ display: "grid", gap: 6, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
          {f.label}
        </div>
        <div
          style={{
            fontWeight: 500,
            color: "var(--text-primary)",
            wordBreak: "break-word",
          }}
          title={typeof display === "string" ? display : undefined}
        >
          {display}
        </div>
      </div>
    );
  });

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
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      {/* Summary header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 12,
          minWidth: 0,
        }}
      >
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
            flex: "0 0 auto",
          }}
        >
          {avatarChar}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: "var(--text-primary)" }}>
            {safeUser?.name || safeUser?.full_name || "—"}
          </div>
          <div
            className="muted"
            style={{ fontSize: 12, color: "var(--text-tertiary)" }}
            title={safeUser?.email || undefined}
          >
            {safeUser?.email || "—"}
          </div>
        </div>
      </div>

      {/* Core fields grid only */}
      <div className="form-grid" style={{ marginBottom: 4 }}>{mainFieldBlocks}</div>
    </Modal>
  );
}

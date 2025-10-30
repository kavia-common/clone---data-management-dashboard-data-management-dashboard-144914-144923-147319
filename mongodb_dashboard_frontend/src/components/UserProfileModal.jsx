import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import Button from "./ui/Button.jsx";
import Modal from "./ui/Modal.jsx";

/**
 * PUBLIC_INTERFACE
 * UserProfileModal
 * Accessible, responsive modal that shows a selected user's core profile information only.
 * - Shows ONLY: Name, Email, Department, and Tenant ID.
 * - Ocean Professional theme with sticky header and internal scroll.
 */
export default function UserProfileModal({ open, onClose, user }) {
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
      ""
    );
  }, [safeUser]);

  // Core fields restricted to Name, Email, Department, Tenant ID (read-only)
  const fields = useMemo(
    () => [
      { key: "name", label: "Name", value: safeUser?.name || safeUser?.full_name || "" },
      { key: "email", label: "Email", value: safeUser?.email || "" },
      { key: "department", label: "Department", value: safeUser?.department || "" },
      { key: "__tenant", label: "Tenant ID", value: tenantDisplay || "" },
    ],
    [safeUser, tenantDisplay]
  );

  const title =
    (safeUser?.name && `User Profile — ${safeUser.name}`) ||
    (safeUser?.email && `User Profile — ${safeUser.email}`) ||
    "User Profile";

  // ARIA ids
  const labelId = useId();
  const descId = useId();

  // Refs for focus handling and trap
  const cardRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  // Simple "enter" animation state
  const [entered, setEntered] = useState(false);

  // Manage focus trap and restoration (ESC handled by shared Modal)
  useEffect(() => {
    if (!open) return;
    setEntered(false);
    const raf = requestAnimationFrame(() => setEntered(true));

    previouslyFocusedRef.current = document.activeElement;

    const focusFirst = () => {
      if (!cardRef.current) return;
      const nodes = getFocusableElements(cardRef.current);
      if (nodes.length > 0) nodes[0].focus();
      else cardRef.current.focus();
    };
    const t = setTimeout(focusFirst, 0);

    function onKeyDown(e) {
      if (e.key === "Tab") {
        trapTabKey(e, cardRef.current);
      }
    }
    document.addEventListener("keydown", onKeyDown);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      document.removeEventListener("keydown", onKeyDown);
      try {
        if (previouslyFocusedRef.current && previouslyFocusedRef.current.focus) {
          previouslyFocusedRef.current.focus();
        }
      } catch {
        // ignore focus restoration errors
      }
      setEntered(false);
    };
  }, [open]);

  if (!open) return null;

  // Helper to format placeholders for empty values
  function displayValue(v) {
    return v == null || v === "" ? "" : String(v);
  }

  return (
    <Modal title={title} open={open} onClose={onClose}>
      {/* Sticky Header */}
      <div
        className="sticky-header"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 16px",
          boxShadow: "0 1px 0 var(--border-subtle)",
          background: "#fff",
          transform: entered ? "none" : "translateY(2px)",
          opacity: entered ? 1 : 0.98,
          transition: "transform 160ms ease, opacity 160ms ease",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <div
            aria-hidden="true"
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: "#2563EB",
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
            <h3
              id={labelId}
              style={{
                margin: 0,
                fontSize: 16,
                fontWeight: 700,
                color: "var(--text-primary)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={title}
            >
              {title}
            </h3>
            <div
              className="muted"
              id={descId}
              style={{ fontSize: 12, color: "var(--text-tertiary)" }}
            >
              Read-only user details
            </div>
          </div>
        </div>

        <button
          type="button"
          className="btn-modal-close compact"
          aria-label="Close"
          onClick={onClose}
          title="Close dialog"
        >
          Close
        </button>
      </div>

      {/* Scrollable Body */}
      <div ref={cardRef} style={{ padding: 16, flex: 1, minHeight: 0, overflow: "auto" }}>
        {/* Profile summary */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: 6,
            marginBottom: 12,
          }}
        >
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

        {/* Read-only fields */}
        <div className="form-grid" style={{ gap: 16 }}>
          {fields.map((f) => {
            const id = `${f.key}-input-${labelId}`;
            const value = displayValue(f.value);

            return (
              <label key={f.key} htmlFor={id} style={{ display: "grid", gap: 6 }}>
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--text-tertiary)",
                    fontWeight: 600,
                    letterSpacing: ".02em",
                  }}
                >
                  {f.label}
                </span>
                <input
                  id={id}
                  type="text"
                  readOnly
                  aria-readonly="true"
                  value={value}
                  placeholder={value ? undefined : "Not provided"}
                  style={{
                    border: "1px solid var(--input-border)",
                    borderRadius: 10,
                    padding: "10px 12px",
                    background: "#fff",
                    color: "var(--text-primary)",
                    outline: "none",
                    height: 40,
                    transition: "box-shadow .15s ease, border-color .15s ease",
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = "#2563EB";
                    e.currentTarget.style.boxShadow =
                      "0 0 0 3px rgba(37, 99, 235, 0.28)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "var(--input-border)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                />
              </label>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

/**
 * Get focusable nodes inside a root element.
 */
function getFocusableElements(root) {
  if (!root) return [];
  const selector =
    'a[href], area[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, object, embed, [contenteditable], [tabindex]:not([tabindex="-1"])';
  const nodes = Array.from(root.querySelectorAll(selector));
  // Only visible items
  return nodes.filter((el) => {
    const style = window.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  });
}

/**
 * Trap tab key inside a container to maintain focus within the modal.
 */
function trapTabKey(e, container) {
  if (!container) return;
  const focusable = getFocusableElements(container);
  if (focusable.length === 0) {
    e.preventDefault();
    container.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;

  if (e.shiftKey) {
    // shift + tab
    if (active === first || !container.contains(active)) {
      e.preventDefault();
      last.focus();
    }
  } else {
    // tab
    if (active === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

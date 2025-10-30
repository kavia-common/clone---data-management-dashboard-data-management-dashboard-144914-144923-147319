 /**
 * PUBLIC_INTERFACE
 * ProjectDetailsModal
 * Displays project details for a given project (Project ID, Project Name, Updated At).
 * Fetches projectName via GET /api/projects/{projectId}/name.
 *
 * Props:
 * - open: boolean
 * - onClose: function
 * - project: { project_id?: string, projectId?: string, updated_at?: string, updatedAt?: string, _id?: string }
 */

import React, { useEffect, useMemo, useState } from "react";
import Modal from "../ui/Modal.jsx";
import { fetchProjectNameDirect } from "../../api/projectName";

export default function ProjectDetailsModal({ open, onClose, project }) {
  const [projectName, setProjectName] = useState("—");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const projectId = project?.project_id || project?.projectId || project?._id || null;

  useEffect(() => {
    let ignore = false;
    async function load() {
      if (!open || !projectId) {
        setProjectName("—");
        setLoading(false);
        setError(null);
        return;
      }
      try {
        setLoading(true);
        setError(null);
        const name = await fetchProjectNameDirect(projectId);
        if (ignore) return;
        if (!name) {
          console.debug("[ProjectDetailsModal] No projectName returned for projectId", { projectId });
        }
        setProjectName(name || "—");
      } catch (err) {
        if (!ignore) {
          console.error("[ProjectDetailsModal] Error fetching project name", { projectId, error: err?.message || err });
          setProjectName("—");
          setError(err?.message || "Failed to load");
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [open, projectId]);

  const details = useMemo(() => {
    const rows = [];
    const idValue = projectId ? String(projectId) : "—";
    rows.push({ label: "Project ID", value: idValue });
    rows.push({ label: "Project Name", value: loading ? "Loading…" : (projectName || "—") });
    rows.push({
      label: "Updated At",
      value: project?.updated_at || project?.updatedAt || "—",
    });
    return rows;
  }, [projectId, projectName, loading, project]);

  return (
    <Modal title="Project Details" open={open} onClose={onClose}>
      <div className="space-y-4">
        <KeyValueList items={details} />
        {!loading && projectId && projectName === "—" && (
          <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
            Not available
          </p>
        )}
        {error && (
          <p className="text-sm" style={{ color: "var(--error, #EF4444)" }}>
            {String(error)}
          </p>
        )}
      </div>
    </Modal>
  );
}

function KeyValueList({ items = [] }) {
  // Ocean Professional: subtle labels, clear values, consistent grid to avoid layout shift.
  // Values render as plain text consistent across fields.
  return (
    <dl style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: "8px 12px", margin: 0 }}>
      {items.map((it, idx) => {
        const isElement = React.isValidElement(it.value);
        const titleText = !isElement && it.value != null ? String(it.value) : undefined;

        // Normalize optional props for the value node
        const valueProps = it.valueProps || {};
        const normalizedValueProps = {
          className: valueProps.className || valueProps.valueClassName,
          style: { ...(valueProps.style || {}), ...(valueProps.valueStyle || {}) },
        };

        // Build the final value node, cloning element when necessary to merge styles/className
        let valueNode = null;
        if (isElement) {
          const orig = it.value;
          const mergedClassName =
            [orig.props?.className, normalizedValueProps.className].filter(Boolean).join(" ") || undefined;
          const mergedStyle = { ...(orig.props?.style || {}), ...(normalizedValueProps.style || {}) };
          valueNode = React.cloneElement(orig, { className: mergedClassName, style: mergedStyle });
        } else {
          valueNode = (
            <span className={normalizedValueProps.className} style={normalizedValueProps.style}>
              {String(it.value ?? "—")}
            </span>
          );
        }

        return (
          <React.Fragment key={idx}>
            <dt
              style={{
                color: "var(--text-tertiary)",
                fontWeight: 600,
                fontSize: 12,
                textAlign: "right",
                whiteSpace: "nowrap",
              }}
              title={String(it.label || "")}
            >
              {it.label}
            </dt>
            <dd
              style={{
                margin: 0,
                color: "var(--text-primary)",
                fontSize: 14,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={titleText}
            >
              {valueNode}
            </dd>
          </React.Fragment>
        );
      })}
    </dl>
  );
}

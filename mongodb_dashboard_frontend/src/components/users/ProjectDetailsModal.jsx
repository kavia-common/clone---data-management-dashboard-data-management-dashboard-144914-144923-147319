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
import DetailsViewer from "../common/DetailsViewer.jsx";
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
    const idValue =
      projectId
        ? (
            <span
              className="project-id-pill"
              title={String(projectId)}
              style={{
                color: "#FFFFFF",
                fontWeight: 700,
                backgroundColor: "#F59E0B",
                border: "1px solid #D97706",
                borderRadius: 9999,
                padding: "4px 12px",
                fontSize: "0.875rem",
                lineHeight: 1.25,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                boxShadow: "0 1px 0 rgba(0,0,0,0.06)",
                textDecoration: "none",
                maxWidth: "100%",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {String(projectId)}
            </span>
          )
        : "—";
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
        <style>{`
          /* Project ID pill enforced styling (Ocean Professional amber) */
          .project-id-pill {
            color: #FFFFFF !important;
            font-weight: 700 !important;
            background-color: #F59E0B !important; /* light orange */
            border: 1px solid #D97706 !important;  /* dark orange */
            border-radius: 9999px !important;      /* rounded-full */
            padding: 4px 12px !important;          /* px-3 py-1 */
            font-size: 0.875rem !important;        /* text-sm */
            line-height: 1.25 !important;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            text-decoration: none;
            max-width: 100%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .project-id-pill:hover {
            background-color: #fbbf24 !important; /* keep legible on hover */
          }
          .project-id-pill:focus-visible {
            outline: none !important;
            box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.4) !important; /* focus:ring-2 ring-amber/40 */
          }
        `}</style>
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
  return (
    <dl style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: "8px 12px", margin: 0 }}>
      {items.map((it, idx) => {
        const isElement = React.isValidElement(it.value);
        const titleText = !isElement && it.value != null ? String(it.value) : undefined;

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
              {isElement ? it.value : String(it.value ?? "—")}
            </dd>
          </React.Fragment>
        );
      })}
    </dl>
  );
}

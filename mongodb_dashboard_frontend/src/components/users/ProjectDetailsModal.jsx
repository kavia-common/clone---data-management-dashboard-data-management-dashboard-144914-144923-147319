/**
 * PUBLIC_INTERFACE
 * ProjectDetailsModal
 * Displays project details for a given project (Project ID, Project Name, Updated At).
 * Fetches projectName from App Deployments enrichment by projectId.
 *
 * Props:
 * - open: boolean
 * - onClose: function
 * - project: { project_id?: string, projectId?: string, updated_at?: string, updatedAt?: string }
 */

import React, { useEffect, useMemo, useState } from "react";
import Modal from "../ui/Modal.jsx";
import DetailsViewer from "../common/DetailsViewer.jsx";
import { fetchProjectNameByProjectId } from "../../api/projectName";

export default function ProjectDetailsModal({ open, onClose, project }) {
  const [projectName, setProjectName] = useState("—");
  const [loading, setLoading] = useState(false);

  const projectId = project?.project_id || project?.projectId || project?._id || null;

  useEffect(() => {
    let ignore = false;
    async function load() {
      if (!open || !projectId) {
        setProjectName("—");
        setLoading(false);
        return;
      }
      setLoading(true);
      const name = await fetchProjectNameByProjectId(projectId);
      if (!ignore) {
        setProjectName(name || "—");
        setLoading(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [open, projectId]);

  const details = useMemo(() => {
    const rows = [];
    rows.push({ label: "Project ID", value: projectId || "—" });
    rows.push({ label: "Project Name", value: loading ? "Loading…" : projectName || "—" });
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
        {!loading && projectName === "—" && projectId && (
          <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
            Project name could not be resolved from deployments.
          </p>
        )}
      </div>
    </Modal>
  );
}

function KeyValueList({ items = [] }) {
  // Simple presentation aligned with Ocean Professional theme; DetailsViewer is more complex,
  // but here we need a straightforward list for a compact modal section.
  return (
    <dl style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: "8px 12px", margin: 0 }}>
      {items.map((it, idx) => (
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
            title={String(it.value ?? "—")}
          >
            {String(it.value ?? "—")}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

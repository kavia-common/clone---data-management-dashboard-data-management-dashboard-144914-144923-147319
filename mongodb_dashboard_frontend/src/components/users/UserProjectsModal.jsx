import React, { useMemo, useState } from "react";
import Modal from "../ui/Modal.jsx";
import Button from "../ui/Button.jsx";
import { useUserProjects } from "../../hooks/useUserProjects";
import ProjectDetailsModal from "./ProjectDetailsModal.jsx";

/**
 * PUBLIC_INTERFACE
 * UserProjectsModal
 * Modal that fetches and displays a list of projects the user has activity in (from session tracking).
 * Shows each project's project_name (fallback to project_id) and last_activity as a human-readable date/time.
 *
 * Props:
 * - open: boolean - controls visibility
 * - onClose: function - close handler
 * - userId: string - selected user's id
 * - tenantId: string - current tenant id (required)
 * - from?: string|Date - optional time range start
 * - to?: string|Date - optional time range end
 * - userName?: string - optional friendly name for title
 */
export default function UserProjectsModal({
  open,
  onClose,
  userId,
  tenantId,
  from,
  to,
  userName = "",
}) {
  const { projects, loading, error, refetch } = useUserProjects({
    userId,
    tenantId,
    from,
    to,
    enabled: open,
  });

  const title = useMemo(() => {
    const base = "User Projects";
    if (userName) return `${base} — ${userName}`;
    if (userId) return `${base} — ${userId}`;
    return base;
  }, [userId, userName]);

  function formatDate(val) {
    if (!val) return "—";
    try {
      return new Date(val).toLocaleString();
    } catch {
      return String(val);
    }
  }

  const [selectedProject, setSelectedProject] = useState(null);

  return (
    <>
      <Modal
        title={title}
        open={open}
        onClose={onClose}
        footer={
          <div className="modal-actions">
            <Button variant="ghost" onClick={() => refetch()}>Refresh</Button>
            <Button variant="ghost" onClick={onClose}>Close</Button>
          </div>
        }
      >
        {/* Loading, Error, Empty states */}
        {loading && <div className="table-empty">Loading projects...</div>}
        {!loading && error && (
          <div className="error" role="alert" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}
        {!loading && !error && (!projects || projects.length === 0) && (
          <div className="table-empty">
            No projects found for this user in the selected tenant. This usually means no sessions have been recorded yet.
          </div>
        )}

        {/* List of projects */}
        {!loading && !error && projects && projects.length > 0 && (
          <div
            role="list"
            aria-label="User projects"
            style={{ display: "grid", gap: 8 }}
          >
            {projects.map((p, idx) => {
              const key = p.project_id || p.projectId || idx;
              const name =
                p.project_name ||
                p.projectName ||
                p.project_id ||
                p.projectId ||
                "—";
              const last = p.last_activity || p.lastActivity || null;

              return (
                <div
                  key={key}
                  role="listitem"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto auto",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 12px",
                    border: "1px solid var(--border-subtle)",
                    background: "var(--bg-surface)",
                    borderRadius: 10,
                    boxShadow: "var(--shadow)",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        color: "var(--text-primary)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: 360,
                      }}
                      title={String(name)}
                    >
                      {name}
                    </div>
                    <div
                      className="muted"
                      style={{ fontSize: 12, color: "var(--text-tertiary)" }}
                      title={String(p.project_id || p.projectId || "")}
                    >
                      ID: {p.project_id || p.projectId || "—"}
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--text-secondary)",
                      whiteSpace: "nowrap",
                    }}
                    title={last ? formatDate(last) : undefined}
                  >
                    Last activity: {formatDate(last)}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Button variant="primary" onClick={() => setSelectedProject(p)}>
                      View Details
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Modal>

      <ProjectDetailsModal
        open={Boolean(selectedProject)}
        onClose={() => setSelectedProject(null)}
        project={selectedProject}
      />
    </>
  );
}

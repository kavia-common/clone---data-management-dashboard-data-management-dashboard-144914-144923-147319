import React, { useMemo } from "react";
import Card from "../ui/Card.jsx";
import Tag from "../ui/Tag.jsx";
import DataTable from "../DataTable.jsx";
import LoadingState from "../common/LoadingState.jsx";
import ErrorState from "../common/ErrorState.jsx";
import useActiveUsers from "../../hooks/useActiveUsers";

/**
 * PUBLIC_INTERFACE
 * ActiveUsersList
 * Renders a paginated, sortable list of users with status=active.
 *
 * Props:
 * - page?: number
 * - limit?: number
 * - sort?: string
 * - onRowClick?: (user) => void
 */
export default function ActiveUsersList({ page = 1, limit = 20, sort = "-created_at", onRowClick }) {
  const { users, loading, error, total, setPage, setLimit } = useActiveUsers({ page, limit, sort });

  const columns = useMemo(() => {
    return [
      {
        key: "name",
        label: "Name",
        priority: 1,
        render: (v, row) => (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 600 }}>{row?.name || "—"}</span>
            {row?.is_admin ? (
              <Tag aria-label="Admin badge" className="tag--amber">Admin</Tag>
            ) : null}
          </div>
        ),
      },
      { key: "email", label: "Email", priority: 2 },
      {
        key: "department",
        label: "Department",
        priority: 3,
        render: (v) => v || "—",
      },
      {
        key: "__status",
        label: "Status",
        priority: 3,
        render: (_v, row) => (
          <Tag aria-label="User status" className={`tag--${(row?.status || "unknown").toLowerCase()}`}>
            {row?.status || "unknown"}
          </Tag>
        ),
      },
    ];
  }, []);

  return (
    <Card title="Active Users" subtitle="Users currently marked as active">
      {loading ? (
        <LoadingState message="Loading active users..." />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setPage(1)} />
      ) : users.length === 0 ? (
        <div className="card-content">
          <div className="empty" aria-live="polite">
            No active users found.
          </div>
        </div>
      ) : (
        <div className="card-content" style={{ paddingTop: 0 }}>
          <DataTable
            columns={columns}
            data={users}
            loading={loading}
            onRowClick={onRowClick}
            pageSize={limit}
            initialPage={1}
            serverTotal={total}
            fetchPage={async (nextPage, pageSize) => {
              setPage(nextPage);
              setLimit(pageSize);
            }}
            paginationTitle="Active Users pages"
            maxBodyHeight={380}
            forceHorizontalScroll={false}
          />
        </div>
      )}
    </Card>
  );
}

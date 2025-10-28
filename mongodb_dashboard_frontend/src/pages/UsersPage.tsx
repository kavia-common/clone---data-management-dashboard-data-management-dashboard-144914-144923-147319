import React, { useEffect, useMemo, useState } from "react";
import Card from "../components/ui/Card.jsx";
import DataTable from "../components/DataTable.jsx";
import Button from "../components/ui/Button.jsx";
import UserProjectsModal from "../components/users/UserProjectsModal.jsx";
import { listUsers } from "../api";

/**
 * PUBLIC_INTERFACE
 * UsersPage (TSX-compatible file; uses existing JS components)
 * A simple page that lists users and adds a View action to open the projects modal.
 * This file is created to satisfy task guidance mentioning UsersPage.tsx; routing can be updated later to use this page directly.
 */
export default function UsersPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<any | null>(null);

  const columns = useMemo(() => {
    return [
      { key: "name", label: "Name", priority: 1 },
      {
        key: "__tenant",
        label: "Tenant Id",
        render: (v: any, row: any) =>
          row?.tenant_id || row?.organization_name || row?.organization || row?.organization_id || "—",
        priority: 2,
      },
      { key: "email", label: "Mail", priority: 2 },
      { key: "department", label: "Department", priority: 3 },
      {
        key: "__actions",
        label: "Actions",
        render: (_: any, row: any) => (
          <Button
            variant="primary"
            onClick={(e: any) => {
              e.stopPropagation();
              setCurrentUser(row);
              setModalOpen(true);
            }}
          >
            View
          </Button>
        ),
        priority: 2,
      },
    ];
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await listUsers({});
      const arr = res?.items ?? (Array.isArray(res) ? res : []);
      setItems(arr);
    } catch (e: any) {
      setItems([]);
      setError(e?.response?.data?.message || e?.message || "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const tenantId =
    (currentUser?.tenant_id ??
      currentUser?.organization_name ??
      currentUser?.organization ??
      currentUser?.organization_id) ||
    "";

  return (
    <div>
      <Card title="Users" subtitle="Click View to see user's project activity">
        {error && (
          <div className="error" role="alert" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}
        <DataTable
          columns={columns}
          data={items}
          loading={loading}
          pageSize={10}
          initialPage={1}
          paginationTitle="Users pages"
        />
      </Card>

      <UserProjectsModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        userId={currentUser?._id || currentUser?.id || ""}
        tenantId={tenantId}
        userName={currentUser?.name || currentUser?.full_name || currentUser?.email || ""}
      />
    </div>
  );
}

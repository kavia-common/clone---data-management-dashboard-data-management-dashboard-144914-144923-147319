import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';

// Prefer existing UI primitives if available
import Modal from '../ui/Modal.jsx';
import Tabs from '../ui/Tabs.jsx';

// Fallbacks if Modal/Tabs are ever missing in a different template context.
// These are not used here because this project already has Modal and Tabs components.
// Keeping lightweight fallbacks commented for reference.
// const FallbackModal = ({ open, onClose, title, children, width = 800 }) => {
//   if (!open) return null;
//   return (
//     <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
//       <div className="bg-white rounded-lg shadow-xl w-full" style={{ maxWidth: width }}>
//         <div className="flex items-center justify-between px-4 py-3 border-b">
//           <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
//           <button onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-gray-100">✕</button>
//         </div>
//         <div className="p-4">{children}</div>
//       </div>
//     </div>
//   );
// };

// Views
import { useUserProjects } from '../../hooks/useUserProjects';

// Internal presentational view for user details
function UserDetailsView({ user }) {
  if (!user) return <div className="text-gray-500">No user selected</div>;
  const rows = [
    ['Name', user.name || user.full_name || `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim()],
    ['Email', user.email],
    ['Role', user.role || user.user_role],
    ['Tenant', user.tenant_id || user.organization_name || user.organization || user.organization_id],
    ['Status', user.status],
    ['Created', user.createdAt || user.created_at],
    ['Updated', user.updatedAt || user.updated_at],
  ];
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {rows.map(([label, value]) => (
        <div key={label} className="bg-gray-50 rounded p-3">
          <div className="text-xs uppercase text-gray-500">{label}</div>
          <div className="text-sm text-gray-900 break-words">{value || '—'}</div>
        </div>
      ))}
    </div>
  );
}

UserDetailsView.propTypes = {
  user: PropTypes.object,
};

// Internal presentational view for user projects
function UserProjectsView({ userId, tenantId, from, to }) {
  const enabled = Boolean(userId && tenantId);
  const { projects, loading, error, refetch } = useUserProjects({ userId, tenantId, from, to, enabled });

  if (!enabled) {
    return <div className="text-gray-500">Select a user with a valid tenant to view projects.</div>;
  }
  if (loading) return <div className="table-empty">Loading projects…</div>;
  if (error) {
    return (
      <div className="error" role="alert" style={{ marginBottom: 12 }}>
        {error} <button onClick={() => refetch()} className="btn btn-ghost" style={{ height: 28, padding: '2px 8px' }}>Retry</button>
      </div>
    );
  }

  const list = projects || [];
  return (
    <div className="space-y-3">
      {list.length === 0 && <div className="text-gray-500">No projects found.</div>}
      {list.map((p, idx) => {
        const key = p.project_id || p.projectId || idx;
        const name = p.name || p.project_name || p.projectName || p.project_id || p.projectId || '—';
        const desc = p.description || p.project_description || '';
        return (
          <div key={key} className="border rounded p-3">
            <div className="font-medium" title={String(name)}>{name}</div>
            {desc ? <div className="text-sm text-gray-600" title={String(desc)}>{desc}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

UserProjectsView.propTypes = {
  userId: PropTypes.string,
  tenantId: PropTypes.string,
  from: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date)]),
  to: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date)]),
};

/**
 * PUBLIC_INTERFACE
 * TabbedUserModal
 * A single modal that combines user details and user projects into two tabs.
 * Props:
 * - open: boolean
 * - onClose: function
 * - user: object | null
 * - tenantId: string | undefined
 * - defaultTab: 'details' | 'projects' (initial tab when opening)
 * - from?: string|Date
 * - to?: string|Date
 */
// PUBLIC_INTERFACE
export default function TabbedUserModal({
  open,
  onClose,
  user,
  tenantId,
  defaultTab = 'details',
  from = undefined,
  to = undefined,
}) {
  // Keep internal tab state synced to defaultTab whenever the modal opens
  const [activeTab, setActiveTab] = useState(defaultTab);
  useEffect(() => {
    if (open) setActiveTab(defaultTab);
  }, [open, defaultTab]);

  const userId = useMemo(() => user?._id || user?.id || '', [user]);

  const tabs = useMemo(
    () => [
      { key: 'details', label: 'Details' },
      { key: 'projects', label: 'Projects' },
    ],
    []
  );

  const title = useMemo(() => {
    if (!user) return 'User';
    return user.name || user.full_name || user.email || 'User';
  }, [user]);

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
      <div style={{ marginBottom: 12 }}>
        <Tabs tabs={tabs} activeKey={activeTab} onChange={setActiveTab} aria-label="User info tabs" />
      </div>

      {activeTab === 'details' && <UserDetailsView user={user} />}

      {activeTab === 'projects' && (
        <UserProjectsView userId={userId} tenantId={tenantId} from={from} to={to} />
      )}
    </Modal>
  );
}

TabbedUserModal.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  user: PropTypes.object,
  tenantId: PropTypes.string,
  defaultTab: PropTypes.oneOf(['details', 'projects']),
  from: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date)]),
  to: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date)]),
};

import React, { useEffect, useMemo, useState } from 'react';
import Modal from '../ui/Modal.jsx';
import Button from '../ui/Button.jsx';
import { formatCurrency } from '../utils/numberFormat';

/**
 * PUBLIC_INTERFACE
 * CostsDetailsModal
 * This modal fetches and displays structured costs data when opened:
 * - Users costs: user name/email, type, user_cost
 * - Projects per user: project name and project_cost
 * - LLM costs: totals and/or per-model/user breakdown from /api/llm-costs
 *
 * Props:
 * - isOpen: boolean to control visibility
 * - onClose: function to close modal
 */
const CostsDetailsModal = ({ isOpen, onClose }) => {
  const [users, setUsers] = useState([]);
  const [llmCosts, setLlmCosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Fetch helper to normalize possible envelope responses ({success,data,meta}) or raw arrays
  const normalizeList = (payload) => {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (payload && typeof payload === 'object' && Array.isArray(payload.data)) {
      return payload.data;
    }
    return [];
  };

  // Fetch users, per-user projects costs, and llm-costs
  useEffect(() => {
    if (!isOpen) return;
    let canceled = false;

    const fetchData = async () => {
      setLoading(true);
      setError('');
      try {
        // 1) Users
        // TODO: if API path differs in your environment, centralize and update here.
        const usersResp = await fetch('/api/users?limit=200');
        if (!usersResp.ok) {
          throw new Error(`Failed to fetch users: ${usersResp.status}`);
        }
        const usersData = await usersResp.json();
        const usersList = normalizeList(usersData);

        // Try to fetch per-user total user_cost and per-project costs via the provided endpoints if available.
        // Fallback to fields present on /api/users payload (e.g., type, email/name, projects array if any).
        const enrichedUsers = [];
        for (const u of usersList) {
          const userId = String(u._id || u.id || u.user_id || '');
          let userCostTotal = u.user_cost ?? u.total_cost ?? null;
          let userType = u.type ?? u.user_type ?? null;
          let displayName =
            u.name ||
            u.full_name ||
            u.username ||
            u.email ||
            u.user_name ||
            userId ||
            '—';

          // Try to get user totals
          try {
            if (userId) {
              const uCostResp = await fetch(`/api/users/${encodeURIComponent(userId)}/costs`);
              if (uCostResp.ok) {
                const uCostData = await uCostResp.json();
                // The spec mentions total_cost (alias user_cost)
                const total = uCostData?.total_cost ?? uCostData?.user_cost;
                if (typeof total === 'number') {
                  userCostTotal = total;
                }
                // Some APIs may provide type in this response too
                if (!userType && (uCostData?.type || uCostData?.user_type)) {
                  userType = uCostData?.type || uCostData?.user_type;
                }
              }
            }
          } catch {
            // Ignore per-user totals fetch failure; fallback to what we have
          }

          // Try to get per-project costs for the user
          let projects = [];
          if (userId) {
            try {
              const uProjResp = await fetch(`/api/users/${encodeURIComponent(userId)}/projects/costs`);
              if (uProjResp.ok) {
                const uProjData = await uProjResp.json();
                const projList = Array.isArray(uProjData) ? uProjData : uProjData?.projects;
                if (Array.isArray(projList)) {
                  projects = projList.map((p) => ({
                    project_id: p.project_id || p.id || p._id || '—',
                    project_name: p.project_name || p.name || '—',
                    project_cost:
                      typeof p.project_cost === 'number'
                        ? p.project_cost
                        : typeof p.cost === 'number'
                        ? p.cost
                        : null,
                  }));
                }
              }
            } catch {
              // Ignore failure; fallback to any inlined projects
            }
          }

          // If projects still empty, fallback to any projects array on user document
          if (!projects.length && Array.isArray(u.projects)) {
            projects = u.projects.map((p) => ({
              project_id: p.project_id || p.id || p._id || '—',
              project_name: p.project_name || p.name || '—',
              project_cost:
                typeof p.project_cost === 'number'
                  ? p.project_cost
                  : typeof p.cost === 'number'
                  ? p.cost
                  : null,
            }));
          }

          enrichedUsers.push({
            id: userId || displayName,
            name: displayName,
            email: u.email || null,
            type: userType || '—',
            user_cost: typeof userCostTotal === 'number' ? userCostTotal : null,
            projects,
          });
        }

        // 2) LLM Costs
        const llmResp = await fetch('/api/llm-costs?limit=200');
        if (!llmResp.ok) {
          throw new Error(`Failed to fetch LLM costs: ${llmResp.status}`);
        }
        const llmData = await llmResp.json();
        const llmList = normalizeList(llmData);

        if (!canceled) {
          setUsers(enrichedUsers);
          setLlmCosts(llmList);
        }
      } catch (e) {
        if (!canceled) {
          setError(e?.message || 'Failed to load cost details');
        }
      } finally {
        if (!canceled) setLoading(false);
      }
    };

    fetchData();

    return () => {
      canceled = true;
    };
  }, [isOpen]);

  return (
    <Modal open={isOpen} onClose={onClose} title="Costs Details">
      <div className="space-y-6">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            <span className="ml-3 text-gray-700">Loading cost details…</span>
          </div>
        )}

        {!!error && (
          <div className="rounded-md bg-red-50 border border-red-200 text-red-700 px-4 py-3">
            {error}
          </div>
        )}

        {!loading && !error && (
          <>
            <UsersCostsSection users={users} />
            <LlmCostsSection costs={llmCosts} />
          </>
        )}

        <div className="flex justify-end pt-2">
          <Button onClick={onClose} variant="secondary">
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
};

const UsersCostsSection = ({ users }) => {
  return (
    <section>
      <h3 className="text-lg font-semibold text-gray-900 mb-3">Users</h3>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gradient-to-r from-blue-500/10 to-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                User
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Type
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                User Cost
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Projects
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {(users || []).map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-gray-900">{u.name || '—'}</span>
                    {u.email ? (
                      <span className="text-xs text-gray-500">{u.email}</span>
                    ) : null}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center rounded-full bg-blue-50 text-blue-700 px-2 py-0.5 text-xs">
                    {u.type || '—'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-sm font-semibold text-gray-900">
                  {u.user_cost != null ? formatCurrency(u.user_cost) : '—'}
                </td>
                <td className="px-4 py-3">
                  <ProjectsSubtable projects={u.projects || []} />
                </td>
              </tr>
            ))}
            {!users?.length && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-500">
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};

const ProjectsSubtable = ({ projects }) => {
  if (!projects?.length) {
    return <span className="text-sm text-gray-500">—</span>;
  }
  return (
    <div className="rounded-md border border-gray-100">
      <table className="min-w-full">
        <thead>
          <tr className="bg-gray-50">
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Project</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">Project Cost</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p, idx) => (
            <tr key={`${p.project_id}-${idx}`} className="border-t border-gray-100">
              <td className="px-3 py-2 text-sm text-gray-800">{p.project_name || '—'}</td>
              <td className="px-3 py-2 text-right text-sm text-gray-900">
                {p.project_cost != null ? formatCurrency(p.project_cost) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const LlmCostsSection = ({ costs }) => {
  const { total, rows } = useMemo(() => {
    // Attempt to compute an overall total if not provided
    let sum = 0;
    const list = Array.isArray(costs) ? costs : [];
    const mapped = list.map((c, idx) => {
      const model = c.llm_model || c.model || '—';
      const user = c.user_id || c.user || c.user_name || '—';
      const project = c.project_id || c.project || c.project_name || null;
      const cost =
        typeof c.total_cost === 'number'
          ? c.total_cost
          : typeof c.cost === 'number'
          ? c.cost
          : typeof c.amount === 'number'
          ? c.amount
          : null;

      if (typeof cost === 'number') sum += cost;

      return {
        key: `${model}-${user}-${project || idx}`,
        model,
        user,
        project,
        cost,
      };
    });
    return { total: sum, rows: mapped };
  }, [costs]);

  return (
    <section>
      <h3 className="text-lg font-semibold text-gray-900 mb-3">LLM Costs</h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <div className="rounded-lg bg-white border border-gray-200 shadow-sm p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Total LLM Cost</div>
          <div className="mt-1 text-2xl font-bold text-gray-900">{formatCurrency(total)}</div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gradient-to-r from-blue-500/10 to-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Model
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                User
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Project
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Cost
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="px-4 py-3 text-sm text-gray-900">{r.model}</td>
                <td className="px-4 py-3 text-sm text-gray-900">{r.user}</td>
                <td className="px-4 py-3 text-sm text-gray-900">{r.project || '—'}</td>
                <td className="px-4 py-3 text-right text-sm text-gray-900">
                  {r.cost != null ? formatCurrency(r.cost) : '—'}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-500">
                  No LLM costs found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default CostsDetailsModal;

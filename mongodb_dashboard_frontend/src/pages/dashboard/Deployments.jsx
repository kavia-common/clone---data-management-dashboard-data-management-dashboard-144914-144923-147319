// import React, { useEffect, useMemo, useState, useRef } from "react";
// import Card from "../../components/ui/Card.jsx";
// import DataTable from "../../components/DataTable.jsx";
// import { listDeployments } from "../../api";
// import DeploymentsOverTime from "../../components/charts/DeploymentsOverTime.jsx";
// import DeploymentStatusBarChart from "../../components/charts/DeploymentStatusBarChart.jsx";
// import useDeploymentStatusCounts from "../../hooks/useDeploymentStatusCounts";



// /**
//  * PUBLIC_INTERFACE
//  * Deployments page
//  * Restore prior column definitions.
//  * Columns:
//  * - branch_name
//  * - status (badge)
//  * - created_at
//  * - updated_at
//  * Reverts status badge wrapping and special width classes introduced today.
//  */
// export default function Deployments() {
//   const [items, setItems] = useState([]);
//   const [loading, setLoading] = useState(false);
//   const [error, setError] = useState("");
//   const [meta, setMeta] = useState({ page: 1, limit: 10, total: 0 });

//   // Allowed and ordered fields (prior version)
//   const allowedOrdered = useMemo(
//     () => ["branch_name", "status", "created_at", "updated_at"],
//     []
//   );

//   // PUBLIC_INTERFACE
//   function toLabel(key) {
//     /** Convert snake_case to Title Case label. */
//     return String(key || "")
//       .replace(/_/g, " ")
//       .replace(/\b\w/g, (m) => m.toUpperCase());
//   }

//   function fmtDate(val) {
//     if (!val) return "—";
//     try {
//       return new Date(val).toLocaleString();
//     } catch {
//       return String(val);
//     }
//   }

//   // PUBLIC_INTERFACE
//   function buildColumns(rows = []) {
//     /** Build DataTable columns strictly from the allowed list, preserving order. */
//     const presentKeys = new Set();
//     (rows || []).forEach((r) => Object.keys(r || {}).forEach((k) => presentKeys.add(k)));

//     return allowedOrdered.map((k) => {
//       if (k === "status") {
//         return {
//           key: k,
//           label: toLabel(k),
//           render: (v) => {
//             const text = v == null || v === "" ? "—" : String(v);
//             return text === "—" ? "—" : <span className="status-badge" title={text}>{text}</span>;
//           },
//           priority: 2,
//           className: "col-status-wide",
//           // Slightly wider so long snake_case values fit on desktop without wrap
//           minWidth: 200,
//           maxWidth: 520,
//         };
//       }
//       if (k === "created_at" || k === "updated_at") {
//         return {
//           key: k,
//           label: toLabel(k),
//           render: (v) => fmtDate(v),
//           priority: 3,
//         };
//       }
//       return {
//         key: k,
//         label: toLabel(k),
//         render: (v) => (v == null || v === "" ? "—" : String(v)),
//         priority: 2,
//       };
//     });
//   }

//   const [columns, setColumns] = useState(buildColumns([]));
//   const lastSortRef = useRef({ key: "", dir: "asc" });



//   // PUBLIC_INTERFACE
//   async function load(page = 1, limit = meta.limit || 10, sortKey, sortDir) {
//     /**
//      * Load deployments from server with pagination and optional server-driven sorting.
//      * Reverts additional mapping and UI-only fields introduced today.
//      */
//     setLoading(true);
//     setError("");
//     try {
//       const sortFieldMap = {
//         branch_name: "branch_name",
//         status: "status",
//         created_at: "created_at",
//         updated_at: "updated_at",
//       };
//       const params = { page, limit };
//       if (sortKey) {
//         const backendField = sortFieldMap[sortKey] || String(sortKey);
//         params.sort = sortDir === "desc" ? `-${backendField}` : backendField;
//       }
//       const res = await listDeployments(params);
//       const arr = res?.items ?? (Array.isArray(res) ? res : []);
//       // Ensure a stable hidden key for React row keys by normalizing to _id,
//       // without exposing any ID in the visible columns.
//       const arrMapped = (arr || []).map((d) => {
//         if (d && (d._id || d.id || d.deployment_id)) {
//           return { _id: d._id || d.id || d.deployment_id, ...d };
//         }
//         return d;
//       });
//       setItems(arrMapped || []);
//       setMeta({
//         page: res?.meta?.page || page,
//         limit: res?.meta?.limit || limit,
//         total: res?.meta?.total ?? (Array.isArray(arrMapped) ? arrMapped.length : 0),
//       });
//       setColumns(buildColumns(arrMapped || []));
//     } catch (e) {
//       setItems([]);
//       setColumns(buildColumns([]));
//       setError(e?.response?.data?.message || e?.message || "Failed to load deployments.");
//     } finally {
//       setLoading(false);
//     }
//   }

//   useEffect(() => {
//     load(1, meta.limit || 10, lastSortRef.current.key, lastSortRef.current.dir);
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, []);



//   // Hook to show status counts in a bar chart (unchanged)
//   const { data: statusData, loading: statusLoading, error: statusError } = useDeploymentStatusCounts({
//     strategy: "clientAggregate",
//     useServer: false,
//     pageLimit: 200,
//     maxPages: 3,
//   });

//   return (
//     <div className="grid">
//       {/* Chart block spans full width above the table */}
//       <div className="block-full">
//         <DeploymentsOverTime height={340} />
//       </div>

//       {/* Status counts bar chart */}
//       <div className="block-full">
//         <DeploymentStatusBarChart
//           title="Deployments by Status"
//           subtitle="All statuses"
//           data={statusData}
//           loading={statusLoading}
//           error={statusError}
//           height={300}
//         />
//       </div>

//       {/* Table card */}
//       <div className="block-full">
//         <Card title="App Deployments" subtitle="Deployments list">

//           {error && <div className="error" role="alert">{error}</div>}
//           <DataTable
//             columns={columns}
//             data={items}
//             loading={loading}
//             pageSize={meta.limit || 10}
//             initialPage={meta.page || 1}
//             serverTotal={meta.total}
//             fetchPage={async (page, limit, sortKey, sortDir) => {
//               if (sortKey) lastSortRef.current = { key: sortKey, dir: sortDir || "asc" };
//               await load(page, limit, sortKey, sortDir);
//             }}
//             paginationTitle="Deployment pages"
//           />
//         </Card>
//       </div>
//     </div>
//   );
// }

import React, { useEffect, useMemo, useState, useRef } from "react";
import Card from "../../components/ui/Card.jsx";
import DataTable from "../../components/DataTable.jsx";
import { listDeployments } from "../../api";
import DeploymentsOverTime from "../../components/charts/DeploymentsOverTime.jsx";
import DeploymentStatusBarChart from "../../components/charts/DeploymentStatusBarChart.jsx";
import useDeploymentStatusCounts from "../../hooks/useDeploymentStatusCounts";

/**
 * Convert snake_case project_name → Title Case
 * tic_tac_toe_app → Tic Tac Toe App
 */
function formatProjectName(name = "") {
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Copy to clipboard helper
 */
function copyToClipboard(text) {
  navigator.clipboard.writeText(text);
}

export default function Deployments() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState({ page: 1, limit: 10, total: 0 });

  const allowedOrdered = useMemo(
    () => ["branch_name", "project_name", "app_url", "status"],
    []
  );

  function toLabel(key) {
    return String(key || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (m) => m.toUpperCase());
  }

  /** Build table columns */
  function buildColumns() {
    return allowedOrdered.map((k) => {
      // STATUS badge
      if (k === "status") {
        return {
          key: k,
          label: toLabel(k),
          render: (v) => {
            const text = v || "—";
            return (
              <span className="status-badge" title={text}>
                {text}
              </span>
            );
          },
          priority: 2,
          className: "col-status-wide",
          minWidth: 150,
        };
      }

      // PROJECT NAME (formatted)
      if (k === "project_name") {
        return {
          key: k,
          label: "Project Name",
          render: (v) => (v ? formatProjectName(v) : "—"),
          priority: 2,
        };
      }

      // APP URL with copy button
      if (k === "app_url") {
        return {
          key: k,
          label: "App URL",
          render: (v) =>
            v ? (
              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <a href={v} target="_blank" rel="noopener noreferrer">
                  {v}
                </a>
                <button
                  onClick={() => copyToClipboard(v)}
                  className="copy-btn"
                  title="Copy URL"
                >
                  📋
                </button>
              </div>
            ) : (
              "—"
            ),
          priority: 2,
          minWidth: 260,
        };
      }

      return {
        key: k,
        label: toLabel(k),
        render: (v) => (v ? String(v) : "—"),
        priority: 2,
      };
    });
  }

  const [columns, setColumns] = useState(buildColumns());
  const lastSortRef = useRef({ key: "", dir: "asc" });

  /** Load deployments */
  async function load(page = 1, limit = meta.limit, sortKey, sortDir) {
    setLoading(true);
    setError("");

    try {
      const fieldMap = {
        branch_name: "branch_name",
        project_name: "project_name",
        app_url: "app_url",
        status: "status",
      };

      const params = { page, limit };

      if (sortKey) {
        const backendField = fieldMap[sortKey] || sortKey;
        params.sort = sortDir === "desc" ? `-${backendField}` : backendField;
      }

      const res = await listDeployments(params);
      const arr = res?.items ?? [];

      const arrMapped = arr.map((d) => ({
        _id: d._id || d.id || d.deployment_id,
        ...d,
      }));

      setItems(arrMapped);

      setMeta({
        page: res?.meta?.page || page,
        limit: res?.meta?.limit || limit,
        total: res?.meta?.total ?? arrMapped.length,
      });

      setColumns(buildColumns());
    } catch (e) {
      setItems([]);
      setColumns(buildColumns());
      setError(e?.response?.data?.message || e?.message || "Failed to load deployments.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(1, meta.limit, lastSortRef.current.key, lastSortRef.current.dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Deployment status chart */
  const {
    data: statusData,
    loading: statusLoading,
    error: statusError,
  } = useDeploymentStatusCounts({
    strategy: "clientAggregate",
    useServer: false,
    pageLimit: 200,
    maxPages: 3,
  });

  return (
    <div className="grid">
      <div className="block-full">
        <DeploymentsOverTime height={340} />
      </div>

      <div className="block-full">
        <DeploymentStatusBarChart
          title="Deployments by Status"
          subtitle="All statuses"
          data={statusData}
          loading={statusLoading}
          error={statusError}
          height={300}
        />
      </div>

      <div className="block-full">
        <Card title="App Deployments" subtitle="Deployments list">
          {error && <div className="error">{error}</div>}

          <DataTable
            columns={columns}
            data={items}
            loading={loading}
            pageSize={meta.limit}
            initialPage={meta.page}
            serverTotal={meta.total}
            fetchPage={async (page, limit, sortKey, sortDir) => {
              if (sortKey) lastSortRef.current = { key: sortKey, dir: sortDir };
              await load(page, limit, sortKey, sortDir);
            }}
            paginationTitle="Deployment pages"
          />
        </Card>
      </div>
    </div>
  );
}

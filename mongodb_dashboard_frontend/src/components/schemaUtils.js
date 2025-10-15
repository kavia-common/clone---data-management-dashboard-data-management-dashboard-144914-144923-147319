//
// PUBLIC_INTERFACE
// inferColumns: Given rows and an allowlist, return a columns array suitable for DataTable.
// Ensures columns only reflect fields that exist in data and are within the allowlist.
//
export function inferColumns(rows = [], allowlist = [], options = {}) {
  /** Returns DataTable columns built by intersecting present data fields with the allowlist. */
  const keys = new Set();
  (rows || []).forEach((doc) => {
    Object.keys(doc || {}).forEach((k) => keys.add(k));
  });

  const present = allowlist.filter((k) => keys.has(k));
  const finalKeys = present.length ? present : allowlist.length ? [allowlist[0]] : [];

  const toLabel = (k) =>
    k === "_id"
      ? "ID"
      : k
          .replace(/_/g, " ")
          .replace(/\b\w/g, (m) => m.toUpperCase());

  const dateFields = new Set(options.dateFields || ["created_at", "updated_at", "timestamp", "createdAt", "updatedAt"]);

  const cols = finalKeys.map((k) => {
    if (dateFields.has(k)) {
      return {
        key: k,
        label: toLabel(k),
        render: (v, row) => {
          const val = v ?? row?.[k];
          return val ? new Date(val).toLocaleString() : "—";
        },
        priority: 3,
      };
    }
    return { key: k, label: toLabel(k) };
  });

  return cols;
}

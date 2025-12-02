import React from 'react';
import { useLlmCosts } from '../hooks/useLlmCosts';

export default function CostsPage() {
  // PUBLIC_INTERFACE
  // CostsPage renders a simple table with pagination controls.
  const { items, loading, error, page, limit, total, setQuery } = useLlmCosts({
    page: 1,
    limit: 20,
    sort: '-timestamp',
  });

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div style={{ padding: 16 }}>
      <h2>LLM Costs</h2>
      <div style={{ marginBottom: 12 }}>
        <button disabled={loading || page <= 1} onClick={() => setQuery({ page: page - 1 })}>
          Prev
        </button>
        <span style={{ margin: '0 8px' }}>
          Page {page} / {totalPages} (total {total})
        </span>
        <button disabled={loading || page >= totalPages} onClick={() => setQuery({ page: page + 1 })}>
          Next
        </button>
        <select
          value={limit}
          onChange={(e) => setQuery({ page: 1, limit: parseInt(e.target.value, 10) })}
          style={{ marginLeft: 8 }}
        >
          {[10, 20, 50, 100, 200].map((n) => (
            <option key={n} value={n}>
              {n} / page
            </option>
          ))}
        </select>
      </div>
      {loading && <div>Loading…</div>}
      {error && <div style={{ color: 'red' }}>{error}</div>}
      {!loading && !error && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Timestamp</th>
                <th style={{ textAlign: 'left' }}>Model</th>
                <th style={{ textAlign: 'left' }}>Provider</th>
                <th style={{ textAlign: 'left' }}>User</th>
                <th style={{ textAlign: 'right' }}>Total Cost</th>
                <th style={{ textAlign: 'right' }}>Input Tokens</th>
                <th style={{ textAlign: 'right' }}>Output Tokens</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r._id}>
                  <td>{r.timestamp || r.created_at}</td>
                  <td>{r.llm_model}</td>
                  <td>{r.provider}</td>
                  <td>{String(r.user_id ?? '')}</td>
                  <td style={{ textAlign: 'right' }}>
                    {typeof r.numeric_total_cost === 'number'
                      ? r.numeric_total_cost.toFixed(4)
                      : typeof r.total_cost === 'number'
                      ? r.total_cost.toFixed(4)
                      : String(r.total_cost ?? '')}
                  </td>
                  <td style={{ textAlign: 'right' }}>{r.breakdown?.input_tokens ?? ''}</td>
                  <td style={{ textAlign: 'right' }}>{r.breakdown?.output_tokens ?? ''}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: 16 }}>
                    No records
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

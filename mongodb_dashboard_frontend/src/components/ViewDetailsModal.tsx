import React from 'react';
import Modal from './ui/Modal';
import { formatLabel } from '../utils/formatLabel';

// PUBLIC_INTERFACE
export type ViewDetailsModalProps = {
  /** Controls visibility of the modal */
  isOpen: boolean;
  /** Callback when modal requests to close */
  onClose: () => void;
  /** The raw JSON data object to display. This is not mutated. */
  data: Record<string, any> | null | undefined;
  /** Optional title to show in the header */
  title?: string;
};

/**
 * ViewDetailsModal
 * Renders a generic details viewer for an arbitrary JSON object.
 * It formats labels by replacing underscores with spaces and capitalizing words
 * while preserving the underlying data intact.
 *
 * Rendering approach:
 * - Iterate over Object.entries(data)
 * - Render label as formatLabel(key)
 * - Render value using String(value) for primitives, and JSON serialization otherwise
 *
 * This component is intentionally generic so any details view across the app can reuse it.
 */
const ViewDetailsModal: React.FC<ViewDetailsModalProps> = ({
  isOpen,
  onClose,
  data,
  title = 'View Details',
}) => {
  const entries = React.useMemo(() => {
    if (!data || typeof data !== 'object') return [];
    try {
      return Object.entries(data);
    } catch {
      return [];
    }
  }, [data]);

  // Convert value to a string for display while preserving original value in memory.
  const renderValue = (value: any) => {
    if (value == null) return '—';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    // For arrays/objects, show a compact JSON preview
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      {/* Inline documentation:
          - Keys are displayed using formatLabel(key)
          - Data is not mutated; this only affects labels shown to users */}
      <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
        {entries.length === 0 ? (
          <div style={{ padding: '0.75rem', color: '#6b7280' }}>No details available.</div>
        ) : (
          <dl style={{ margin: 0 }}>
            {entries.map(([key, value]) => (
              <div
                key={key}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 2fr',
                  gap: '0.5rem 1rem',
                  padding: '0.5rem 0.75rem',
                  borderBottom: '1px solid #e5e7eb',
                }}
              >
                <dt style={{ fontWeight: 600, color: '#111827' }}>{formatLabel(key)}</dt>
                <dd
                  style={{
                    margin: 0,
                    whiteSpace: typeof value === 'object' ? 'pre-wrap' : 'normal',
                    color: '#374151',
                    fontFamily: typeof value === 'object' ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' : 'inherit',
                    fontSize: typeof value === 'object' ? '0.85rem' : 'inherit',
                  }}
                >
                  {renderValue(value)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </Modal>
  );
};

export default ViewDetailsModal;

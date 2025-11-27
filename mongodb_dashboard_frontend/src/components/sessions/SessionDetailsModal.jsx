import React, { useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../ui/Modal.jsx';
import Button from '../ui/Button.jsx';
import { useDataContext } from '../../context/DataContext.jsx';
import { toTitleCaseName } from '../../utils/stringFormatters.js';
import { usdToCredits, formatCredits, parseUsdToNumber } from '../../utils/currency.js';
import { formatCurrencyAmount } from '../../utils/formatCurrency';
import { getUserBasic } from '../../api/users';
import './SessionDetailsModal.css';

/**
 * PUBLIC_INTERFACE
 * SessionDetailsModal
 * A responsive, accessible modal that presents session details in a clean layout aligned to the Ocean Professional theme.
 *
 * Requirements for this task:
 * - Remove the second section that showed IP and related details.
 * - Show only these summary fields at the top:
 *   User_name, Agents used (names from agents), service_type, organization_name,
 *   Number of sessions (from session_breakdown), Total Duration (sum of durations from session_breakdown),
 *   Total Cost consumed (total_cost).
 * - Preserve loading/empty/error handling and do not alter other components.
 *
 * Props:
 * - open: boolean - controls visibility
 * - onClose: function - invoked to close modal
 * - session: object - session data to render
 */
function SessionDetailsModal({ open, onClose, session }) {
  const headerId = 'session-details-title';
  const contentRef = useRef(null);
  const { users } = useDataContext?.() || { users: [] };

  // Fetch fallback for user display name
  const [fetchedUserName, setFetchedUserName] = useState('');
  const [fetchingUserName, setFetchingUserName] = useState(false);

  useEffect(() => {
    // Focus modal content when opened for accessibility
    if (open && contentRef.current) {
      contentRef.current.focus();
    }
  }, [open]);

  const formatDateLocal = (val) => {
    if (!val) return '—';
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleString();
    } catch {
      return '—';
    }
  };

  // PUBLIC_INTERFACE
  const toHms = (seconds) => {
    /** Convert seconds to HH:mm:ss string. */
    const secs = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = String(Math.floor(secs / 3600)).padStart(2, '0');
    const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
    const sRem = String(secs % 60).padStart(2, '0');
    return `${h}:${m}:${sRem}`;
  };

  // PUBLIC_INTERFACE
  const computeDurationPretty = (start, end, fallbackSeconds) => {
    /** Prefer computing from start/end; fallback to HH:mm:ss using numeric duration if available */
    if (start && end) {
      try {
        const s = new Date(start).getTime();
        const e = new Date(end).getTime();
        if (!isNaN(s) && !isNaN(e)) {
          const secs = Math.max(0, Math.floor((e - s) / 1000));
          return toHms(secs);
        }
      } catch {
        // ignore
      }
    }
    if (fallbackSeconds != null && Number.isFinite(Number(fallbackSeconds))) {
      return toHms(Number(fallbackSeconds));
    }
    if (typeof fallbackSeconds === 'string' && fallbackSeconds.trim()) return fallbackSeconds.trim();
    return '—';
  };

  const resolveUserName = (userRef) => {
    if (!userRef) return 'Unknown User';
    if (typeof userRef === 'string') {
      const candidate = users?.find?.(
        (u) => u?._id === userRef || u?.id === userRef || u?.userId === userRef
      );
      if (candidate) {
        return (
          candidate.displayName ||
          candidate.fullName ||
          candidate.name ||
          candidate.username ||
          candidate.email ||
          'Unknown User'
        );
      }
      return userRef || 'Unknown User';
    }
    if (typeof userRef === 'object') {
      const candidateId = userRef._id || userRef.id || userRef.userId || userRef.user_id;
      if (candidateId) {
        const candidate = users?.find?.(
          (u) => u?._id === candidateId || u?.id === candidateId || u?.userId === candidateId
        );
        if (candidate) {
          return (
            candidate.displayName ||
            candidate.fullName ||
            candidate.name ||
            candidate.username ||
            candidate.email ||
            'Unknown User'
          );
        }
      }
      return (
        userRef.displayName ||
        userRef.fullName ||
        userRef.name ||
        userRef.username ||
        userRef.email ||
        userRef.user_name ||
        'Unknown User'
      );
    }
    return 'Unknown User';
  };

  const pickFrom = (s, keys) => {
    for (const k of keys) {
      if (k.includes('.')) {
        const parts = k.split('.');
        let cur = s;
        let found = true;
        for (const p of parts) {
          if (cur && Object.prototype.hasOwnProperty.call(cur, p)) {
            cur = cur[p];
          } else {
            found = false;
            break;
          }
        }
        if (found && cur != null) return cur;
      } else if (s && s[k] !== undefined && s[k] !== null) {
        return s[k];
      }
    }
    return undefined;
  };

  // Normalize ID fields for title (kept)
  const title = useMemo(() => {
    const id = session?.sessionId || session?._id || session?.id || '';
    return `Session Details - ${id || '—'}`;
  }, [session]);

  // Fetch a basic user name when DataContext could not resolve a meaningful name
  useEffect(() => {
    let ignore = false;
    async function load() {
      const userIdRef = (() => {
        if (!session || typeof session !== 'object') return '';
        return pickFrom(session, [
          'userId',
          'user_id',
          'user._id',
          'user.id',
          'user',
          'owner_id',
          'owner',
        ]) || '';
      })();

      if (!open || !userIdRef) {
        setFetchedUserName('');
        setFetchingUserName(false);
        return;
      }
      const displayUserResolved = resolveUserName(
        pickFrom(session || {}, ['user', 'userId', 'user_id', 'username', 'email', 'owner', 'ownerEmail'])
      );
      if (displayUserResolved && !/^unknown user$/i.test(String(displayUserResolved))) {
        setFetchedUserName('');
        return;
      }
      try {
        setFetchingUserName(true);
        const res = await getUserBasic(String(userIdRef));
        if (!ignore) {
          setFetchedUserName(res?.name || '');
        }
      } catch {
        if (!ignore) {
          setFetchedUserName('');
        }
      } finally {
        if (!ignore) setFetchingUserName(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session]);

  // Summary fields as per requirements
  const coreDetails = useMemo(() => {
    if (!session || typeof session !== 'object') return {};

    // Resolve User_name
    const resolvedFromContext = resolveUserName(
      pickFrom(session || {}, ['user', 'userId', 'user_id', 'username', 'email', 'owner', 'ownerEmail'])
    );
    const nameCandidate = (() => {
      if (fetchingUserName) return 'Loading...';
      const fetched = fetchedUserName?.trim();
      if (fetched) return fetched;
      const resolved = String(resolvedFromContext || '').trim();
      if (resolved && !/^unknown user$/i.test(resolved)) return toTitleCaseName(resolved);
      const fromField = session?.User_name ?? session?.user_name ?? '';
      if (fromField && typeof fromField === 'string') return toTitleCaseName(fromField);
      return 'Not available';
    })();

    // Agents used (names from agents)
    const agentsRaw = pickFrom(session, ['agents', 'Agents', 'agentNames', 'agent_names']);
    const agentsList = Array.isArray(agentsRaw)
      ? agentsRaw
      : (typeof agentsRaw === 'string' && agentsRaw.includes(',')) ? agentsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
    const agentsDisplay = agentsList.length ? agentsList.join(', ') : '—';

    // Service type
    const serviceType = pickFrom(session || {}, ['serviceType', 'service_type', 'provider', 'modelProvider']) ?? '—';

    // Organization/Tenant name
    const orgName = pickFrom(session || {}, [
      'organization_name',
      'organizationName',
      'tenant_name',
      'tenantName',
      'organization',
      'tenant',
    ]) ?? '—';

    // Number of sessions and Total Duration derived from session_breakdown
    const breakdownArray = Array.isArray(session?.session_breakdown)
      ? session.session_breakdown
      : (session?.session_breakdown && typeof session.session_breakdown === 'object') ? [session.session_breakdown] : [];
    const numberOfSessions = breakdownArray.length || 0;

    // Sum durations from breakdowns
    const totalSeconds = breakdownArray.reduce((acc, b) => {
      const raw = b?.duration ?? b?.total_duration ?? b?.elapsed;
      let secs = Number(raw);
      if (!Number.isFinite(secs)) {
        try {
          const s = new Date(b?.session_start ?? b?.sessionStart ?? b?.start ?? b?.startedAt).getTime();
          const e = new Date(b?.session_end ?? b?.sessionEnd ?? b?.end ?? b?.endedAt ?? b?.finishedAt).getTime();
          if (!isNaN(s) && !isNaN(e)) {
            secs = Math.max(0, Math.floor((e - s) / 1000));
          } else {
            secs = 0;
          }
        } catch {
          secs = 0;
        }
      }
      return acc + Math.max(0, Math.floor(secs || 0));
    }, 0);
    const totalDurationPretty = toHms(totalSeconds);

    // Total cost consumed (total_cost)
    let totalCostVal = pickFrom(session || {}, ['total_cost', 'totalCost', 'cost_total', 'costTotal']);
    // Normalize when value is string like "$1.23"
    if (totalCostVal != null && typeof totalCostVal !== 'number') {
      const parsed = parseUsdToNumber(totalCostVal);
      if (parsed != null) totalCostVal = parsed;
    }
    const totalCostText = Number.isFinite(Number(totalCostVal))
      ? formatCurrencyAmount(Number(totalCostVal), { currency: 'USD' })
      : '—';

    return {
      'User Name': nameCandidate,
      'Agents Used': agentsDisplay,
      'Service Type': orgName === '—' ? serviceType : serviceType, // keep label mapping explicit
      'Organization': orgName,
      'Number of Sessions': numberOfSessions,
      'Total Duration': totalDurationPretty,
      'Total Cost Consumed': totalCostText,
    };
  }, [session, fetchedUserName, fetchingUserName]);

  // Normalize and memoize session_breakdown list (kept for reference, no IP/secondary details)
  const breakdownList = useMemo(() => {
    const raw = session?.session_breakdown;
    const asArray = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
    return asArray.map((b) => {
      const sbStart = b?.session_start ?? b?.sessionStart ?? b?.start ?? b?.startedAt;
      const sbEnd = b?.session_end ?? b?.sessionEnd ?? b?.end ?? b?.endedAt ?? b?.finishedAt;
      const sbDuration = b?.duration ?? b?.total_duration ?? b?.elapsed;
      const agentRaw = b?.Agent ?? b?.agent ?? b?.agent_name ?? b?.agentName;
      const agentText = Array.isArray(agentRaw)
        ? (agentRaw.length ? agentRaw.join(', ') : '—')
        : (agentRaw != null && String(agentRaw).trim() ? String(agentRaw) : '—');
      return {
        startRaw: sbStart,
        endRaw: sbEnd,
        durationRaw: sbDuration,
        start: formatDateLocal(sbStart),
        end: formatDateLocal(sbEnd),
        duration: computeDurationPretty(sbStart, sbEnd, sbDuration),
        agent: agentText,
      };
    });
  }, [session]);

  return (
    <Modal open={open} onClose={onClose} title={title} className="session-details-modal modal--session modal--session-details">
      {/* Header */}
      <div
        className="sticky-header"
        style={{
          zIndex: 1,
          background: 'var(--bg-surface, #fff)',
          padding: '12px 20px',
          boxShadow: '0 1px 0 var(--border-subtle)',
        }}
      >
        <h2
          id={headerId}
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 700,
            color: 'var(--text-primary, #111827)',
          }}
          title={title}
        >
          {title}
        </h2>
      </div>

      {/* Body */}
      <div
        ref={contentRef}
        tabIndex={-1}
        id={`${headerId}-content`}
        style={{
          padding: 24, // comfortable padding
          gap: 16,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'auto',
          WebkitOverflowScrolling: 'touch',
          wordBreak: 'break-word',
          overflowWrap: 'anywhere',
          flex: 1,
          minHeight: 0,
          background: 'var(--bg-canvas, #f9fafb)',
        }}
      >
        {/* Summary grid (as per requirements) */}
        <section
          aria-label="Session summary"
          className="details-card"
          style={{
            position: 'relative',
            background: 'var(--bg-surface, #ffffff)',
            border: '1px solid var(--border-subtle, #E5E7EB)',
            borderRadius: 16,
            padding: 24,
            boxShadow: '0 8px 24px rgba(16,24,40,0.08)',
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
            maxHeight: '520px',
            minHeight: '200px',
            overflowY: 'auto',
            overflowX: 'hidden',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <div
            role="group"
            aria-label="Label and value pairs"
            className="details-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              columnGap: 32,
              rowGap: 0,
            }}
          >
            {Object.entries(coreDetails).map(([label, value]) => {
              const isPlaceholder =
                value === '—' || value === 'Unknown User' || value === 'Not available' || value === 'Loading...';
              return (
                <div key={label} className="detail-item" style={{ minWidth: 0 }}>
                  <div
                    className="detail-label"
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--text-tertiary, #64748B)',
                      letterSpacing: '0.02em',
                      marginBottom: 6,
                    }}
                  >
                    {label}
                  </div>
                  <div
                    className="detail-value"
                    style={{
                      fontSize: 14,
                      fontWeight: isPlaceholder ? 500 : 600,
                      color: isPlaceholder ? 'var(--text-tertiary, #6B7280)' : 'var(--text-primary, #111827)',
                      lineHeight: '20px',
                      whiteSpace: 'normal',
                      overflowWrap: 'anywhere',
                    }}
                    title={typeof value === 'string' ? value : undefined}
                  >
                    {String(value)}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Per requirements: remove the entire second section; only keep the summary fields above. */}
        {breakdownList.length === 0 ? (
          <div
            style={{
              fontSize: 13,
              color: 'var(--text-tertiary, #6B7280)',
              padding: '8px 6px',
            }}
          >
            No additional session breakdown available.
          </div>
        ) : null}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--border-subtle, #E5E7EB)',
          background: 'var(--bg-surface, #ffffff)',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          className="btn-modal-close"
          style={{ width: '100%', height: 46, borderRadius: 12 }}
          aria-label="Close"
          title="Close"
        >
          Close
        </button>
      </div>

      <style>{`
        @media (max-width: 639px) {
          .details-card [aria-label="Label and value pairs"] {
            grid-template-columns: 1fr !important;
            row-gap: 0 !important;
          }
        }
        .details-grid .detail-item {
          padding: 10px 0;
          border-top: 1px solid var(--border-subtle, #E5E7EB);
        }
        .details-grid .detail-item:nth-child(1),
        .details-grid .detail-item:nth-child(2) {
          border-top: none;
        }
      `}</style>
    </Modal>
  );
}

export default SessionDetailsModal;

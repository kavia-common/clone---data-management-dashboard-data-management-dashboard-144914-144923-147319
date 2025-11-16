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
 * session_breakdown is shown as a simple selectable list (Session 1, Session 2, ...)
 * with a details section below showing 4 fields for the selected item:
 *  - session_start, session_end, duration, Agent
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

  // Local selection state for session_breakdown list
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => {
    // Focus modal content when opened for accessibility
    if (open && contentRef.current) {
      contentRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    // Reset selection on new session
    setSelectedIdx(0);
  }, [session]);

  const formatDateLocal = (val) => {
    if (!val) return '\u2014';
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return '\u2014';
      return d.toLocaleString();
    } catch {
      return '\u2014';
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
    return '\u2014';
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

  // Normalize some top-level fields
  const { userIdRef, displayUserResolved, createdAt, lastUpdatedAt, sessionId } = useMemo(() => {
    const s = session || {};
    const createdAtRaw = pickFrom(s, [
      'created_at', 'createdAt', 'startedAt', 'started_at', 'start_time', 'startTime', 'created', 'timestamp', 'session_start', 'sessionStart', 'begin_time', 'beginTime'
    ]);

    const lastUpdatedPrimary = pickFrom(s, ['last_updated']);
    let normalizedLastUpdatedAt = lastUpdatedPrimary;
    if (!normalizedLastUpdatedAt) {
      normalizedLastUpdatedAt = pickFrom(s, [
        'updatedAt', 'updated_at',
        'modifiedAt', 'modified_at',
        'lastModified', 'last_modified',
        'lastActivityAt', 'last_activity_at',
        'finishedAt', 'finished_at',
        'endedAt', 'ended_at'
      ]);
    }

    const normalizedCreatedAt = createdAtRaw || undefined;
    const id = pickFrom(s, ['sessionId', '_id', 'id']);

    const uId = pickFrom(s, [
      'userId',
      'user_id',
      'user._id',
      'user.id',
      'user',
      'owner_id',
      'owner',
    ]);

    const displayUser = (() => {
      const resolved = resolveUserName(
        pickFrom(s, ['user', 'userId', 'user_id', 'username', 'email', 'owner', 'ownerEmail'])
      );
      const rawName = s?.User_name ?? resolved ?? 'Unknown User';
      return typeof rawName === 'string' ? toTitleCaseName(rawName) : rawName;
    })();

    return {
      userIdRef: uId ? String(uId) : '',
      displayUserResolved: displayUser,
      createdAt: normalizedCreatedAt,
      lastUpdatedAt: normalizedLastUpdatedAt,
      sessionId: id || '',
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, users]);

  // Fetch a basic user name when DataContext could not resolve a meaningful name
  useEffect(() => {
    let ignore = false;
    async function load() {
      if (!open || !userIdRef) {
        setFetchedUserName('');
        setFetchingUserName(false);
        return;
      }
      if (displayUserResolved && !/^unknown user$/i.test(String(displayUserResolved))) {
        setFetchedUserName('');
        return;
      }
      try {
        setFetchingUserName(true);
        const res = await getUserBasic(userIdRef);
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
  }, [open, userIdRef, displayUserResolved]);

  // Build non-breakdown core details (kept from previous behavior)
  const coreDetails = useMemo(() => {
    if (!session || typeof session !== 'object') return {};
    const nameCandidate = (() => {
      if (fetchingUserName) return 'Loading...';
      const fetched = fetchedUserName?.trim();
      if (fetched) return fetched;
      const resolved = String(displayUserResolved || '').trim();
      if (resolved && !/^unknown user$/i.test(resolved)) return resolved;
      return 'Not available';
    })();

    const details = {
      'User ID': userIdRef || '\u2014',
      'User Name': nameCandidate,
      'Session ID': sessionId || '\u2014',
      'Project ID':
        pickFrom(session || {}, ['project_id', 'projectId', 'project', 'projectSlug']) ??
        pickFrom(session || {}, ['projectName', 'project_name', 'projectLabel', 'project_label']) ??
        '\u2014',
      'Service Type':
        pickFrom(session || {}, ['serviceType', 'service_type', 'provider', 'modelProvider']) ?? '\u2014',
      Tenant:
        pickFrom(session || {}, [
          'tenant',
          'tenantId',
          'tenant_id',
          'organization',
          'organization_id',
          'organizationId',
          'tenantName',
          'tenant_name',
        ]) ?? '\u2014',
      'Started At': formatDateLocal(createdAt),
      'Last Updated At': formatDateLocal(lastUpdatedAt),
      Duration: computeDurationPretty(createdAt, lastUpdatedAt),
    };

    // Optional: enrich with "User Cost"
    try {
      const s = session;
      const findUserCostNumber = () => {
        if (!s || typeof s !== 'object') return null;
        for (const [k, v] of Object.entries(s)) {
          const norm = String(k || '')
            .toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/[^a-z0-9_]/g, '');
          if (norm === 'user_cost' || norm === 'usercost') {
            if (typeof v === 'number') return Number.isFinite(v) ? v : null;
            const parsed = parseUsdToNumber(v);
            if (parsed != null) return parsed;
            const n = Number(v);
            return Number.isFinite(n) ? n : null;
          }
        }
        return null;
      };
      const userCostNum = findUserCostNumber();
      if (userCostNum != null) {
        const usdText = formatCurrencyAmount(userCostNum, { currency: 'USD' });
        const creditsText = formatCredits(usdToCredits(userCostNum));
        details['User Cost'] = `${usdText} \u2022 Credits Used: ${creditsText}`;
      }
    } catch {
      // ignore
    }

    return details;
  }, [session, userIdRef, displayUserResolved, fetchedUserName, fetchingUserName, createdAt, lastUpdatedAt, sessionId]);

  // Normalize and memoize session_breakdown list
  const breakdownList = useMemo(() => {
    const raw = session?.session_breakdown;
    const asArray = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
    return asArray.map((b) => {
      const sbStart = b?.session_start ?? b?.sessionStart ?? b?.start ?? b?.startedAt;
      const sbEnd = b?.session_end ?? b?.sessionEnd ?? b?.end ?? b?.endedAt ?? b?.finishedAt;
      const sbDuration = b?.duration ?? b?.total_duration ?? b?.elapsed;
      const agentRaw = b?.Agent ?? b?.agent ?? b?.agent_name ?? b?.agentName;
      const agentText = Array.isArray(agentRaw)
        ? agentRaw.join(', ')
        : (agentRaw != null && String(agentRaw).trim() ? String(agentRaw) : '\u2014');
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

  // Selected breakdown item details
  const selectedBreakdown = breakdownList[selectedIdx] || null;

  const title = useMemo(() => {
    const id = session?.sessionId || session?._id || session?.id || '';
    return `Session Details - ${id || '\u2014'}`;
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
          padding: 20,
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
        {/* Core Details grid (unchanged from before) */}
        <section
          aria-label="Core details"
          className="details-card"
          style={{
            position: 'relative',
            background: 'var(--bg-surface, #ffffff)',
            border: '1px solid var(--border-subtle, #E5E7EB)',
            borderRadius: 12,
            padding: 16,
            boxShadow: 'var(--shadow-sm, 0 1px 2px rgba(16,24,40,0.04))',
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
                value === '\u2014' || value === 'Unknown User' || value === 'Not available' || value === 'Loading...';
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

        {/* Session Breakdown: simple vertical list and details below (no internal scroll container) */}
        <section
          aria-label="Session breakdown"
          className="details-card"
          style={{
            position: 'relative',
            background: 'var(--bg-surface, #ffffff)',
            border: '1px solid var(--border-subtle, #E5E7EB)',
            borderRadius: 12,
            padding: 16,
            boxShadow: 'var(--shadow-sm, 0 1px 2px rgba(16,24,40,0.04))',
          }}
        >
          {/* List of sessions */}
          <div role="listbox" aria-label="Sessions list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {breakdownList.length === 0 ? (
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--text-tertiary, #6B7280)',
                  padding: '8px 6px',
                }}
              >
                No sessions in breakdown
              </div>
            ) : (
              breakdownList.map((b, idx) => {
                const isActive = idx === selectedIdx;
                return (
                  <button
                    key={idx}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onClick={() => setSelectedIdx(idx)}
                    style={{
                      textAlign: 'left',
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid var(--border-subtle, #E5E7EB)',
                      background: isActive ? 'rgba(37, 99, 235, 0.08)' : 'transparent',
                      color: 'var(--text-primary, #111827)',
                      cursor: 'pointer',
                    }}
                    title={`Session ${idx + 1}`}
                  >
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>
                      Session {idx + 1}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary, #6B7280)' }}>
                      {b.start} • {b.end}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary, #6B7280)' }}>
                      {b.duration} • {b.agent}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Selected session details below the list */}
          <div
            aria-live="polite"
            aria-atomic="true"
            style={{
              marginTop: 12,
              borderTop: '1px solid var(--border-subtle, #E5E7EB)',
              paddingTop: 12,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8, color: 'var(--text-primary, #111827)' }}>
              {breakdownList.length ? `Session ${selectedIdx + 1} Details` : 'Session Details'}
            </div>

            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
              <li>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary, #6B7280)', fontWeight: 600 }}>
                  Session Start
                </span>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary, #111827)' }}>
                  {selectedBreakdown ? selectedBreakdown.start : '\u2014'}
                </div>
              </li>
              <li>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary, #6B7280)', fontWeight: 600 }}>
                  Session End
                </span>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary, #111827)' }}>
                  {selectedBreakdown ? selectedBreakdown.end : '\u2014'}
                </div>
              </li>
              <li>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary, #6B7280)', fontWeight: 600 }}>
                  Duration
                </span>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary, #111827)' }}>
                  {selectedBreakdown ? selectedBreakdown.duration : '\u2014'}
                </div>
              </li>
              <li>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary, #6B7280)', fontWeight: 600 }}>
                  Agent
                </span>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary, #111827)' }}>
                  {selectedBreakdown ? selectedBreakdown.agent : '\u2014'}
                </div>
              </li>
            </ul>
          </div>
        </section>
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

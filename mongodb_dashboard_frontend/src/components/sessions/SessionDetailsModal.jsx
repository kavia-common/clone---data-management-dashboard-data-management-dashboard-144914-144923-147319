import React, { useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../ui/Modal.jsx';

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
 * Updated behavior:
 * - The session_breakdown list is rendered as ALL items at once, vertically stacked and scrollable,
 *   each block displaying:
 *     Breakdown • Session Start
 *     Breakdown • Session End
 *     Breakdown • Duration
 *     Breakdown • Agent
 * - Dates are formatted in local time (toLocaleString). Duration is formatted as HH:mm:ss when possible.
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
      'User ID': userIdRef || '—',
      'User Name': nameCandidate,
      'Session ID': sessionId || '—',
      'Project ID':
        pickFrom(session || {}, ['project_id', 'projectId', 'project', 'projectSlug']) ??
        pickFrom(session || {}, ['projectName', 'project_name', 'projectLabel', 'project_label']) ??
        '—',
      'Service Type':
        pickFrom(session || {}, ['serviceType', 'service_type', 'provider', 'modelProvider']) ?? '—',
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
        ]) ?? '—',
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
        details['User Cost'] = `${usdText} • Credits Used: ${creditsText}`;
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

  const title = useMemo(() => {
    const id = session?.sessionId || session?._id || session?.id || '';
    return `Session Details - ${id || '—'}`;
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
          padding: 24, // increased padding
          gap: 16, // keep comfortable spacing
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
        {/* Core Details grid */}
        <section
          aria-label="Session breakdown"
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

            /* ⭐ Better height handling */
            maxHeight: '520px',
            minHeight: '240px',

            /* ⭐ Smooth scrolling */
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
         <h3
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: 'var(--text-primary, #111827)',
              marginBottom: 8,
            }}
          >
            Session Breakdowns
          </h3>

        {/* Session Breakdown: render all sessions at once in a vertically stacked, scrollable list */}
        <section
          aria-label="Session breakdown"
          className="details-card"
          style={{
            position: 'relative',
            background: 'var(--bg-surface, #ffffff)',
            border: '1px solid var(--border-subtle, #E5E7EB)',
            borderRadius: 16, // increased from 12
            padding: 10, // increased from 16
            boxShadow: 'var(--shadow-md, 0 8px 24px rgba(16,24,40,0.12))', // larger shadow
            display: 'flex',
            flexDirection: 'column',
            gap: 10, // increased from 12
            maxHeight: 600, // increased to allow taller card (within modal)
            overflow: 'auto',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {/* Total Duration summary row */}
          {(() => {
            // Sum durations from the raw breakdown entries: prefer numeric duration if present, else compute from start/end
            const totalSeconds = (session?.session_breakdown && Array.isArray(session.session_breakdown)
              ? session.session_breakdown
              : (session?.session_breakdown && typeof session.session_breakdown === 'object' ? [session.session_breakdown] : [])
            ).reduce((acc, b) => {
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
            const totalHms = toHms(totalSeconds);

            return (
              <div
                role="row"
                aria-label="Total Duration"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  alignItems: 'center',
                  border: '1px solid var(--border-subtle, #E5E7EB)',
                  borderRadius: 12,
                  padding: '10px 14px',
                  background: 'transparent',
                  marginBottom: 4,
                }}
              >
                <div style={{ fontSize: 12, color: 'var(--text-tertiary, #6B7280)', fontWeight: 700, letterSpacing: '0.02em' }}>
                  Total Duration
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary, #111827)' }} title={totalHms}>
                  {totalHms}
                </div>
              </div>
            );
          })()}
         
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
            breakdownList.map((b, idx) => (
              <div
                key={idx}
                role="group"
                aria-label={`Session ${idx + 1}`}
                style={{
                  border: '1px solid var(--border-subtle, #E5E7EB)',
                  borderRadius: 14,
                  padding: 16,
                  background: 'transparent',
                  display: 'grid',
                  gap: 12,
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary, #111827)' }}>
                  Session {idx + 1}
                </div>

                <div style={{ fontSize: 12, color: 'var(--text-tertiary, #6B7280)', fontWeight: 600 }}>
                  Session Start
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary, #111827)' }}>
                  {b.start || '—'}
                </div>

                <div style={{ fontSize: 12, color: 'var(--text-tertiary, #6B7280)', fontWeight: 600 }}>
                  Session End
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary, #111827)' }}>
                  {b.end || '—'}
                </div>

                <div style={{ fontSize: 12, color: 'var(--text-tertiary, #6B7280)', fontWeight: 600 }}>
                  Duration
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary, #111827)' }}>
                  {b.duration || '—'}
                </div>

                <div style={{ fontSize: 12, color: 'var(--text-tertiary, #6B7280)', fontWeight: 600 }}>
                  Agent
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary, #111827)' }}>
                  {b.agent || '—'}
                </div>
              </div>
            ))
          )}
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

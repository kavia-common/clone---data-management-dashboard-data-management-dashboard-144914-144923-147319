import React, { useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../ui/Modal.jsx';
import { useDataContext } from '../../context/DataContext.jsx';
import { toTitleCaseName } from '../../utils/stringFormatters.js';
import { formatLabel } from '../../utils/formatLabel';
import { usdToCredits, formatCredits, parseUsdToNumber } from '../../utils/currency.js';
import { formatCurrencyAmount } from '../../utils/formatCurrency';
import { getUserBasic } from '../../api/users';

/**
 * PUBLIC_INTERFACE
 * SessionDetailsModal
 * A responsive, accessible modal that presents session details in a clean two-column layout aligned to the Ocean Professional theme.
 *
 * Props:
 * - open: boolean - controls visibility
 * - onClose: function - invoked to close modal
 * - session: object - session data to render
 *
 * Design and UX:
 * - Uses parent Modal overlay; keeps sticky header within card with subtle border-bottom
 * - Two-column responsive grid (minmax 240px, 1fr) stacking to single column <640px
 * - Labels use secondary text color; values use primary text color
 * - Comfortable spacing, 1px borders, soft shadows; zebra striping on detail items (optional enhancement)
 * - No metadata section
 */
function SessionDetailsModal({ open, onClose, session }) {
  const headerId = 'session-details-title';
  const contentRef = useRef(null);
  const { users } = useDataContext?.() || { users: [] };

  // User name fetch state (for cases where DataContext doesn't have a match)
  const [fetchedUserName, setFetchedUserName] = useState('');
  const [fetchingUserName, setFetchingUserName] = useState(false);

  // Focus modal content when opened for accessibility
  useEffect(() => {
    if (open && contentRef.current) {
      contentRef.current.focus();
    }
  }, [open]);

  // Helpers
  const formatDate = (val) => {
    // Render a formatted local date-time or an em-dash placeholder if missing/invalid.
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
  const computeDuration = (start, end) => {
    /** Compute human-readable duration given start and end timestamps (ms or ISO). */
    if (!start || !end) return '\u2014';
    try {
      const s = new Date(start).getTime();
      const e = new Date(end).getTime();
      if (isNaN(s) || isNaN(e)) return '\u2014';
      let ms = Math.max(0, e - s);
      const secs = Math.floor(ms / 1000);
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const sRem = secs % 60;
      const parts = [];
      if (h) parts.push(`${h}h`);
      if (m || h) parts.push(`${m}m`);
      parts.push(`${sRem}s`);
      return parts.join(' ');
    } catch {
      return '\u2014';
    }
  };

  // PUBLIC_INTERFACE
  const resolveUserName = (userRef) => {
    /**
     * Resolve a user-friendly name from user reference:
     * - If an object with name/displayName/fullName/email exists, pick appropriately
     * - If an id, search DataContext users for a matching _id/id/userId and prefer displayName/fullName/name/username/email
     */
    if (!userRef) return 'Unknown User';
    // If already a descriptive string (e.g., username/email)
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
      // If the object has an id-like, try to match a richer record
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

  // Utility: safely pick the first defined value by probing dot/flat aliases
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

  // Extract normalized references up-front for user and timestamps
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

    // Resolve user ID robustly (may be in different shapes)
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

      // If displayUserResolved is already meaningful (not Unknown User), skip fetch
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

  // Collect required and requested details; preserve previously approved fields.
  const coreDetails = useMemo(() => {
    if (!session || typeof session !== 'object') return {};

    // Compute duration using startedAt (createdAt alias) and the normalized last_updated
    const durationStr = computeDuration(createdAt, lastUpdatedAt);

    // Dev-only diagnostics per instructions
    if (process.env.NODE_ENV !== 'production') {
      try {
        // eslint-disable-next-line no-console
        console.log('[SessionDetailsModal:debug]', {
          user_id: userIdRef,
          last_updated: lastUpdatedAt,
        });
      } catch {
        // ignore logging errors
      }
    }

    // Determine display name with fetch fallback
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
      'Project ID': pickFrom(session || {}, ['project_id', 'projectId', 'project', 'projectSlug']) ??
        pickFrom(session || {}, ['projectName', 'project_name', 'projectLabel', 'project_label']) ??
        '\u2014',
      'Service Type': pickFrom(session || {}, ['serviceType', 'service_type', 'provider', 'modelProvider']) ?? '\u2014',
      Tenant: pickFrom(session || {}, ['tenant', 'tenantId', 'tenant_id', 'organization', 'organization_id', 'organizationId', 'tenantName', 'tenant_name']) ?? '\u2014',
      'Started At': formatDate(createdAt),
      'Last Updated At': formatDate(lastUpdatedAt),
      Duration: durationStr,
    };

    // Enhance: If the session payload includes a user cost field (any casing/spacing),
    // render "User Cost: $X • Credits Used: N" inline without mutating data.
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
      // do not block rendering on formatter errors
    }

    return details;
  }, [session, userIdRef, displayUserResolved, fetchedUserName, fetchingUserName, createdAt, lastUpdatedAt, sessionId]);

  // Title must be "Session Details - <sessionId>"
  const title = useMemo(() => {
    const id = session?.sessionId || session?._id || session?.id || '';
    return `Session Details - ${id || '\u2014'}`;
  }, [session]);

  return (
    <Modal open={open} onClose={onClose} title={title}>
      {/* Sticky Header with border-bottom */}
      <div
        className="sticky-header"
        style={{
          zIndex: 1,
          background: 'var(--bg-surface, #fff)',
          padding: '16px 24px',
          borderBottom: '1px solid var(--border-subtle, #E5E7EB)',
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

      {/* Scrollable content area */}
      <div
        ref={contentRef}
        tabIndex={-1}
        id={`${headerId}-content`}
        style={{
          padding: '16px 24px',
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
            {Object.entries(coreDetails).map(([label, value], idx) => {
              const isPlaceholder =
                value === '\u2014' || value === 'Unknown User' || value === 'Not available' || value === 'Loading...';
              return (
                <div key={label} className="detail-item" style={{ minWidth: 0 }}>
                  <div
                    className="detail-label"
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--text-secondary, #374151)',
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
                      fontWeight: isPlaceholder ? 500 : 700,
                      color: isPlaceholder
                        ? 'var(--text-tertiary, #6B7280)'
                        : 'var(--text-primary, #111827)',
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
          className="btn-close-primary"
          style={{
            width: '100%',
            height: 46,
            background: '#EF4444',
            color: '#fff',
            border: '1px solid transparent',
            borderRadius: 12,
            fontWeight: 700,
            boxShadow: '0 1px 2px rgba(16,24,40,0.04)',
            cursor: 'pointer',
            transition: 'background .15s ease, transform .06s ease, box-shadow .2s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#DC2626'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = '#EF4444'; }}
          onMouseDown={(e) => { e.currentTarget.style.transform = 'translateY(1px)'; }}
          onMouseUp={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
          onFocus={(e) => {
            e.currentTarget.style.outline = '3px solid rgba(37, 99, 235, 0.35)'; // Ocean blue focus ring
            e.currentTarget.style.outlineOffset = '2px';
          }}
          onBlur={(e) => { e.currentTarget.style.outline = 'none'; }}
          aria-label="Close"
          title="Close"
        >
          Close
        </button>
      </div>

      <style>{`
        /* Responsive: single column on small screens */
        @media (max-width: 639px) {
          .details-card [aria-label="Label and value pairs"] {
            grid-template-columns: 1fr !important;
            row-gap: 0 !important;
          }
        }

        /* Section dividers and zebra striping for detail items */
        .details-grid .detail-item {
          padding: 10px 0;
          border-top: 1px solid var(--border-subtle, #E5E7EB);
        }
        .details-grid .detail-item:nth-child(1),
        .details-grid .detail-item:nth-child(2) {
          border-top: none; /* First row (2 columns) has no top border */
        }
        /* Zebra striping across items (optional, visual enhancement) */
        .details-grid .detail-item:nth-child(odd) {
          background: color-mix(in oklab, var(--ocean-secondary, #F59E0B) 0%, #fcfcfd);
        }
        .details-grid .detail-item:nth-child(even) {
          background: transparent;
        }

        /* Improve focus-visible for any buttons/interactive nodes inside modal */
        .btn-close-primary:focus-visible {
          outline: 3px solid rgba(37, 99, 235, 0.35) !important;
          outline-offset: 2px !important;
        }
      `}</style>
    </Modal>
  );
}

export default SessionDetailsModal;

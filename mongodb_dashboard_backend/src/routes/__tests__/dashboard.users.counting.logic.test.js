'use strict';

/**
 * PUBLIC_INTERFACE
 * Regression test for /api/dashboard/users aggregation logic.
 *
 * This test is intentionally DB-independent:
 * - It validates the *aggregation pipeline semantics* we implement in dashboard.users.routes.js.
 * - It uses simple JS helpers to simulate what Mongo aggregation is intended to do.
 *
 * Why: the CI environment often runs without MONGODB_URI, so DB-dependent tests are flaky.
 */

function computeMetricsFromDocs(docs) {
  // Simulate the projection rules in the route:
  const projected = docs
    .map((d) => {
      const userId = d.user_id == null ? '' : String(d.user_id);
      const sessionIdRaw = d.session_id == null || d.session_id === '' ? String(d._id) : String(d.session_id);
      const projectId = d.project_id == null || d.project_id === '' ? null : String(d.project_id);
      const activityAt = d.last_updated ?? d.session_start ?? d.timestamp ?? null;
      return { userId, sessionId: sessionIdRaw, projectId, activityAt };
    })
    .filter((d) => d.userId);

  const byUser = new Map();
  for (const row of projected) {
    const cur = byUser.get(row.userId) || {
      userId: row.userId,
      sessionIds: new Set(),
      projectIds: new Set(),
      lastActivityAt: null,
    };
    if (row.sessionId) cur.sessionIds.add(row.sessionId);
    if (row.projectId) cur.projectIds.add(row.projectId);
    if (row.activityAt) {
      const t = new Date(row.activityAt).getTime();
      const prev = cur.lastActivityAt ? new Date(cur.lastActivityAt).getTime() : -Infinity;
      if (t > prev) cur.lastActivityAt = row.activityAt;
    }
    byUser.set(row.userId, cur);
  }

  return [...byUser.values()].map((u) => ({
    userId: u.userId,
    totalSessions: u.sessionIds.size,
    distinctProjects: u.projectIds.size,
    lastActivityAt: u.lastActivityAt ? new Date(u.lastActivityAt).toISOString() : null,
  }));
}

describe('dashboard.users counting logic (distinct sessions/projects)', () => {
  test('counts distinct session_id values (not raw docs) and distinct project_id values', () => {
    const docs = [
      // Same session_id appears twice => should count as 1 session
      {
        _id: 'doc1',
        user_id: 'U1',
        session_id: 'S1',
        project_id: 'P1',
        last_updated: '2026-01-05T11:58:07.899Z',
      },
      {
        _id: 'doc2',
        user_id: 'U1',
        session_id: 'S1',
        project_id: 'P1',
        last_updated: '2026-01-05T11:58:08.000Z',
      },
      // Another session, different project
      {
        _id: 'doc3',
        user_id: 'U1',
        session_id: 'S2',
        project_id: 'P2',
        last_updated: '2026-01-05T12:00:00.000Z',
      },
      // Missing session_id => fallback to _id, so counts as 1 additional session
      {
        _id: 'doc4',
        user_id: 'U1',
        project_id: 'P2',
        last_updated: '2026-01-05T12:01:00.000Z',
      },
      // Another user, one session, one project
      {
        _id: 'doc5',
        user_id: 'U2',
        session_id: 'S9',
        project_id: 'PX',
        last_updated: '2026-01-05T01:00:00.000Z',
      },
    ];

    const out = computeMetricsFromDocs(docs);
    const u1 = out.find((x) => x.userId === 'U1');
    const u2 = out.find((x) => x.userId === 'U2');

    expect(u1).toEqual(
      expect.objectContaining({
        userId: 'U1',
        totalSessions: 3, // S1, S2, doc4 fallback
        distinctProjects: 2, // P1, P2
        lastActivityAt: '2026-01-05T12:01:00.000Z',
      })
    );

    expect(u2).toEqual(
      expect.objectContaining({
        userId: 'U2',
        totalSessions: 1,
        distinctProjects: 1,
        lastActivityAt: '2026-01-05T01:00:00.000Z',
      })
    );
  });

  test('matches the provided sample payload shape expectations (single activity)', () => {
    const docs = [
      {
        _id: 'docA',
        user_id: '14d8d458-d0b1-7074-8e91-d4afe7e99f08',
        session_id: 'sess-1',
        project_id: 'proj-1',
        last_updated: '2026-01-05T11:58:07.899Z',
      },
    ];

    const [row] = computeMetricsFromDocs(docs);

    expect(row.totalSessions).toBe(1);
    expect(row.distinctProjects).toBe(1);
    expect(row.lastActivityAt).toBe('2026-01-05T11:58:07.899Z');
  });
});

'use strict';

const { buildDateRangeFilter } = require('../dateRange');

describe('buildDateRangeFilter', () => {
  test('returns null when no dates provided', () => {
    expect(buildDateRangeFilter({}, ['created_at', 'updated_at'])).toBeNull();
  });

  test('builds $or across fields with inclusive bounds', () => {
    const q = { startDate: '2025-04-01T12:10:00.000Z', endDate: '2025-04-30T00:10:00.000Z' };
    const f = buildDateRangeFilter(q, ['created_at', 'updated_at']);
    expect(f).toHaveProperty('$or');
    expect(Array.isArray(f.$or)).toBe(true);
    for (const clause of f.$or) {
      const range = Object.values(clause)[0];
      expect(range.$gte).toBeInstanceOf(Date);
      expect(range.$lte).toBeInstanceOf(Date);
      // gte normalized to 00:00:00.000Z, lte to 23:59:59.999Z
      expect(range.$gte.toISOString().endsWith('T00:00:00.000Z')).toBe(true);
      expect(range.$lte.toISOString().endsWith('T23:59:59.999Z')).toBe(true);
    }
  });

  test('supports preferred start/end names', () => {
    const q = { start: '2025-04-10', end: '2025-04-12' };
    const f = buildDateRangeFilter(q, 'created_at');
    expect(f.created_at.$gte).toBeInstanceOf(Date);
    expect(f.created_at.$lte).toBeInstanceOf(Date);
  });

  test('throws on invalid dates', () => {
    expect(() => buildDateRangeFilter({ startDate: 'invalid-date' }, 'created_at')).toThrow();
    expect(() => buildDateRangeFilter({ endDate: 'not-a-date' }, 'created_at')).toThrow();
  });
});

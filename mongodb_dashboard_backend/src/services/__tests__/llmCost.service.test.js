'use strict';

const { aggregateAgentsInApp } = require('../llmCost.service');
const { parseCurrencyToNumber, roundTo } = require('../../utils/currency');

describe('llmCost.service aggregateAgentsInApp', () => {
  test('aggregates simple two agents and sorts descending with 6 decimals', () => {
    const docs = [
      { Agents: [{ 'Agent Name': 'Alpha', 'Total Cost': '$0.447605' }, { 'Agent Name': 'Beta', 'Total Cost': '$1.2' }] },
      { Agents: [{ 'Agent Name': 'Alpha', 'Total Cost': '$0.052395' }] },
    ];
    const out = aggregateAgentsInApp(docs);
    expect(out).toEqual([
      { agent: 'Beta', total_cost: 1.2 },
      { agent: 'Alpha', total_cost: 0.5 }, // 0.447605 + 0.052395 -> 0.500000
    ]);
  });

  test('handles malformed values gracefully (ignored or treated as 0)', () => {
    const docs = [
      { Agents: [{ 'Agent Name': 'X', 'Total Cost': '$abc' }, { 'Agent Name': 'Y', 'Total Cost': null }] },
      { Agents: [{ 'Agent Name': 'X', 'Total Cost': 0.1 }] },
      { Agents: 'not-an-array' },
      {},
      null,
    ];
    const out = aggregateAgentsInApp(docs);
    // X should be 0.1, Y should be 0, only valid entries considered
    expect(out.find((r) => r.agent === 'X')?.total_cost).toBe(0.1);
    expect(out.find((r) => r.agent === 'Y')?.total_cost).toBe(0);
  });

  test('defaults missing agent name to "Unknown"', () => {
    const docs = [{ Agents: [{ 'Agent Name': '   ', 'Total Cost': '$1.0' }, { 'Total Cost': '$2.0' }] }];
    const out = aggregateAgentsInApp(docs);
    const unknown = out.find((r) => r.agent === 'Unknown');
    expect(unknown).toBeTruthy();
    expect(unknown.total_cost).toBe(3.0);
  });

  test('rounds totals to 6 decimals', () => {
    const docs = [
      { Agents: [{ 'Agent Name': 'A', 'Total Cost': '$0.0000004' }, { 'Agent Name': 'A', 'Total Cost': '$0.0000004' }] },
    ];
    const out = aggregateAgentsInApp(docs);
    expect(out[0]).toEqual({ agent: 'A', total_cost: 0.000001 });
  });
});

describe('utils.currency parsing and rounding', () => {
  test('parseCurrencyToNumber handles $, commas, and whitespace', () => {
    expect(parseCurrencyToNumber('$1,234.56789')).toBeCloseTo(1234.56789, 10);
    expect(parseCurrencyToNumber('  $ 12.34 ')).toBeCloseTo(12.34, 10);
    expect(parseCurrencyToNumber(0.5)).toBe(0.5);
    expect(parseCurrencyToNumber('not a number')).toBe(0);
  });

  test('roundTo rounds to 6 decimals by default', () => {
    expect(roundTo(0.44760549)).toBe(0.447605);
    expect(roundTo(0.4476055)).toBe(0.447606);
  });
});

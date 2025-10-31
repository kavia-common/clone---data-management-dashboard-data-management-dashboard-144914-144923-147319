'use strict';

const { getCreditsPerUsd, usdToCredits, formatCredits } = require('./credits');

describe('credits util', () => {
  test('getCreditsPerUsd returns default when env not set', () => {
    const n = getCreditsPerUsd();
    expect(typeof n).toBe('number');
    expect(n).toBeGreaterThan(0);
  });

  test('usdToCredits converts and rounds', () => {
    expect(usdToCredits(0)).toBe(0);
    expect(usdToCredits(1)).toBe(getCreditsPerUsd());
    expect(usdToCredits(0.5)).toBe(Math.round(0.5 * getCreditsPerUsd()));
  });

  test('formatCredits appends suffix', () => {
    expect(formatCredits(0)).toBe('0 credits');
    expect(formatCredits(1000)).toMatch(/1,000 credits|1000 credits/);
  });
});

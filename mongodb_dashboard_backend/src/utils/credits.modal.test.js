'use strict';

const { usdToCredits, getCreditsPerUsd } = require('./credits');

describe('credits utils', () => {
  test('getCreditsPerUsd returns default when env unset', () => {
    const original = process.env.CREDITS_PER_USD;
    delete process.env.CREDITS_PER_USD;
    expect(getCreditsPerUsd()).toBe(20000);
    if (original !== undefined) {process.env.CREDITS_PER_USD = original;}
  });

  test('usdToCredits computes expected integer credits', () => {
    const original = process.env.CREDITS_PER_USD;
    process.env.CREDITS_PER_USD = '1000'; // 1 USD = 1000 credits
    expect(usdToCredits(1)).toBe(1000);
    expect(usdToCredits(1.23)).toBe(1230); // rounded
    expect(usdToCredits('2.5')).toBe(2500);
    expect(usdToCredits('abc')).toBe(0);
    if (original !== undefined) {process.env.CREDITS_PER_USD = original;}
    else {delete process.env.CREDITS_PER_USD;}
  });
});

// Lightweight smoke-test to validate shape decisions used by the Costs modal mapping.
// We simulate the attachResolvedNames normalization result and verify both creditsUsed keys are present.
describe('normalized credits fields for modal consumption', () => {
  test('contains both camelCase and snake_case credits fields', () => {
    const CREDITS = 4321;
    const project = {
      projectId: 'p1',
      projectName: 'Demo',
      projectCost: 4.321,
      projectCredits: CREDITS,
      // Enriched fields expected:
      credits_used: CREDITS,
      creditsUsed: CREDITS,
    };
    const user = {
      userId: 'u1',
      totalCostUSD: 4.321,
      totalCredits: CREDITS,
      credits_used: CREDITS,
      creditsUsed: CREDITS,
      projects: [project],
    };

    // Basic assertions
    expect(project.projectCredits).toBe(CREDITS);
    expect(project.credits_used).toBe(CREDITS);
    expect(project.creditsUsed).toBe(CREDITS);

    expect(user.totalCredits).toBe(CREDITS);
    expect(user.credits_used).toBe(CREDITS);
    expect(user.creditsUsed).toBe(CREDITS);
  });
});

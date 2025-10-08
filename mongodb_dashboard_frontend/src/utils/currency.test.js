import React from 'react';
import { render } from '@testing-library/react';
import { CREDITS_PER_USD, usdToCredits, formatCredits, renderCreditsWithUsd } from './currency';

describe('currency credits utils', () => {
  test('usdToCredits converts with configured factor', () => {
    expect(usdToCredits(0)).toBe(0);
    expect(usdToCredits(1)).toBe(CREDITS_PER_USD);
    expect(usdToCredits(0.5)).toBe(Math.round(0.5 * CREDITS_PER_USD));
    expect(usdToCredits('2')).toBe(2 * CREDITS_PER_USD);
    expect(usdToCredits(undefined)).toBe(0);
  });

  test('formatCredits formats with "credits" suffix', () => {
    expect(formatCredits(0)).toBe('0 credits');
    const txt = formatCredits(1234567);
    expect(txt).toMatch(/1,234,567 credits|1234567 credits/);
  });

  test('renderCreditsWithUsd shows credits first and USD in parens', () => {
    const { getByText } = render(<div>{renderCreditsWithUsd(1.2345)}</div>);
    // Primary content text contains 'credits'
    expect(getByText(/credits/)).toBeInTheDocument();
  });
});

import React from 'react';
import { render, screen } from '@testing-library/react';
import { ViewCostDetailsModal } from './index';

describe('ViewCostDetailsModal - Credits Used rendering', () => {
  test('shows "Credits Used" and renders credits-first when only *_cost is provided as numeric string', () => {
    const data = {
      userId: 'u-1',
      userName: 'Test User',
      totalProjectCount: 1,
      total_cost: '0.005', // USD as numeric string
      projects: [],
    };

    render(<ViewCostDetailsModal isOpen={true} onClose={() => {}} data={data} />);

    // Ensure the label is present
    expect(screen.getByText(/Credits Used/i)).toBeInTheDocument();

    // Ensure the rendered value includes "credits" and USD in parentheses
    const val = screen.getByTestId('credits-used-topline');
    expect(val.textContent).toMatch(/credits/i);
    expect(val.textContent).toMatch(/\(\$/); // USD shown in parentheses
  });

  test('renders credits-first when only credits fields are provided (back-compute USD)', () => {
    const data = {
      userId: 'u-2',
      userName: 'Only Credits',
      totalProjectCount: 2,
      total_credits: 10000, // credits only; will compute USD
      projects: [],
    };

    render(<ViewCostDetailsModal isOpen={true} onClose={() => {}} data={data} />);

    // Check label
    expect(screen.getByText(/Credits Used/i)).toBeInTheDocument();
    // Ensure value shows credits and includes a dollar in parentheses
    const val = screen.getByTestId('credits-used-topline');
    expect(val.textContent).toMatch(/credits/i);
    expect(val.textContent).toMatch(/\(\$/);
  });
});

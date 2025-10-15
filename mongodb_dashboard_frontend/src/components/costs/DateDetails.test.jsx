import React from 'react';
import { render, screen } from '@testing-library/react';
import DateDetails from './DateDetails';

describe('DateDetails', () => {
  test('renders credits for cost-like titles', () => {
    render(<DateDetails title="Costs By Date" data={{ '2025-10-01': 0.5 }} />);
    const entry = screen.getByText(/credits/i);
    expect(entry).toBeInTheDocument();
  });

  test('shows empty state when no entries', () => {
    render(<DateDetails title="Costs" data={{}} />);
    expect(screen.getByTestId('datedetails-empty')).toBeInTheDocument();
  });
});

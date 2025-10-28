import React from 'react';
import { render, screen } from '@testing-library/react';
import Costs from './Costs';

// Mock DataTable to render cell content using provided columns.render for first row only
jest.mock('../../components/DataTable.jsx', () => {
  return function MockTable({ columns = [], data = [] }) {
    const row = data[0] || {};
    return (
      <table data-testid="mock-table">
        <tbody>
          <tr>
            {columns.map((c) => {
              const val = row[c.key];
              const node = c.render ? c.render(val, row) : (val ?? '—');
              return <td key={c.key}>{node}</td>;
            })}
          </tr>
        </tbody>
      </table>
    );
  };
});

 // Mock listLlmCosts to return a record that uses camelCase key and a numeric string
jest.mock('../../api', () => ({
  listLlmCosts: jest.fn(async () => ({
    items: [
      {
        _id: 'id1',
        llm_model: 'gpt-4o',
        totalCost: '0.00123', // note: camelCase and string type
        total_tokens: 1234,
        timestamp: '2024-10-01T00:00:00.000Z',
      },
    ],
    meta: { page: 1, limit: 10, total: 1 },
  })),
}));

describe('Costs page - credits-first rendering', () => {
  test('renders credits-first text when cost field is camelCase and string', async () => {
    render(<Costs />);
    // The mocked table renders synchronously after initial load; find a cell containing 'credits'
    const cell = await screen.findByText(/credits/i);
    expect(cell).toBeInTheDocument();
    // And USD in parentheses
    expect(cell.textContent).toMatch(/\(.*\$\s?0\.00/);
  });
});

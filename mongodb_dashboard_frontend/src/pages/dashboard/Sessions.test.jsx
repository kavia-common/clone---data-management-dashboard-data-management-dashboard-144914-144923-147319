import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Sessions from './Sessions';

// Mock DataTable to make the test deterministic and not rely on async data fetching
jest.mock('../../components/DataTable.jsx', () => {
  return function MockTable({ data = [], onRowClick }) {
    return (
      <table data-testid="mock-table">
        <tbody>
          {(data || []).map((row, idx) => (
            <tr key={idx} data-testid={`row-${idx}`} onClick={() => onRowClick && onRowClick(row)}>
              <td>{row.task_id}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };
});

// Mock listSessions to avoid network usage
jest.mock('../../api/client', () => ({
  listSessions: jest.fn(async () => ({
    items: [
      { _id: 'a1', task_id: 'T-1', tenant_id: 'org1', organization_name: 'Org One', service_type: 'etl', updatedAt: '2024-10-01T00:10:00.000Z' },
    ],
    meta: { page: 1, limit: 8, total: 1 }, // standardized page size = 8
  })),
}));

// Mock Modal child to assert it receives session prop
jest.mock('../../components/sessions/SessionDetailsModal', () => {
  return function MockModal({ open, session }) {
    return open ? <div data-testid="details-modal">Modal Open - {session?._id}</div> : null;
  };
});

describe('Sessions page - row click passes session to modal', () => {
  test('clicking a row opens modal with the selected session', async () => {
    render(<Sessions />);
    // Wait for mock row to render
    const row = await screen.findByTestId('row-0');
    fireEvent.click(row);
    const modal = await screen.findByTestId('details-modal');
    expect(modal).toHaveTextContent('Modal Open - a1');
  });
});

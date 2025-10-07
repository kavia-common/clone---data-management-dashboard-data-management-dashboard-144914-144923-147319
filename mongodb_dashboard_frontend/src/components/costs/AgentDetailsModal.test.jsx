import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AgentDetailsModal from './AgentDetailsModal';
import * as agentsApi from '../../api/agents';

// Mock the agents API
jest.mock('../../api/agents');

describe('AgentDetailsModal', () => {
  const mockOnClose = jest.fn();
  const mockAgent = {
    id: 'test-agent-1',
    name: 'Test Agent',
    last_active: '2024-01-01T12:00:00Z',
    total_cost: 25.50,
    metadata: {
      type: 'ai-assistant',
      version: '1.0'
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render modal when open', () => {
    render(
      <AgentDetailsModal
        open={true}
        onClose={mockOnClose}
        agentId="test-agent-1"
        agentName="Test Agent"
      />
    );

    expect(screen.getByText('Test Agent')).toBeInTheDocument();
    expect(screen.getByText('Close')).toBeInTheDocument();
  });

  it('should not render modal when closed', () => {
    render(
      <AgentDetailsModal
        open={false}
        onClose={mockOnClose}
        agentId="test-agent-1"
        agentName="Test Agent"
      />
    );

    expect(screen.queryByText('Test Agent')).not.toBeInTheDocument();
  });

  it('should call onClose when close button is clicked', () => {
    render(
      <AgentDetailsModal
        open={true}
        onClose={mockOnClose}
        agentId="test-agent-1"
        agentName="Test Agent"
      />
    );

    fireEvent.click(screen.getByText('Close'));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('should show loading state initially', () => {
    agentsApi.getAgentById.mockImplementation(() => new Promise(() => {})); // Never resolves

    render(
      <AgentDetailsModal
        open={true}
        onClose={mockOnClose}
        agentId="test-agent-1"
        agentName="Test Agent"
      />
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('should fetch and display agent data when opened', async () => {
    agentsApi.getAgentById.mockResolvedValue(mockAgent);

    render(
      <AgentDetailsModal
        open={true}
        onClose={mockOnClose}
        agentId="test-agent-1"
        agentName="Test Agent"
      />
    );

    await waitFor(() => {
      expect(agentsApi.getAgentById).toHaveBeenCalledWith('test-agent-1');
    });

    await waitFor(() => {
      expect(screen.getByText(/Name:.*Test Agent/)).toBeInTheDocument();
      expect(screen.getByText(/ID:.*test-agent-1/)).toBeInTheDocument();
    });
  });

  it('should show error state when API call fails', async () => {
    agentsApi.getAgentById.mockRejectedValue(new Error('API Error'));

    render(
      <AgentDetailsModal
        open={true}
        onClose={mockOnClose}
        agentId="test-agent-1"
        agentName="Test Agent"
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/Failed to load agent details/)).toBeInTheDocument();
    });
  });

  it('should show fallback content when no agent data is available', async () => {
    agentsApi.getAgentById.mockResolvedValue(null);

    render(
      <AgentDetailsModal
        open={true}
        onClose={mockOnClose}
        agentId="test-agent-1"
        agentName="Test Agent"
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/No detailed data available/)).toBeInTheDocument();
      expect(screen.getByText(/Name:.*Test Agent/)).toBeInTheDocument();
      expect(screen.getByText(/ID:.*test-agent-1/)).toBeInTheDocument();
    });
  });

  it('should reset state when modal is closed and reopened', async () => {
    agentsApi.getAgentById.mockResolvedValue(mockAgent);

    const { rerender } = render(
      <AgentDetailsModal
        open={true}
        onClose={mockOnClose}
        agentId="test-agent-1"
        agentName="Test Agent"
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Name:.*Test Agent/)).toBeInTheDocument();
    });

    // Close modal
    rerender(
      <AgentDetailsModal
        open={false}
        onClose={mockOnClose}
        agentId="test-agent-1"
        agentName="Test Agent"
      />
    );

    // Reopen modal
    rerender(
      <AgentDetailsModal
        open={true}
        onClose={mockOnClose}
        agentId="test-agent-2"
        agentName="Different Agent"
      />
    );

    // Should fetch new agent
    await waitFor(() => {
      expect(agentsApi.getAgentById).toHaveBeenCalledWith('test-agent-2');
    });
  });
});

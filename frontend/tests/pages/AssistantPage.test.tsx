import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AssistantPage } from '../../src/pages/AssistantPage';
import * as assistantApi from '../../src/api/assistant';
import type { AgentExecutionRecord } from '../../src/api/types';

vi.mock('../../src/api/assistant');

function renderAssistantPage() {
  return render(
    <MemoryRouter>
      <AssistantPage />
    </MemoryRouter>
  );
}

function execution(overrides: Partial<AgentExecutionRecord> = {}): AgentExecutionRecord {
  return {
    id: 'exec-1',
    question: 'What is the health of checkout?',
    finalResponse: 'Checkout is healthy.',
    status: 'completed',
    stoppedReason: 'final_answer',
    iterations: 1,
    steps: [
      {
        toolName: 'get_service_health',
        arguments: { serviceName: 'checkout' },
        result: { status: 'healthy' },
        isRagQuery: false,
        timestamp: '2026-01-01T00:00:00Z',
      },
    ],
    retrievedDocuments: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('AssistantPage', () => {
  it('asks the assistant, renders the final response, and can expand the reasoning trace', async () => {
    vi.mocked(assistantApi.askAssistant).mockResolvedValue(execution());
    const user = userEvent.setup();
    renderAssistantPage();

    await user.type(screen.getByPlaceholderText(/checkout service/i), 'What is the health of checkout?');
    await user.click(screen.getByRole('button', { name: /^ask$/i }));

    expect(assistantApi.askAssistant).toHaveBeenCalledWith('What is the health of checkout?');
    expect(await screen.findByText('Checkout is healthy.')).toBeInTheDocument();
    expect(screen.queryByText('get_service_health')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /view agent activity/i }));
    expect(screen.getByText('get_service_health')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: /view full execution details/i })).toHaveAttribute('href', '/executions/exec-1');
  });

  it('shows an error message for a turn instead of crashing when the ask fails', async () => {
    const { ApiError } = await import('../../src/api/client');
    vi.mocked(assistantApi.askAssistant).mockRejectedValue(new ApiError('AI service unavailable', 503));
    const user = userEvent.setup();
    renderAssistantPage();

    await user.type(screen.getByPlaceholderText(/checkout service/i), 'Is everything okay?');
    await user.click(screen.getByRole('button', { name: /^ask$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('AI service unavailable');
  });

  it('shows real retrieved documents as a separate, collapsed-by-default Sources section when RAG was used', async () => {
    vi.mocked(assistantApi.askAssistant).mockResolvedValue(
      execution({
        retrievedDocuments: [
          { documentId: 'runbooks/payment-service-recovery', title: 'Payment Service Recovery Runbook', relatedService: 'payment-service', score: 0.76 },
          { documentId: 'architecture/overview', title: 'Digital Twin System Architecture Overview', relatedService: 'platform', score: 0.71 },
        ],
      })
    );
    const user = userEvent.setup();
    renderAssistantPage();

    await user.type(screen.getByPlaceholderText(/checkout service/i), 'What is the payment service recovery procedure?');
    await user.click(screen.getByRole('button', { name: /^ask$/i }));

    expect(await screen.findByText(/2 knowledge chunks retrieved/i)).toBeInTheDocument();
    expect(screen.queryByText('Payment Service Recovery Runbook')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /view sources/i }));
    expect(screen.getByText('Payment Service Recovery Runbook')).toBeInTheDocument();
    expect(screen.getByText('Digital Twin System Architecture Overview')).toBeInTheDocument();
  });
});

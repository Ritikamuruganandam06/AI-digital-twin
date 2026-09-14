import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AsyncBoundary } from '../../src/components/AsyncBoundary';
import { ApiError } from '../../src/api/client';
import type { ApiQueryState } from '../../src/api/useApiQuery';

function state<T>(overrides: Partial<ApiQueryState<T>>): ApiQueryState<T> {
  return { data: undefined, error: undefined, loading: false, refetch: vi.fn(), lastUpdated: undefined, ...overrides };
}

describe('AsyncBoundary', () => {
  it('shows a loading indicator while loading with no data yet', () => {
    render(<AsyncBoundary state={state({ loading: true })}>{() => <div>content</div>}</AsyncBoundary>);
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
  });

  it('renders the real ApiError message and a working retry button on error', async () => {
    const refetch = vi.fn();
    const user = userEvent.setup();
    render(
      <AsyncBoundary state={state({ error: new ApiError('Service unavailable', 503), refetch })}>
        {() => <div>content</div>}
      </AsyncBoundary>
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Service unavailable');
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders children with the resolved data once loaded', () => {
    render(<AsyncBoundary state={state({ data: { name: 'checkout' } })}>{(d) => <div>{d.name}</div>}</AsyncBoundary>);
    expect(screen.getByText('checkout')).toBeInTheDocument();
  });

  it('renders nothing when there is no data, no error, and loading has finished', () => {
    const { container } = render(<AsyncBoundary state={state({})}>{() => <div>content</div>}</AsyncBoundary>);
    expect(container).toBeEmptyDOMElement();
  });
});

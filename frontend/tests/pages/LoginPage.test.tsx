import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from '../../src/pages/LoginPage';
import { AuthProvider } from '../../src/auth/AuthContext';
import * as authApi from '../../src/api/auth';

vi.mock('../../src/api/auth');

function renderLoginPage() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>Home page</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(authApi.login).mockReset();
  });

  it('submits the entered credentials and redirects home on success', async () => {
    vi.mocked(authApi.login).mockResolvedValue({
      token: 'irrelevant-for-this-test',
      user: { id: 'u1', email: 'a@b.com', role: 'USER' },
    });
    const user = userEvent.setup();
    renderLoginPage();

    await user.type(screen.getByLabelText(/email/i), 'a@b.com');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    expect(authApi.login).toHaveBeenCalledWith('a@b.com', 'password123');
    await waitFor(() => expect(screen.getByText('Home page')).toBeInTheDocument());
  });

  it('shows the backend error message and stays on the page when login fails', async () => {
    const { ApiError } = await import('../../src/api/client');
    vi.mocked(authApi.login).mockRejectedValue(new ApiError('Invalid credentials', 401));
    const user = userEvent.setup();
    renderLoginPage();

    await user.type(screen.getByLabelText(/email/i), 'a@b.com');
    await user.type(screen.getByLabelText(/password/i), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials');
    expect(screen.queryByText('Home page')).not.toBeInTheDocument();
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { AdminGuard } from './AdminGuard';
import { clearTokens, setTokens } from './storage';
import { makeJwt } from './__testing__/tokens';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/admin-panel"
          element={
            <AdminGuard>
              <div>secret</div>
            </AdminGuard>
          }
        />
        <Route path="/admin-panel/login" element={<div>login-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminGuard', () => {
  beforeEach(() => clearTokens());
  afterEach(() => clearTokens());

  it('redirects to login when no token is stored', () => {
    renderAt('/admin-panel');
    expect(screen.getByText('login-page')).toBeInTheDocument();
  });

  it('redirects to login when the token is expired', () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    setTokens(makeJwt({ role: 'ADMIN', exp: past }), 'r', past);
    renderAt('/admin-panel');
    expect(screen.getByText('login-page')).toBeInTheDocument();
  });

  it('redirects to login when role is not ADMIN', () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    setTokens(makeJwt({ role: 'USER', exp: future }), 'r', future);
    renderAt('/admin-panel');
    expect(screen.getByText('login-page')).toBeInTheDocument();
  });

  it('renders children for a valid admin token', () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    setTokens(makeJwt({ role: 'ADMIN', exp: future }), 'r', future);
    renderAt('/admin-panel');
    expect(screen.getByText('secret')).toBeInTheDocument();
  });
});

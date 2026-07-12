import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createContext, type ReactNode } from 'react';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { AdminApp } from './AdminApp';
import { clearTokens } from './services/auth/storage';

/**
 * The incoming merge of origin/frontend expands App.tsx with wizard,
 * marketing, and auth-guarded routes AND wraps the tree in an AuthProvider.
 * We cannot render the real merged App.tsx here (the wizard/marketing files
 * are not in this branch yet), so this test builds a synthetic shell that
 * mimics the post-merge shape:
 *   - a plain context provider stands in for AuthProvider
 *   - sibling routes exist for /, /login, /antrag/*, /profile, and *
 *   - AdminApp mounts under /admin-panel/*
 * If AdminApp regressed on a nested route match, an ancestor context, or
 * its internal fallback, one of these assertions trips.
 */

// Stand-in for the incoming AuthProvider. Its only job here is to prove that
// an ancestor context on the App tree does not interfere with AdminApp.
const FakeAuthContext = createContext<{ user: null }>({ user: null });
function FakeAuthProvider({ children }: { children: ReactNode }) {
  return (
    <FakeAuthContext.Provider value={{ user: null }}>
      {children}
    </FakeAuthContext.Provider>
  );
}

function renderMergedShell(initialPath: string) {
  return render(
    <FakeAuthProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/" element={<div>landing-stub</div>} />
          <Route path="/login" element={<div>marketing-login-stub</div>} />
          <Route path="/antrag/*" element={<div>wizard-stub</div>} />
          <Route path="/profile" element={<div>profile-stub</div>} />
          <Route path="/admin-panel/*" element={<AdminApp />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </MemoryRouter>
    </FakeAuthProvider>,
  );
}

describe('AdminApp routing survives the merged App.tsx shape', () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearTokens();
  });
  afterEach(() => {
    sessionStorage.clear();
    clearTokens();
  });

  it('mounts LoginPage at /admin-panel/login even with sibling wizard/auth routes', () => {
    renderMergedShell('/admin-panel/login');
    // "Admin-Login" heading is a stable marker in LoginPage.
    expect(screen.getByRole('heading', { name: 'Admin-Login' })).toBeInTheDocument();
    // Marketing shell stubs must NOT bleed in.
    expect(screen.queryByText('landing-stub')).toBeNull();
    expect(screen.queryByText('marketing-login-stub')).toBeNull();
    expect(screen.queryByText('wizard-stub')).toBeNull();
  });

  it('does NOT render AdminApp when the location targets a sibling route', () => {
    renderMergedShell('/');
    expect(screen.getByText('landing-stub')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Admin-Login' })).toBeNull();
  });

  it('does NOT render AdminApp when the location targets the marketing wizard', () => {
    renderMergedShell('/antrag/neu');
    expect(screen.getByText('wizard-stub')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Admin-Login' })).toBeNull();
  });

  it('routes unknown /admin-panel/* subpaths through the guard to /admin-panel (redirects unauthenticated user to login)', () => {
    // AdminApp declares `<Route path="*" element={<Navigate to="" replace />} />`
    // which lands on the guarded index route. With no admin token, AdminGuard
    // redirects to /admin-panel/login, so we should see Admin-Login here —
    // NOT the outer marketing-login-stub. This proves the internal fallback
    // takes precedence over the outer catch-all.
    renderMergedShell('/admin-panel/nonexistent-subroute');
    expect(screen.getByRole('heading', { name: 'Admin-Login' })).toBeInTheDocument();
    expect(screen.queryByText('marketing-login-stub')).toBeNull();
    expect(screen.queryByText('landing-stub')).toBeNull();
  });
});

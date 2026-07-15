import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api, RegisterRequest, AuthResponse } from './api';
import {
  clearStoredProfile,
  clearTokens,
  getAccessToken,
  getRefreshToken,
  getStoredProfile,
  setStoredProfile,
  setTokens,
} from './auth/storage';
import { refreshAccessToken } from './api/client';
import { decodeJwt, isExpired } from '@shared/api/jwt';

/**
 * User-facing auth state.
 *
 * On mount we probe the localStorage-backed token store, decode the access
 * token, and either trust it (still valid), attempt a silent refresh
 * (expired but refresh token present), or land logged-out. All fetch calls
 * from src/lib/api.ts already retry on 401 via the shared client — this
 * provider only handles page-load bootstrap and the login/logout actions.
 */
interface AuthContextType {
  isAuthenticated: boolean;
  loading: boolean;
  user: AuthResponse['user'] | null;
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterRequest) => Promise<void>;
  logout: () => void;
  refreshAuth: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

function persistFromAuthResponse(response: AuthResponse): void {
  const exp = decodeJwt(response.accessToken)?.exp ?? Math.floor(Date.now() / 1000) + response.expiresIn;
  setTokens(response.accessToken, response.refreshToken, exp);
  setStoredProfile(response.user);
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<AuthResponse['user'] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      const access = getAccessToken();
      const profile = getStoredProfile<AuthResponse['user']>();
      if (!access || !profile) {
        if (!cancelled) setLoading(false);
        return;
      }

      const payload = decodeJwt(access);
      if (payload && !isExpired(payload)) {
        if (!cancelled) {
          setIsAuthenticated(true);
          setUser(profile);
          setLoading(false);
        }
        return;
      }

      // Token expired (or undecodable) but we may still have a valid
      // refresh token — try a silent refresh through the shared client.
      if (getRefreshToken()) {
        const ok = await refreshAccessToken();
        if (!cancelled) {
          if (ok) {
            setIsAuthenticated(true);
            setUser(profile);
          } else {
            clearTokens();
            clearStoredProfile();
          }
          setLoading(false);
        }
        return;
      }

      // No refresh token — clean up and stay logged out.
      clearTokens();
      clearStoredProfile();
      if (!cancelled) setLoading(false);
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = async (email: string, password: string) => {
    const response = await api.login(email, password);
    persistFromAuthResponse(response);
    setIsAuthenticated(true);
    setUser(response.user);
  };

  const register = async (data: RegisterRequest) => {
    const response = await api.register(data);
    persistFromAuthResponse(response);
    setIsAuthenticated(true);
    setUser(response.user);
  };

  const logout = () => {
    clearTokens();
    clearStoredProfile();
    setIsAuthenticated(false);
    setUser(null);
  };

  /**
   * Manual refresh — most callers do not need this; the shared client
   * refreshes automatically on 401. Kept for callers that want to force
   * a rotation (e.g., after a long tab-suspended session).
   */
  const refreshAuth = async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) throw new Error('No refresh token');
    const response = await api.refresh(refreshToken);
    persistFromAuthResponse(response);
    setIsAuthenticated(true);
    setUser(response.user);
  };

  return (
    <AuthContext.Provider
      value={{ isAuthenticated, loading, user, login, register, logout, refreshAuth }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};

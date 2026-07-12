import React, { createContext, useContext, useState, useEffect } from 'react';
import apiClient from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Check if user is already logged in on mount
    const checkAuth = async () => {
      const token = apiClient.getAccessToken();
      if (token) {
        try {
          const profile = await apiClient.getProfile();
          setUser(profile);
        } catch (err) {
          // Token might be expired, try refresh
          try {
            await apiClient.refresh();
            const profile = await apiClient.getProfile();
            setUser(profile);
          } catch (refreshErr) {
            // Refresh failed, clear tokens
            apiClient.clearTokens();
          }
        }
      }
      setLoading(false);
    };

    checkAuth();
  }, []);

  const login = async (email, password) => {
    try {
      setError(null);
      const result = await apiClient.login(email, password);
      setUser(result.user);
      return result;
    } catch (err) {
      setError(err.message || 'Login fehlgeschlagen');
      throw err;
    }
  };

  const register = async (data) => {
    try {
      setError(null);
      const result = await apiClient.register(data);
      setUser(result.user);
      return result;
    } catch (err) {
      setError(err.message || 'Registrierung fehlgeschlagen');
      throw err;
    }
  };

  const logout = () => {
    apiClient.logout();
    setUser(null);
  };

  const updateProfile = async (updates) => {
    try {
      setError(null);
      const updated = await apiClient.updateProfile(updates);
      setUser(prev => ({ ...prev, ...updated }));
      return updated;
    } catch (err) {
      setError(err.message || 'Profil-Update fehlgeschlagen');
      throw err;
    }
  };

  const value = {
    user,
    loading,
    error,
    login,
    register,
    logout,
    updateProfile,
    isAuthenticated: !!user
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;

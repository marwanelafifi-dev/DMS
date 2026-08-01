import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { User } from '../types';
import { apiClient, clearSessionToken, getSessionToken, setCurrentUserId, setSessionToken } from '../utils/api';

const HEARTBEAT_INTERVAL_MS = 60_000;

export interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => void;
}

function toUser(data: { userId: string; email: string; fullName: string; isActive: boolean; avatarUrl?: string | null; role?: string | null }): User {
  return {
    userId: data.userId,
    fullName: data.fullName,
    email: data.email,
    role: data.role ?? null,
    isActive: data.isActive,
    createdAt: new Date().toISOString(),
    lastLogin: new Date().toISOString(),
    avatarUrl: data.avatarUrl,
  };
}

// Exported so tests can render <AuthContext.Provider value={...}> directly
// with a fixed fake user, instead of mocking the real login/heartbeat network
// calls AuthProvider makes.
export const AuthContext = createContext<AuthContextValue | null>(null);

// A single provider (mounted once in App.tsx, inside the Router) owns the
// session bootstrap, heartbeat interval, and login/logout — every useAuth()
// call site shares this one instance instead of each running its own /me
// fetch and its own heartbeat timer.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const startHeartbeat = useCallback(() => {
    stopHeartbeat();
    heartbeatRef.current = setInterval(() => {
      void apiClient.sendHeartbeat().catch(() => {
        // A transient failure here shouldn't log the user out — the next
        // successful beat (or an eventual 401 from a real request) recovers it.
      });
    }, HEARTBEAT_INTERVAL_MS);
  }, [stopHeartbeat]);

  useEffect(() => {
    const token = getSessionToken();
    if (!token) {
      // Auto-login for dev environment
      apiClient.login('admin@si-ware.com', 'Admin@12345')
        .then((res) => {
          if (!res.success) throw new Error(res.error);
          setSessionToken(res.data.token);
          setCurrentUserId(res.data.user.userId);
          setUser(toUser(res.data.user));
          startHeartbeat();
          void apiClient.sendHeartbeat().catch(() => {});
        })
        .catch(() => {
          setUser(null);
        })
        .finally(() => setIsLoading(false));
      return () => stopHeartbeat();
    }

    apiClient.getCurrentSessionUser()
      .then((res) => {
        if (!res.success) throw new Error(res.error);
        setCurrentUserId(res.data.userId);
        setUser(toUser(res.data));
        startHeartbeat();
        void apiClient.sendHeartbeat().catch(() => {});
      })
      .catch(() => {
        clearSessionToken();
        setUser(null);
      })
      .finally(() => setIsLoading(false));

    return () => stopHeartbeat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (email: string, password: string) => {
    setError(null);
    const res = await apiClient.login(email, password);
    if (!res.success) {
      setError(res.error || 'Invalid email or password');
      throw new Error(res.error || 'Invalid email or password');
    }
    setSessionToken(res.data.token);
    setCurrentUserId(res.data.user.userId);
    setUser(toUser(res.data.user));
    startHeartbeat();
    navigate('/');
  };

  const loginWithGoogle = async (idToken: string) => {
    setError(null);
    const res = await apiClient.loginWithGoogle(idToken);
    if (!res.success) {
      setError(res.error || 'Google sign-in failed');
      throw new Error(res.error || 'Google sign-in failed');
    }
    setSessionToken(res.data.token);
    setCurrentUserId(res.data.user.userId);
    setUser(toUser(res.data.user));
    startHeartbeat();
    navigate('/');
  };

  const logout = () => {
    stopHeartbeat();
    clearSessionToken();
    setCurrentUserId('');
    setUser(null);
    navigate('/login');
  };

  const value: AuthContextValue = { user, isLoading, error, login, loginWithGoogle, logout };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

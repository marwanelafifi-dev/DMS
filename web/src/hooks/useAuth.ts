import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { User } from '../types';
import { DEV_USER_ID } from '../utils/api';

interface UseAuthReturn {
  user: User | null;
  isLoading: boolean;
  error: string | null;
  logout: () => void;
}

export function useAuth(): UseAuthReturn {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    // Dev-only bootstrap user (see infra/db/init/003_dev_seed_admin.sql) until
    // Google Workspace SSO is wired up. In production, this would fetch from
    // API or auth service.
    const currentUser: User = {
      userId: DEV_USER_ID,
      fullName: 'System Admin',
      email: 'admin@si-ware.com',
      role: 'Admin',
      isActive: true,
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString(),
    };

    setUser(currentUser);
    setIsLoading(false);
  }, []);

  const logout = () => {
    setUser(null);
    navigate('/login');
  };

  return { user, isLoading, error, logout };
}

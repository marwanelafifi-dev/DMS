import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { User } from '../types';

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
    // For now, simulate authenticated user
    // In production, this would fetch from API or auth service
    const currentUser: User = {
      userId: 'user-1',
      fullName: 'Ahmed Ali',
      email: 'alii.mohamed@si-ware.com',
      role: 'Manager',
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

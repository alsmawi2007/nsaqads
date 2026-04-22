import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  sub: string;
  email: string;
  isSystemAdmin: boolean;
}

interface OrgContext {
  id: string;
  name: string;
  slug: string;
}

interface AuthState {
  user: User | null;
  activeOrg: OrgContext | null;
  isAuthenticated: boolean;
  setUser: (user: User | null) => void;
  setActiveOrg: (org: OrgContext | null) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      activeOrg: null,
      isAuthenticated: false,

      setUser: (user) => set({ user, isAuthenticated: user !== null }),

      setActiveOrg: (org) => set({ activeOrg: org }),

      logout: () => {
        set({ user: null, activeOrg: null, isAuthenticated: false });
        if (typeof window !== 'undefined') {
          localStorage.removeItem('adari_access_token');
          localStorage.removeItem('adari_refresh_token');
        }
      },
    }),
    {
      name: 'adari-auth',
      partialize: (state) => ({ user: state.user, activeOrg: state.activeOrg }),
    },
  ),
);

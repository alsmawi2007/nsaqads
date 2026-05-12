import { api } from './client';

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  preferredLang: string;
  isSystemAdmin: boolean;
}

export interface OrgRef {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
  orgs: OrgRef[];
}

export const authApi = {
  login: (email: string, password: string) =>
    api.post<LoginResponse>('/auth/login', { email, password }, { skipAuth: true }),

  logout: async (): Promise<void> => {
    const refreshToken =
      typeof window !== 'undefined' ? localStorage.getItem('adari_refresh_token') : null;
    if (refreshToken) {
      await api.post('/auth/logout', { refreshToken }).catch(() => {});
    }
  },

  me: () => api.get<{ sub: string; email: string; isSystemAdmin: boolean }>('/auth/me'),
};

import { create } from 'zustand';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
  timezone: string;
  createdAt?: string;
}

export interface WorkspaceProject {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  planTier: 'FREE' | 'PRO' | 'TEAM';
  monitorLimit: number;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
  monitorCount: number;
  memberCount: number;
  activeIncidentCount: number;
}

interface AuthWorkspaceState {
  user: AuthUser | null;
  accessToken: string | null;
  isBootstrapping: boolean;
  activeProjectId: string | null;
  socketConnected: boolean;

  setSession: (user: AuthUser, accessToken: string) => void;
  setAccessToken: (accessToken: string) => void;
  setUser: (user: AuthUser) => void;
  clearSession: () => void;
  setBootstrapping: (loading: boolean) => void;
  setActiveProjectId: (projectId: string | null) => void;
  setSocketConnected: (connected: boolean) => void;
}

const ACTIVE_PROJECT_KEY = 'pw_active_project_id';

export const useAuthStore = create<AuthWorkspaceState>((set) => ({
  user: null,
  accessToken: null,
  isBootstrapping: true,
  activeProjectId:
    typeof window !== 'undefined' ? window.localStorage.getItem(ACTIVE_PROJECT_KEY) : null,
  socketConnected: false,

  setSession: (user, accessToken) =>
    set({
      user,
      accessToken,
      isBootstrapping: false,
    }),

  setAccessToken: (accessToken) => set({ accessToken }),

  setUser: (user) => set({ user }),

  clearSession: () => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
    }
    set({
      user: null,
      accessToken: null,
      isBootstrapping: false,
      activeProjectId: null,
      socketConnected: false,
    });
  },

  setBootstrapping: (isBootstrapping) => set({ isBootstrapping }),

  setActiveProjectId: (projectId) => {
    if (typeof window !== 'undefined') {
      if (projectId) {
        window.localStorage.setItem(ACTIVE_PROJECT_KEY, projectId);
      } else {
        window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
      }
    }
    set({ activeProjectId: projectId });
  },

  setSocketConnected: (socketConnected) => set({ socketConnected }),
}));

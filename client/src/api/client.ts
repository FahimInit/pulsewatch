import { useAuthStore, type AuthUser } from '@/stores/auth-store';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: Record<string, string[]>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, string[]>,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let refreshPromise: Promise<string | null> | null = null;

export async function silentRefreshSession(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        useAuthStore.getState().clearSession();
        return null;
      }
      const data = (await res.json()) as { user: AuthUser; accessToken: string };
      useAuthStore.getState().setSession(data.user, data.accessToken);
      return data.accessToken;
    } catch {
      useAuthStore.getState().clearSession();
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function apiFetch<T>(
  endpoint: string,
  options: RequestInit & { skipAuth?: boolean } = {},
): Promise<T> {
  const { skipAuth = false, headers: customHeaders, ...rest } = options;
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;

  const execute = async (token: string | null) => {
    const headers = new Headers(customHeaders);
    if (rest.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (!skipAuth && token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    return fetch(url, {
      ...rest,
      headers,
      credentials: 'include',
    });
  };

  let token = useAuthStore.getState().accessToken;
  let res = await execute(token);

  if (res.status === 401 && !skipAuth && !endpoint.startsWith('/auth/')) {
    token = await silentRefreshSession();
    if (token) {
      res = await execute(token);
    }
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    const errPayload = json?.error || {};
    throw new ApiClientError(
      res.status,
      errPayload.code || 'API_ERROR',
      errPayload.message || `Request failed (${res.status})`,
      errPayload.details,
    );
  }

  return json as T;
}

export type AppRole = 'admin' | 'staff' | 'support';

export interface AuthenticatedUserSession {
  role: AppRole;
  staffId?: string;
  name: string;
  token: string;
}

export function getAuthHeaders(session?: AuthenticatedUserSession | null): Record<string, string> {
  return session?.token ? { Authorization: `Bearer ${session.token}` } : {};
}

export function readStoredSession(): AuthenticatedUserSession | null {
  try {
    const raw = localStorage.getItem('nail_current_user_session');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      !['admin', 'staff', 'support'].includes(parsed.role) ||
      typeof parsed.name !== 'string' ||
      typeof parsed.token !== 'string' ||
      !parsed.token
    ) {
      localStorage.removeItem('nail_current_user_session');
      return null;
    }
    return parsed as AuthenticatedUserSession;
  } catch {
    localStorage.removeItem('nail_current_user_session');
    return null;
  }
}

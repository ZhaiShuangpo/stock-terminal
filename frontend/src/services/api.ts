const configuredOrigin = import.meta.env.VITE_API_ORIGIN?.trim().replace(/\/$/, '');

export const API_ORIGIN = configuredOrigin || `${window.location.protocol}//${window.location.hostname}:8000`;

export function apiUrl(path: string): string {
  return new URL(path, `${API_ORIGIN}/`).toString();
}

export function marketWebSocketUrl(): string {
  const url = new URL('/ws/market', `${API_ORIGIN}/`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), init);
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json() as { detail?: unknown };
      if (typeof body.detail === 'string') detail = body.detail;
    } catch {
      // Keep the HTTP status when the upstream body is not JSON.
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

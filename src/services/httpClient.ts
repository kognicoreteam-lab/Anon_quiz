const HOST_TOKEN_STORAGE_KEY = 'anonquiz_host_token_v1';

export function getStoredHostToken(): string | null {
  try {
    return window.localStorage.getItem(HOST_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredHostToken(token: string | null): void {
  try {
    if (token) {
      window.localStorage.setItem(HOST_TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(HOST_TOKEN_STORAGE_KEY);
    }
  } catch {
    // storage unavailable
  }
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    body?: unknown;
    auth?: boolean;
  } = {}
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.auth) {
    const token = getStoredHostToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  if (text) {
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
  }

  if (!response.ok) {
    const message =
      typeof parsed.error === 'string' && parsed.error
        ? parsed.error
        : `Request failed (${response.status})`;
    const code = typeof parsed.code === 'string' ? parsed.code : undefined;
    throw new ApiError(message, response.status, code);
  }

  return parsed as T;
}

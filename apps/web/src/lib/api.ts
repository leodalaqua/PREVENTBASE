"use client";

const BASE = "/api/v1";
const REFRESH_KEY = "pb.refresh";
const DEVICE_KEY = "pb.deviceKey";

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function onSessionLost(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function deviceKey(): string {
  let key = localStorage.getItem(DEVICE_KEY);
  if (!key) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    key = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(DEVICE_KEY, key);
  }
  return key;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function hasSession(): boolean {
  return !!localStorage.getItem(REFRESH_KEY);
}

export function setTokens(t: { accessToken: string; refreshToken: string }): void {
  accessToken = t.accessToken;
  localStorage.setItem(REFRESH_KEY, t.refreshToken);
}

export function clearTokens(): void {
  accessToken = null;
  localStorage.removeItem(REFRESH_KEY);
}

async function refresh(): Promise<boolean> {
  const token = localStorage.getItem(REFRESH_KEY);
  if (!token) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-device-key": deviceKey() },
        body: JSON.stringify({ refreshToken: token }),
      });
      if (!res.ok) {
        clearTokens();
        return false;
      }
      setTokens(await res.json());
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

interface RequestOpts {
  method?: string;
  body?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
  raw?: boolean;
}

async function send(path: string, opts: RequestOpts): Promise<Response> {
  const headers: Record<string, string> = { "x-device-key": deviceKey(), ...(opts.headers ?? {}) };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return fetch(`${BASE}${path}`, {
    method: opts.method ?? (opts.body !== undefined || opts.form ? "POST" : "GET"),
    headers,
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
}

export async function request<T = unknown>(path: string, opts: RequestOpts = {}): Promise<T> {
  if (!accessToken && hasSession()) await refresh();
  let res = await send(path, opts);
  if (res.status === 401 && hasSession() && !path.startsWith("/auth/login") && !path.startsWith("/auth/sso")) {
    if (await refresh()) res = await send(path, opts);
    else listeners.forEach((l) => l());
  }
  if (opts.raw) {
    if (!res.ok) throw await toError(res);
    return res as unknown as T;
  }
  if (res.status === 204) return undefined as T;
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}

async function toError(res: Response): Promise<ApiError> {
  const data = (await res.json().catch(() => ({}))) as { code?: string; message?: string; details?: unknown };
  const code = data.code ?? "HTTP_ERROR";
  if (res.status === 401 && hasSession() && code !== "INVALID_CREDENTIALS" && !code.startsWith("MFA") && !code.startsWith("SSO_MFA")) listeners.forEach((l) => l());
  return new ApiError(res.status, code, data.message ?? `Erro ${res.status}`, data.details);
}

export const api = {
  get: <T = unknown>(path: string) => request<T>(path),
  post: <T = unknown>(path: string, body?: unknown, headers?: Record<string, string>) => request<T>(path, { method: "POST", body: body ?? {}, headers }),
  put: <T = unknown>(path: string, body: unknown) => request<T>(path, { method: "PUT", body }),
  patch: <T = unknown>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body }),
  del: <T = unknown>(path: string, body?: unknown) => request<T>(path, { method: "DELETE", body }),
  upload: <T = unknown>(path: string, form: FormData) => request<T>(path, { method: "POST", form }),
};

/** Abre/baixa arquivo autenticado (PDF, XLSX, CSV). */
export async function openFile(path: string, download = false): Promise<void> {
  const res = await request<Response>(path, { raw: true });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "arquivo";
  if (download || !blob.type.includes("pdf")) {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
  } else {
    window.open(url, "_blank", "noopener");
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

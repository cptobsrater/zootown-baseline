import { QueryClient, QueryFunction } from "@tanstack/react-query";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

// In-memory admin token. Lives only in this module — NOT in localStorage,
// NOT in cookies. Closing the tab logs you out, which matches the
// "password every time" requirement.
let adminToken: string | null = null;
const tokenListeners = new Set<(token: string | null) => void>();

export function setAdminToken(token: string | null) {
  adminToken = token;
  for (const cb of tokenListeners) cb(token);
}

export function getAdminToken(): string | null {
  return adminToken;
}

export function subscribeAdminToken(cb: (token: string | null) => void): () => void {
  tokenListeners.add(cb);
  return () => tokenListeners.delete(cb);
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (data) headers["Content-Type"] = "application/json";
  if (adminToken) headers["Authorization"] = `Bearer ${adminToken}`;
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
  });

  if (res.status === 401 && url.startsWith("/api/admin")) {
    // Token expired or revoked — kick the admin out.
    setAdminToken(null);
  }
  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const headers: Record<string, string> = {};
    if (adminToken) headers["Authorization"] = `Bearer ${adminToken}`;
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`, { headers });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

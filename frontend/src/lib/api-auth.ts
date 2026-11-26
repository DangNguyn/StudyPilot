"use client";

import { getAuthClient } from "@/lib/auth";

/**
 * Tự gắn "thẻ đăng nhập" (access token của Supabase) vào mọi lần gọi backend StudyPilot,
 * để backend biết ai đang dùng và chỉ trả về dữ liệu của người đó.
 * Các trang vẫn gọi fetch(`${API_URL}/api/...`) như cũ, không cần sửa từng chỗ.
 */

const API_ORIGINS = new Set(
  [process.env.NEXT_PUBLIC_API_URL, "http://127.0.0.1:8000", "http://localhost:8000"]
    .filter((value): value is string => Boolean(value))
    .map((value) => {
      try {
        return new URL(value).origin;
      } catch {
        return "";
      }
    })
    .filter(Boolean),
);

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function isBackendCall(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.href);
    return API_ORIGINS.has(parsed.origin) && parsed.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

async function accessToken(refresh = false): Promise<string | null> {
  const client = getAuthClient();
  if (!client) return null;
  if (refresh) {
    const { data } = await client.auth.refreshSession();
    return data.session?.access_token ?? null;
  }
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

function withToken(input: RequestInfo | URL, init: RequestInit | undefined, token: string): RequestInit {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set("Authorization", `Bearer ${token}`);
  return { ...init, headers };
}

let installed = false;

export function installApiAuth() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (!isBackendCall(url)) return originalFetch(input, init);

    // Body dạng Request chỉ đọc được 1 lần: sao chép trước để còn gửi lại khi cần
    const retryInput = input instanceof Request ? input.clone() : input;

    const token = await accessToken();
    const response = await originalFetch(input, token ? withToken(input, init, token) : init);
    if (response.status !== 401) return response;

    // Token vừa hết hạn: làm mới rồi thử lại đúng 1 lần
    const fresh = await accessToken(true);
    if (!fresh || fresh === token) return response;
    return originalFetch(retryInput, withToken(retryInput, init, fresh));
  };
}

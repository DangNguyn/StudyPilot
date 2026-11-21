"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { getAuthClient } from "@/lib/auth";

type AuthState = {
  /* Người dùng đang đăng nhập (null nếu chưa) */
  user: User | null;
  /* Đang kiểm tra phiên đăng nhập */
  loading: boolean;
  /* Đã cấu hình Supabase Auth chưa */
  configured: boolean;
};

const AuthContext = createContext<AuthState>({ user: null, loading: true, configured: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = Boolean(getAuthClient());
  const [state, setState] = useState<AuthState>({ user: null, loading: configured, configured });

  useEffect(() => {
    const client = getAuthClient();
    if (!client) return;

    let active = true;
    client.auth
      .getSession()
      .then(({ data }) => {
        if (active) setState({ user: data.session?.user ?? null, loading: false, configured: true });
      })
      .catch(() => {
        if (active) setState({ user: null, loading: false, configured: true });
      });

    const { data } = client.auth.onAuthStateChange((_event, session) => {
      setState({ user: session?.user ?? null, loading: false, configured: true });
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

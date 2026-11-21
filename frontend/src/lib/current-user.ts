"use client";

import { tx } from "@/lib/i18n";
import { useAuth } from "@/components/auth-provider";

/* Tên của người đang đăng nhập: lấy từ "Họ và tên" lúc đăng ký */
export function useCurrentUserName() {
  const { user } = useAuth();
  // sp_name: tên tự đổi trong Cài đặt (Google không ghi đè khi đăng nhập lại); full_name: tên lúc đăng ký
  const fullName = String(user?.user_metadata?.sp_name || user?.user_metadata?.full_name || "").trim();
  if (fullName) return fullName;
  const email = user?.email || "";
  return email ? email.split("@")[0] : tx("bạn");
}

export function userInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length > 1 ? [words[0][0], words[words.length - 1][0]] : [words[0][0]];
  return letters.join("").toUpperCase();
}

/* Ảnh đại diện: ảnh chọn trong Cài đặt (sp_avatar, chuỗi rỗng = đã xoá); chưa chọn thì dùng ảnh Google */
export function useCurrentUserAvatar(): string | null {
  const { user } = useAuth();
  const meta = user?.user_metadata || {};
  if (typeof meta.sp_avatar === "string") return meta.sp_avatar.trim() || null;
  const url = String(meta.avatar_url || meta.picture || "").trim();
  return url || null;
}

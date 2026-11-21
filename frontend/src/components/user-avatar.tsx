"use client";

import { tx } from "@/lib/i18n";
import { useState } from "react";
import { useCurrentUserAvatar, useCurrentUserName, userInitials } from "@/lib/current-user";

/* Ảnh đại diện của người đang đăng nhập; chưa có ảnh thì hiện chữ viết tắt của tên */
export default function UserAvatar({
  size = 40,
  rounded = "rounded-xl",
  className = "",
  src,
}: {
  size?: number;
  rounded?: string;
  className?: string;
  /* Ảnh xem trước (trang Cài đặt); bỏ trống thì dùng ảnh đã lưu */
  src?: string | null;
}) {
  const saved = useCurrentUserAvatar();
  const name = useCurrentUserName();
  const url = src === undefined ? saved : src;
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);

  if (url && brokenUrl !== url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={tx("Ảnh đại diện của {0}", [name])}
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setBrokenUrl(url)}
        className={`shrink-0 bg-[var(--sp-lav)] object-cover ${rounded} ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-label={tx("Ảnh đại diện của {0}", [name])}
      className={`flex shrink-0 items-center justify-center bg-[var(--sp-pink-bg)] font-bold text-[var(--sp-pink-dark)] ${rounded} ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(12, Math.round(size * 0.34)) }}
    >
      {userInitials(name)}
    </span>
  );
}

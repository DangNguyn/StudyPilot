"use client";

// Chế độ sáng / tối. Lưu trong localStorage "sp-theme" để áp dụng ngay khi tải trang.
export type Theme = "light" | "dark";
const KEY = "sp-theme";

export function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

type ViewTransitionDocument = Document & { startViewTransition?: (update: () => void) => unknown };

function setDarkClass(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function applyTheme(theme: Theme, animate = true) {
  if (typeof document === "undefined") return;
  if (theme === currentTheme()) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const doc = document as ViewTransitionDocument;
  if (animate && !reduce && doc.startViewTransition) {
    // Trình duyệt mới: hoà dần ảnh cũ sang ảnh mới, cả trang đổi màu cùng lúc, không chớp
    doc.startViewTransition(() => setDarkClass(theme));
  } else if (animate && !reduce) {
    // Trình duyệt cũ: cho các màu nền / chữ / viền chuyển dần trong lúc đổi
    const root = document.documentElement;
    root.classList.add("sp-theme-fade");
    setDarkClass(theme);
    window.setTimeout(() => root.classList.remove("sp-theme-fade"), 500);
  } else {
    setDarkClass(theme);
  }
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* trình duyệt chặn lưu trữ: vẫn đổi được trong phiên này */
  }
}

// Chạy trước khi React vẽ trang để không bị nháy nền sáng
export const THEME_INIT_SCRIPT = `try{if(localStorage.getItem("${KEY}")==="dark")document.documentElement.classList.add("dark")}catch(e){}`;

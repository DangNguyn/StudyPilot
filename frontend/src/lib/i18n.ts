/*
 * Đa ngôn ngữ cho StudyPilot.
 *
 * Cách dùng: bọc chữ tiếng Việt bằng tx("Tổng quan") hoặc tx("Còn {0} ngày", [days]).
 * Câu tiếng Việt chính là "khoá"; bản tiếng Anh nằm trong i18n-en.ts.
 *
 * Ngôn ngữ được đọc một lần lúc tải trang (localStorage "sp-lang"). Đổi ngôn ngữ thì tải lại trang,
 * nên tx() dùng được ở mọi nơi, kể cả hằng số đặt ngoài component.
 * Trên máy chủ luôn là tiếng Việt; các trang chỉ hiện nội dung sau khi trình duyệt khởi động xong
 * (AppShell chờ hydrate), nên không bị lệch giữa bản máy chủ và trình duyệt.
 */

import { EN } from "@/lib/i18n-en";

export type Lang = "vi" | "en";
export const LANG_STORAGE_KEY = "sp-lang";

function readStoredLang(): Lang {
  if (typeof window === "undefined") return "vi";
  try {
    return window.localStorage.getItem(LANG_STORAGE_KEY) === "en" ? "en" : "vi";
  } catch {
    return "vi";
  }
}

const activeLang: Lang = readStoredLang();

export function currentLang(): Lang {
  return activeLang;
}

/* Mã vùng cho định dạng ngày giờ, số */
export function currentLocale() {
  return activeLang === "en" ? "en-US" : "vi-VN";
}

function fill(text: string, vars?: ReadonlyArray<unknown>) {
  if (!vars || vars.length === 0) return text;
  return text.replace(/\{(\d+)\}/g, (match, index) => {
    const value = vars[Number(index)];
    return value === undefined || value === null ? "" : String(value);
  });
}

/* Dịch một câu. Chưa có bản dịch thì giữ nguyên tiếng Việt. */
export function tx(vi: string, vars?: ReadonlyArray<unknown>): string {
  if (activeLang === "en") {
    const en = EN[vi] ?? EN[vi.trim()];
    if (en !== undefined) return fill(en, vars);
  }
  return fill(vi, vars);
}

/* Cho các file không import được "@/lib/i18n" (vd: lib/review-urgency.ts chạy bằng node) dùng chung hàm dịch */
(globalThis as { __spTx?: typeof tx }).__spTx = tx;

/* Lưu ngôn ngữ rồi tải lại trang để toàn bộ web đổi theo */
export function applyLanguage(lang: Lang, reload = true) {
  let stored = false;
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
    stored = window.localStorage.getItem(LANG_STORAGE_KEY) === lang;
  } catch {
    stored = false;
  }
  // Chỉ tải lại khi đã lưu được, tránh tải lại liên tục nếu trình duyệt chặn lưu trữ
  if (reload && stored && lang !== activeLang) window.location.reload();
}

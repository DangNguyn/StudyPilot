"use client";

import { useSyncExternalStore } from "react";

/* Công tắc "Hiệu ứng nền" (Cài đặt → Giao diện). Lưu theo máy ở localStorage, mặc định bật. */
const KEY = "sp-bg-motion";
const listeners = new Set<() => void>();

function read() {
  try {
    return window.localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setBgMotion(on: boolean) {
  try {
    window.localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* trình duyệt chặn lưu trữ: chỉ đổi trong phiên này */
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useBgMotion() {
  return useSyncExternalStore(subscribe, read, () => true);
}

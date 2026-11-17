"use client";

import { useEffect, useRef, useState } from "react";
import { IconClock } from "@/components/icons";

/*
 * Đồng hồ đếm thời gian học của một ngày học.
 * - Tự chạy khi đang mở trang, tự dừng khi chuyển tab/thu nhỏ cửa sổ.
 * - Lưu vào trình duyệt theo từng ngày học nên tải lại trang vẫn cộng dồn.
 */
export default function StudyTimer({ storageKey }: { storageKey: string }) {
  const [seconds, setSeconds] = useState(0);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const secondsRef = useRef(0);

  /* Đọc thời gian đã lưu khi đổi ngày học */
  useEffect(() => {
    let saved = 0;
    try {
      saved = Number(window.localStorage.getItem(storageKey) || 0) || 0;
    } catch {
      saved = 0;
    }
    secondsRef.current = saved;
    setSeconds(saved);
    setPaused(false);
  }, [storageKey]);

  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState === "visible");
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const running = visible && !paused;

  useEffect(() => {
    const save = () => {
      try {
        window.localStorage.setItem(storageKey, String(secondsRef.current));
      } catch {
        /* trình duyệt chặn lưu trữ: bỏ qua */
      }
    };

    if (!running) {
      save();
      return;
    }

    const timer = window.setInterval(() => {
      secondsRef.current += 1;
      setSeconds(secondsRef.current);
      if (secondsRef.current % 5 === 0) save();
    }, 1000);

    window.addEventListener("beforeunload", save);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("beforeunload", save);
      save();
    };
  }, [running, storageKey]);

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const clock = `${hours > 0 ? `${hours}:` : ""}${String(minutes).padStart(hours > 0 ? 2 : 1, "0")}:${String(rest).padStart(2, "0")}`;

  return (
    <div
      className={`flex items-center gap-2.5 rounded-2xl border-2 py-1.5 pl-2 pr-1.5 transition ${
        running
          ? "border-[var(--sp-purple)] bg-white shadow-[3px_3px_0_var(--sp-lav-line)]"
          : "border-[var(--sp-line)] bg-[var(--sp-surface-2)]"
      }`}
      role="timer"
      aria-label={`Đã học ${minutes + hours * 60} phút ${rest} giây`}
    >
      <span
        className={`relative flex h-8 w-8 items-center justify-center rounded-xl ${
          running ? "bg-[var(--sp-pink)] text-white" : "bg-white text-[var(--sp-muted)]"
        }`}
      >
        <IconClock size={16} />
        {running && (
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full border-2 border-white bg-emerald-500" />
        )}
      </span>
      <span className="leading-tight">
        <span className="block text-[10px] font-bold uppercase tracking-wide text-[var(--sp-muted)]">
          {running ? "Đang học" : "Tạm dừng"}
        </span>
        <span className="block min-w-[56px] font-mono text-[17px] font-extrabold tabular-nums text-[var(--sp-ink)]">
          {clock}
        </span>
      </span>
      <button
        type="button"
        onClick={() => setPaused((value) => !value)}
        className="rounded-lg px-2 py-1 text-xs font-bold text-[var(--sp-peri-dark)] transition hover:bg-[var(--sp-lav)]"
      >
        {paused ? "Tiếp tục" : "Dừng"}
      </button>
    </div>
  );
}

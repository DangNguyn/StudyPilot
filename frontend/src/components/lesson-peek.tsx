"use client";

import { tx } from "@/lib/i18n";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { matchLesson, type LessonSection } from "@/lib/lesson-match";
import { IconArrowLeft, IconArrowRight, IconX } from "@/components/icons";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
const WIDTH = 520;

type SessionData = {
  topic?: { name?: string; content_sections?: LessonSection[] | null } | null;
  chunks?: { page_number?: number | null; content?: string }[];
};

// Mỗi buổi chỉ tải một lần dù mở popup nhiều câu
const cache = new Map<string, Promise<SessionData>>();
function loadSession(sessionId: string) {
  if (!cache.has(sessionId)) {
    const request = fetch(`${API_URL}/api/study-sessions/${sessionId}`, { cache: "no-store" }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.detail || tx("Không tải được bài học."));
      return data as SessionData;
    });
    request.catch(() => cache.delete(sessionId));
    cache.set(sessionId, request);
  }
  return cache.get(sessionId)!;
}

export type LessonPeekRequest = {
  /* câu hỏi + đáp án đúng + giải thích, dùng để tìm mục tóm tắt */
  query: string;
  page?: number | null;
  /* đoạn gốc có sẵn (kết quả bài làm đã kèm), dùng khi buổi học không có trang đó */
  raw?: string | null;
  anchor: HTMLElement;
};

/* Popup xem nhanh mục tóm tắt chứa kiến thức của câu, không rời trang kết quả */
export default function LessonPeek({
  sessionId,
  dayLabel,
  lessonHref,
  request,
  onClose,
}: {
  sessionId: string;
  dayLabel: string;
  lessonHref: string;
  request: LessonPeekRequest;
  onClose: () => void;
}) {
  const [state, setState] = useState<{ id: string; data?: SessionData; error?: string } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let alive = true;
    loadSession(sessionId).then(
      (data) => alive && setState({ id: sessionId, data }),
      (error) => alive && setState({ id: sessionId, error: error instanceof Error ? error.message : String(error) })
    );
    return () => {
      alive = false;
    };
  }, [sessionId]);
  const ready = state?.id === sessionId ? state : null;

  const match = useMemo(
    () => matchLesson(ready?.data?.topic?.content_sections || [], request.query),
    [ready, request.query]
  );
  const raw =
    ready?.data?.chunks?.find((chunk) => request.page != null && chunk.page_number === request.page)?.content || request.raw || "";

  // Bám cạnh nút: đủ chỗ thì nằm bên trái nút, không thì nằm dưới; điện thoại thì thành tấm dưới đáy (CSS)
  useLayoutEffect(() => {
    // Đặt thẳng style (không qua state) để không vẽ lại cả popup mỗi lần cuộn
    const measure = () => {
      const box = boxRef.current;
      const arrow = arrowRef.current;
      if (!box || !arrow) return;
      if (window.innerWidth < 640) {
        box.style.left = box.style.top = box.style.width = "";
        arrow.style.display = "none";
        return;
      }
      const rect = request.anchor.getBoundingClientRect();
      const height = box.offsetHeight;
      const clampTop = (value: number) => Math.max(12, Math.min(value, window.innerHeight - height - 12));
      let left = rect.left - WIDTH - 16;
      let top: number;
      const side = left >= 12 ? "left" : rect.right + 16 + WIDTH <= window.innerWidth - 12 ? "right" : null;
      if (side) {
        if (side === "right") left = rect.right + 16;
        top = clampTop(rect.top + rect.height / 2 - height / 2);
        arrow.style.display = "block";
        arrow.style.top = `${rect.top + rect.height / 2 - top - 8}px`;
        // mũi tên chỉ về phía nút: bên phải popup hoặc lật sang bên trái
        arrow.style.right = side === "left" ? "-9px" : "auto";
        arrow.style.left = side === "right" ? "-9px" : "auto";
        arrow.style.rotate = side === "right" ? "225deg" : "";
      } else {
        left = Math.max(12, Math.min(rect.left, window.innerWidth - WIDTH - 12));
        top = clampTop(rect.bottom + 12);
        arrow.style.display = "none";
      }
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
      box.style.width = `${WIDTH}px`;
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [request.anchor, match, ready]);

  useEffect(() => {
    const anchor = request.anchor;
    boxRef.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      anchor.focus();
    };
  }, [request.anchor, onClose]);

  const section = match?.section;
  const hit = (key: string) => match?.hits.has(key);
  const lines = (section?.content || "").split("\n").map((line, index) => [line.trim(), `c:${index}`] as const).filter(([line]) => line);

  return createPortal(
    <>
      <div className="sp-dialog-veil fixed inset-0 z-40 bg-[rgba(36,18,58,.22)]" onMouseDown={onClose} aria-hidden="true" />
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label={tx("Xem nhanh bài học")}
        tabIndex={-1}
        className="sp-task-expand fixed z-50 flex max-h-[min(580px,calc(100vh-24px))] flex-col rounded-[22px] border-2 border-[var(--sp-purple)] bg-white shadow-[6px_6px_0_var(--sp-purple-deep)] outline-none max-sm:inset-x-3 max-sm:bottom-3 max-sm:max-h-[80vh]"
      >
        <span
          ref={arrowRef}
          aria-hidden
          className="absolute hidden h-3.5 w-3.5 rotate-45 border-2 border-b-0 border-l-0 border-[var(--sp-purple)] bg-white"
        />
        <div className="grid grid-cols-[minmax(0,1fr)_34px] gap-3 border-b-2 border-dashed border-[var(--sp-line)] px-[18px] pb-3 pt-4">
          <div className="min-w-0">
            <p className="truncate text-[12px] font-semibold text-[var(--sp-muted)]">
              {[dayLabel, ready?.data?.topic?.name].filter(Boolean).join(" · ")}
              {request.page ? <b className="text-[var(--sp-peri-dark)]"> › {tx("Trang {0}", [request.page])}</b> : null}
            </p>
            <h3 className="mt-1 text-[17px] leading-snug text-[var(--sp-ink)]">
              {match?.parent?.heading || tx("Mục trong bài tóm tắt")}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={tx("Đóng")}
            className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] border-2 border-[var(--sp-line)] bg-white text-[var(--sp-muted)] hover:border-[var(--sp-lav-line)]"
          >
            <IconX size={15} />
          </button>
        </div>

        <div className="grid gap-3 overflow-y-auto px-[18px] py-3.5">
          {!ready ? (
            <p className="py-6 text-center text-sm text-[var(--sp-muted)]">{tx("Đang mở bài học…")}</p>
          ) : ready.error ? (
            <p className="py-6 text-center text-sm font-semibold text-[var(--sp-pink-dark)]">{ready.error}</p>
          ) : !section ? (
            <p className="py-6 text-center text-sm text-[var(--sp-muted)]">{tx("Bài này chưa có tóm tắt. Xem đoạn gốc bên dưới.")}</p>
          ) : (
            <div className="overflow-hidden rounded-2xl border-2 border-[var(--sp-purple-deep)]">
              <p className="grid grid-cols-[30px_minmax(0,1fr)] items-center gap-2.5 border-b-2 border-[var(--sp-purple-deep)] bg-[var(--sp-lav)] px-3 py-2.5 text-[14px] font-extrabold text-[var(--sp-ink)]">
                <span className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-yellow)] text-[12px] text-[var(--sp-purple-deep)]">
                  {match.label}
                </span>
                {section.heading}
              </p>
              <div className="grid gap-2.5 px-3.5 py-3">
                {lines.length > 0 && (
                  <ul className="grid gap-1.5">
                    {lines.map(([line, key]) => (
                      <li key={key} className="grid grid-cols-[14px_minmax(0,1fr)] gap-2 text-[14px] leading-6 text-[var(--sp-text-2)]">
                        <span className="mt-2 h-2 w-2 rounded-full border-[1.5px] border-[var(--sp-purple-deep)] bg-[var(--sp-yellow)]" />
                        <span className={hit(key) ? "sp-hl" : ""}>{line}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {section.table?.rows?.length ? (
                  <div className="overflow-x-auto rounded-xl border-2 border-[var(--sp-line)]">
                    <table className="w-full text-[13.5px]">
                      {section.table.headers?.length ? (
                        <thead>
                          <tr>
                            {section.table.headers.map((head) => (
                              <th key={head} className="bg-[var(--sp-surface-2)] px-2.5 py-2 text-left text-[12px] text-[var(--sp-muted)]">
                                {head}
                              </th>
                            ))}
                          </tr>
                        </thead>
                      ) : null}
                      <tbody>
                        {section.table.rows.map((row, index) => (
                          <tr key={index} className={hit(`r:${index}`) ? "bg-[var(--sp-amber-bg)] font-bold" : ""}>
                            {row.map((cell, cellIndex) => (
                              <td key={cellIndex} className="border-t-[1.5px] border-[var(--sp-line)] px-2.5 py-2 text-[var(--sp-ink)]">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {section.key_points?.length ? (
                  <div className="rounded-xl border-2 border-[var(--sp-amber-line)] bg-[var(--sp-amber-bg)] px-3 py-2.5">
                    <p className="text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-[var(--sp-amber-dark)]">{tx("Ghi nhớ nhanh")}</p>
                    <ul className="mt-1.5 grid gap-1">
                      {section.key_points.map((point, index) => (
                        <li key={index} className="grid grid-cols-[14px_minmax(0,1fr)] gap-2 text-[13.5px] leading-6 text-[var(--sp-text-2)]">
                          <span className="mt-2 h-2 w-2 rounded-full bg-[var(--sp-amber-dark)]" />
                          <span className={hit(`k:${index}`) ? "sp-hl" : ""}>{point}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>
          )}
          {raw && (
            <details className="rounded-xl border-2 border-dashed border-[var(--sp-lav-line)] px-3 py-2 text-[13px]" open={Boolean(ready && !section)}>
              <summary className="cursor-pointer font-extrabold text-[var(--sp-peri-dark)]">
                {request.page ? tx("Đoạn gốc trang {0}", [request.page]) : tx("Đoạn gốc trong tài liệu")}
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--sp-muted)]">{raw}</p>
            </details>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2.5 border-t-2 border-dashed border-[var(--sp-line)] px-[18px] pb-4 pt-3">
          <button type="button" onClick={onClose} className="sp-btn sp-btn-secondary justify-center px-3 py-2 text-[13px]">
            <IconArrowLeft size={14} />
            {tx("Về câu sai")}
          </button>
          <a href={lessonHref} target="_blank" rel="noopener" className="sp-btn sp-btn-primary justify-center px-3 py-2 text-[13px]">
            {tx("Mở cả bài học")}
            <IconArrowRight size={14} />
          </a>
        </div>
      </div>
    </>,
    document.body
  );
}

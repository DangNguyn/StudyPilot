"use client";

import { useEffect, useRef, useState } from "react";
import { IconCheck, IconLayers, IconTarget, IconX, Sparkle } from "@/components/icons";
import { PilotMascot } from "@/components/loading-play";
import { stripOutlineNumbers } from "@/lib/content-titles";

/* ---------- Kiểu dữ liệu ---------- */

export type PlanMode = "chapter" | "focus";

export type OutlineChapter = {
  name: string;
  lesson_count: number;
  chunk_count: number;
  difficulty: number;
  start_chunk: number;
  end_chunk: number;
  start_page?: number | null;
  end_page?: number | null;
  suggested_focus: boolean;
};

export type OutlineState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; chapters: OutlineChapter[] }
  | { status: "error"; message: string };

export type CreateStep = { title: string; complete: boolean };

/* Tỷ lệ thời gian của chế độ trọng tâm (khớp với backend) */
export const FOCUS_SHARE = 75;
export const SKIM_SHARE = 21;
export const REVIEW_SHARE = 4;

/* ---------- Tiện ích ---------- */

/** "Chương 2: Cung và cầu" → { code: "C2", title: "Cung và cầu" } */
export function chapterLabel(name: string, index: number) {
  const match = name.match(/^\s*(?:chương|chapter|unit|phần|part|bài)\s*([0-9]+|[IVXLC]+)\b/i);
  const code = `C${match ? match[1] : index + 1}`;
  const rest = match ? name.slice(match[0].length).replace(/^[\s:.\-–—]+/, "") : name;
  const title = stripOutlineNumbers(rest).trim() || stripOutlineNumbers(name).trim() || name;
  return { code, title };
}

/** Phân bổ % thời gian cho từng chương theo chế độ đã chọn */
export function chapterShares(chapters: OutlineChapter[], mode: PlanMode, focus: Set<number>, hasReview: boolean) {
  const total = chapters.reduce((sum, chapter) => sum + Math.max(1, chapter.chunk_count), 0) || 1;

  if (mode === "chapter" || focus.size === 0 || focus.size === chapters.length) {
    return { shares: chapters.map((chapter) => (Math.max(1, chapter.chunk_count) / total) * 100), review: 0 };
  }

  const review = hasReview ? REVIEW_SHARE : 0;
  const scale = 100 / (FOCUS_SHARE + SKIM_SHARE + review);
  const focusTotal = chapters.reduce((sum, chapter, index) => sum + (focus.has(index) ? Math.max(1, chapter.chunk_count) : 0), 0);
  const skimTotal = total - focusTotal;
  return {
    shares: chapters.map((chapter, index) => {
      const size = Math.max(1, chapter.chunk_count);
      return focus.has(index)
        ? (size / focusTotal) * FOCUS_SHARE * scale
        : (size / skimTotal) * SKIM_SHARE * scale;
    }),
    review: review * scale,
  };
}

/* ---------- Đầu trang: Pilot hướng dẫn + 4 bước ---------- */

const HERO_LINES = [
  "Chào bạn! Cho mình biết môn học và ngày thi trước nhé.",
  "Ngon! Giờ chọn số ngày bạn học được mỗi tuần nha.",
  "Đưa mình tài liệu, mình sẽ đọc và chia chương cho.",
  "Chọn cách chia rồi bấm “Xem kế hoạch dự kiến” nhé!",
  "Xong hết rồi! Bấm xem kế hoạch dự kiến, mình xếp thử cho bạn xem 🎉",
];
const HERO_POKE = ["Hihi, nhột quá!", "Mình đợi bạn điền xong nè~", "Cố lên, sắp có lịch rồi!"];

export function CreatePlanHero({ steps, ready = false }: { steps: CreateStep[]; ready?: boolean }) {
  const firstOpen = steps.findIndex((step) => !step.complete);
  const current = firstOpen < 0 ? steps.length : firstOpen;
  const [poke, setPoke] = useState<{ text: string; at: number } | null>(null);
  const pokeCount = useRef(0);

  useEffect(() => {
    if (!poke) return;
    const id = window.setTimeout(() => setPoke(null), 2200);
    return () => window.clearTimeout(id);
  }, [poke]);

  return (
    <section className="relative grid grid-cols-[84px_minmax(0,1fr)] items-center gap-x-4 gap-y-4 overflow-hidden rounded-[26px] border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-purple)] p-4 text-white shadow-[6px_6px_0_var(--sp-pink)] sm:grid-cols-[110px_minmax(0,1fr)] sm:px-6 xl:grid-cols-[110px_minmax(0,1fr)_auto]">
      <span aria-hidden="true" className="absolute -right-16 -top-20 h-60 w-60 rounded-full bg-[var(--sp-pink)]/35" />
      <div className="relative">
        <PilotMascot
          key={current}
          size={110}
          interactive
          onPoke={() => setPoke({ text: HERO_POKE[pokeCount.current++ % HERO_POKE.length], at: Date.now() })}
        />
      </div>
      <div className="relative min-w-0">
        <p className="sp-accent text-[17px] text-[#ffd3e2]">Kế hoạch ôn thi · Tạo mới</p>
        <h1 className="font-display text-[28px] leading-tight !text-white sm:text-[34px]">Tạo kế hoạch ôn thi</h1>
        <p
          key={poke?.at ?? (ready ? "ready" : current)}
          className="sp-hero-bubble relative mt-2 inline-block max-w-[560px] rounded-[14px] border-2 border-[var(--sp-purple-deep)] bg-white px-3.5 py-2 text-[14px] font-bold text-[var(--sp-ink)] shadow-[3px_3px_0_var(--sp-pink)]"
          role="status"
        >
          {poke?.text ?? HERO_LINES[ready ? HERO_LINES.length - 1 : Math.min(current, HERO_LINES.length - 2)]}
        </p>
      </div>
      <ol className="relative col-span-full grid grid-cols-4 gap-2 xl:col-span-1 xl:grid-cols-[repeat(4,92px)]" aria-label="Các bước tạo kế hoạch">
        {steps.map((step, index) => {
          const on = index === Math.min(current, steps.length - 1) && !step.complete;
          return (
            <li
              key={step.title}
              className={`rounded-2xl border-2 px-2 py-2.5 text-center text-[12.5px] font-bold transition duration-300 ${
                step.complete
                  ? "border-emerald-300 bg-emerald-500/20 text-emerald-50"
                  : on
                    ? "border-[var(--sp-purple-deep)] bg-white text-[var(--sp-purple)] shadow-[3px_3px_0_var(--sp-pink)]"
                    : "border-white/20 bg-white/10 text-white/75"
              }`}
              aria-current={on ? "step" : undefined}
            >
              <span
                className={`mx-auto mb-1.5 flex h-[30px] w-[30px] items-center justify-center rounded-full text-[14px] font-extrabold ${
                  step.complete ? "bg-emerald-500 text-white" : on ? "bg-[var(--sp-peri)] text-white" : "bg-white/15"
                }`}
              >
                {step.complete ? <IconCheck size={15} /> : index + 1}
              </span>
              {step.title}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ---------- Thẻ chọn cách chia kế hoạch ---------- */

export function PlanModeCards({
  mode,
  onChange,
  compact = false,
}: {
  mode: PlanMode;
  onChange: (mode: PlanMode) => void;
  /* bản gọn cho cột hẹp: bỏ biểu tượng và nhãn phụ, câu mô tả ngắn */
  compact?: boolean;
}) {
  const options: { value: PlanMode; title: string; tag: string; text: string; icon: typeof IconLayers }[] = [
    {
      value: "chapter",
      title: "Theo chương",
      tag: "Tuyến tính",
      text: compact ? "Chia đều các chương, học lần lượt từ đầu đến cuối." : "Chia đều các chương theo ngày, học lần lượt từ chương đầu đến chương cuối.",
      icon: IconLayers,
    },
    {
      value: "focus",
      title: "Theo trọng tâm",
      tag: "Trọng số",
      text: compact ? "Dồn 70–80% thời gian cho chương bạn chọn." : "Dồn 70–80% thời gian cho chương trọng tâm, phần còn lại đọc lướt.",
      icon: IconTarget,
    },
  ];

  return (
    <div role="radiogroup" aria-label="Cách chia kế hoạch" className="grid gap-3 sm:grid-cols-2">
      {options.map((option) => {
        const active = mode === option.value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`relative flex gap-3 rounded-2xl border-2 text-left transition ${compact ? "px-3.5 py-3 pr-9" : "p-4"} ${
              active
                ? option.value === "focus"
                  ? "border-[var(--sp-pink)] bg-[var(--sp-pink-bg)] shadow-[3px_3px_0_var(--sp-pink-line)]"
                  : "border-[var(--sp-peri)] bg-[var(--sp-lav)] shadow-[3px_3px_0_var(--sp-lav-line)]"
                : "border-[var(--sp-line)] bg-white hover:border-[var(--sp-lav-line)]"
            }`}
          >
            <span
              className={`${compact ? "hidden" : "flex"} h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                option.value === "focus" ? "bg-white text-[var(--sp-pink-dark)]" : "bg-white text-[var(--sp-peri-dark)]"
              } ring-1 ring-[var(--sp-line)]`}
            >
              <Icon size={19} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-[15px] font-bold text-[var(--sp-ink)]">{option.title}</span>
                <span className={`${compact ? "hidden" : ""} rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-[var(--sp-muted)] ring-1 ring-[var(--sp-line)]`}>
                  {option.tag}
                </span>
              </span>
              <span className="mt-1 block text-[13px] leading-5 text-[var(--sp-text-2,#4d4366)]">{option.text}</span>
            </span>
            <span
              aria-hidden="true"
              className={`absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                active
                  ? option.value === "focus"
                    ? "border-[var(--sp-pink)] bg-[var(--sp-pink)]"
                    : "border-[var(--sp-peri)] bg-[var(--sp-peri)]"
                  : "border-[var(--sp-lav-line)] bg-white"
              }`}
            >
              {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Chip chương trọng tâm ---------- */

export function FocusChapterChips({
  outline,
  focus,
  onToggle,
  onRetry,
  hasFile,
}: {
  outline: OutlineState;
  focus: Set<number>;
  onToggle: (index: number) => void;
  onRetry: () => void;
  hasFile: boolean;
}) {
  return (
    <div className="sp-task-expand rounded-2xl border border-[var(--sp-line)] bg-[var(--sp-surface-2)] p-4">
      <p className="flex flex-wrap items-center gap-x-2 text-sm font-bold text-[var(--sp-ink)]">
        Chương trọng tâm
        <span className="flex items-center gap-1 text-xs font-semibold text-[var(--sp-muted)]">
          <Sparkle size={11} className="text-[var(--sp-pink)]" />
          AI gợi ý · bấm để bật/tắt
        </span>
      </p>

      {outline.status === "done" ? (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {outline.chapters.map((chapter, index) => {
              const { code, title } = chapterLabel(chapter.name, index);
              const active = focus.has(index);
              return (
                <button
                  key={`${chapter.start_chunk}-${index}`}
                  type="button"
                  aria-pressed={active}
                  title={chapter.name}
                  onClick={() => onToggle(index)}
                  className={`flex max-w-[220px] items-center gap-1.5 rounded-full border-2 px-3 py-1.5 text-[13px] font-semibold transition ${
                    active
                      ? "border-[var(--sp-pink)] bg-[var(--sp-pink)] text-white shadow-[2px_2px_0_var(--sp-pink-line)]"
                      : "border-[var(--sp-line)] bg-white text-[var(--sp-muted)] hover:border-[var(--sp-pink-line)]"
                  }`}
                >
                  {chapter.suggested_focus && <span aria-label="AI gợi ý">★</span>}
                  <span className="font-extrabold">{code}</span>
                  <span className="truncate">{title}</span>
                </button>
              );
            })}
          </div>
          {focus.size === 0 && (
            <p className="mt-2 text-xs font-semibold text-[var(--sp-pink-dark)]">Chọn ít nhất 1 chương trọng tâm.</p>
          )}
          {focus.size > 0 && focus.size === outline.chapters.length && (
            <p className="mt-2 text-xs font-semibold text-[var(--sp-amber-dark)]">
              Đang chọn tất cả chương — kế hoạch sẽ giống chia theo chương.
            </p>
          )}
        </>
      ) : outline.status === "loading" ? (
        <div className="mt-3 flex flex-wrap gap-2" aria-busy="true">
          {[72, 96, 64, 88, 70].map((width, index) => (
            <span key={index} className="h-8 animate-pulse rounded-full bg-white" style={{ width }} />
          ))}
          <span className="w-full text-xs text-[var(--sp-muted)]">AI đang đọc tài liệu để nhận diện chương…</span>
        </div>
      ) : outline.status === "error" ? (
        <div className="mt-2 text-[13px] text-[var(--sp-pink-dark)]">
          {outline.message}{" "}
          <button type="button" onClick={onRetry} className="font-bold underline underline-offset-2">
            Thử lại
          </button>
        </div>
      ) : (
        <p className="mt-2 text-[13px] text-[var(--sp-muted)]">
          {hasFile ? "Đang chuẩn bị…" : "Tải tài liệu lên để AI nhận diện chương và gợi ý phần trọng tâm."}
        </p>
      )}
    </div>
  );
}

/* ---------- Popup kế hoạch dự kiến ---------- */

const WEEKDAY = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

function addDayKey(key: string, days: number) {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function PlanPreviewDialog({
  open,
  onClose,
  onConfirm,
  submitting,
  subjectName,
  mode,
  daysToExam,
  studyDates,
  studyDayCount,
  reviewDayCount,
  dailyHours,
  outline,
  focus,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  submitting: boolean;
  subjectName: string;
  mode: PlanMode;
  daysToExam: number | null;
  /* ngày học đã chọn, dạng YYYY-MM-DD */
  studyDates: string[];
  studyDayCount: number;
  reviewDayCount: number;
  dailyHours: number;
  outline: OutlineState;
  focus: Set<number>;
}) {
  const [grow, setGrow] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const id = window.requestAnimationFrame(() => setGrow(true));
    return () => {
      document.removeEventListener("keydown", onKey);
      window.cancelAnimationFrame(id);
      setGrow(false);
    };
  }, [open, onClose]);

  if (!open) return null;

  const chapters = outline.status === "done" ? outline.chapters : [];
  const effectiveFocus = mode === "focus" ? focus : new Set<number>();
  const isFocus = mode === "focus" && focus.size > 0 && focus.size < chapters.length;
  const { shares, review } = chapterShares(chapters, mode, effectiveFocus, reviewDayCount > 0);
  const lessonCount = chapters.reduce((sum, chapter) => sum + chapter.lesson_count, 0);

  // Tuần đầu tiên có buổi học
  const sorted = [...studyDates].sort();
  const firstWeek = sorted[0]
    ? Array.from({ length: 7 }, (_, index) => {
        const weekday = new Date(`${sorted[0]}T00:00:00Z`).getUTCDay();
        return addDayKey(sorted[0], index - ((weekday + 6) % 7));
      })
    : [];

  const stats = [
    { value: daysToExam ?? "—", label: "ngày đến thi", shadow: "var(--sp-pink-line)" },
    { value: studyDayCount || "—", label: "ngày học", shadow: "var(--sp-lav-line)" },
    { value: lessonCount || "—", label: "bài học", shadow: "#f3dc9b" },
    { value: `${dailyHours} giờ`, label: "mỗi ngày", shadow: "#e3cdf0" },
  ];

  return (
    <div
      className="sp-dialog-veil fixed inset-0 z-50 flex items-center justify-center bg-[rgba(36,18,58,0.45)] p-4 backdrop-blur-[2px]"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-preview-title"
        className="sp-dialog-pop max-h-[92vh] w-full max-w-[760px] overflow-y-auto rounded-[24px] border-2 border-[var(--sp-purple-deep)] bg-white p-5 shadow-[6px_6px_0_var(--sp-pink)] sm:px-7 sm:py-6"
      >
        <div className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3.5 sm:grid-cols-[76px_minmax(0,1fr)_auto]">
          <PilotMascot size={76} />
          <div className="min-w-0">
            <p className="sp-accent text-[16px] text-[var(--sp-pink)]">Pilot đã xếp thử cho bạn</p>
            <h3 id="plan-preview-title" className="truncate text-[21px] font-extrabold text-[var(--sp-ink)]">
              Kế hoạch dự kiến · {subjectName}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="flex h-10 w-10 items-center justify-center rounded-xl border-2 border-[var(--sp-line)] bg-white text-[var(--sp-muted)] hover:border-[var(--sp-lav-line)]"
          >
            <IconX size={18} />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-2xl border-2 border-[var(--sp-purple-deep)] px-3 py-2.5"
              style={{ boxShadow: `3px 3px 0 ${stat.shadow}` }}
            >
              <p className="text-[24px] font-extrabold leading-tight text-[var(--sp-purple)]">{stat.value}</p>
              <p className="text-[12.5px] font-semibold text-[var(--sp-muted)]">{stat.label}</p>
            </div>
          ))}
        </div>

        <div className="mt-5">
          <p className="text-[14.5px] font-bold text-[var(--sp-ink)]">
            Phân bổ thời gian{" "}
            <span className="font-semibold text-[var(--sp-muted)]">· {isFocus ? "theo trọng tâm" : "theo chương"}</span>
          </p>
          {chapters.length === 0 ? (
            <p className="mt-2 rounded-2xl border-2 border-dashed border-[var(--sp-line)] px-4 py-4 text-[13px] text-[var(--sp-muted)]">
              {outline.status === "loading"
                ? "AI đang nhận diện chương, phân bổ sẽ hiện khi đọc xong."
                : "Chưa nhận diện trước được chương, AI sẽ chia khi tạo kế hoạch."}
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {chapters.map((chapter, index) => {
                const { code, title } = chapterLabel(chapter.name, index);
                const focused = isFocus && focus.has(index);
                const share = shares[index] || 0;
                return (
                  <li key={`${chapter.start_chunk}-${index}`} className="grid grid-cols-[minmax(0,220px)_minmax(0,1fr)_44px] items-center gap-3 text-[13px] font-semibold">
                    <span className="truncate text-[var(--sp-ink)]" title={chapter.name}>
                      {focused && "★ "}
                      <b>{code}</b> · {title}
                    </span>
                    <span className="h-3 overflow-hidden rounded-full border border-[var(--sp-line)] bg-[var(--sp-surface-2)]">
                      <span
                        className={`block h-full rounded-full transition-[width] duration-700 ease-out ${focused ? "bg-[var(--sp-pink)]" : "bg-[var(--sp-peri)]"}`}
                        style={{ width: grow ? `${Math.min(100, share)}%` : 0 }}
                      />
                    </span>
                    <span className="text-right font-bold text-[var(--sp-muted)]">{Math.round(share)}%</span>
                  </li>
                );
              })}
              {review > 0 && (
                <li className="grid grid-cols-[minmax(0,220px)_minmax(0,1fr)_44px] items-center gap-3 text-[13px] font-semibold">
                  <span className="text-[var(--sp-ink)]">Ôn tổng hợp · {reviewDayCount} ngày cuối</span>
                  <span className="h-3 overflow-hidden rounded-full border border-[var(--sp-line)] bg-[var(--sp-surface-2)]">
                    <span className="block h-full rounded-full bg-[var(--sp-purple)] transition-[width] duration-700 ease-out" style={{ width: grow ? `${review}%` : 0 }} />
                  </span>
                  <span className="text-right font-bold text-[var(--sp-muted)]">{Math.round(review)}%</span>
                </li>
              )}
            </ul>
          )}
        </div>

        {firstWeek.length > 0 && (
          <div className="mt-5">
            <p className="text-[14.5px] font-bold text-[var(--sp-ink)]">Tuần học đầu tiên</p>
            <div className="mt-2 grid grid-cols-7 gap-1.5">
              {firstWeek.map((key) => {
                const index = sorted.indexOf(key);
                return (
                  <div key={key} className="text-center text-[11.5px] font-extrabold text-[var(--sp-muted)]">
                    {WEEKDAY[new Date(`${key}T00:00:00Z`).getUTCDay()]} {key.slice(8, 10)}/{key.slice(5, 7)}
                    <p
                      className={`mt-1 flex h-[50px] items-center justify-center rounded-xl px-1 text-[12px] ${
                        index >= 0
                          ? "border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-peri)] text-white"
                          : "bg-[repeating-linear-gradient(135deg,#f1edf4_0_6px,#f8f6fa_6px_12px)] text-[var(--sp-soft)]"
                      }`}
                    >
                      {index >= 0 ? `Buổi ${index + 1}` : "Nghỉ"}
                    </p>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[12.5px] text-[var(--sp-muted)]">AI sẽ chia bài vào từng buổi khi tạo kế hoạch.</p>
          </div>
        )}

        <div className="mt-6 grid grid-cols-2 gap-3">
          <button type="button" onClick={onClose} className="sp-btn sp-btn-secondary h-[46px] text-sm !text-[var(--sp-peri-dark)]">
            ← Sửa lại
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={onConfirm}
            className="sp-btn sp-btn-primary h-[46px] text-sm !bg-[var(--sp-pink)] disabled:opacity-60"
          >
            <Sparkle size={15} />
            Tạo kế hoạch theo dự kiến
          </button>
        </div>
      </div>
    </div>
  );
}

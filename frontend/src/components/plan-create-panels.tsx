"use client";

import { IconCalendar, IconCheck, IconClock, IconFile, IconLayers, IconPen, IconTarget, Sparkle } from "@/components/icons";
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

/* ---------- Stepper góc phải ---------- */

export function CreateStepper({ steps }: { steps: CreateStep[] }) {
  const current = steps.findIndex((step) => !step.complete);
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2" aria-label="Các bước tạo kế hoạch">
      {steps.map((step, index) => {
        const isCurrent = index === current;
        return (
          <li key={step.title} className="flex items-center gap-1">
            <span
              className={`flex items-center gap-1.5 rounded-full py-1 pl-1 pr-3 text-[13px] font-bold transition ${
                step.complete
                  ? "bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]"
                  : isCurrent
                    ? "bg-[var(--sp-purple)] text-white shadow-[2px_2px_0_var(--sp-pink)]"
                    : "bg-white text-[var(--sp-muted)] ring-1 ring-[var(--sp-line)]"
              }`}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] ${
                  step.complete
                    ? "bg-[var(--sp-peri)] text-white"
                    : isCurrent
                      ? "bg-white text-[var(--sp-purple)]"
                      : "bg-[var(--sp-surface-2)]"
                }`}
              >
                {step.complete ? <IconCheck size={13} /> : index + 1}
              </span>
              {step.title}
            </span>
            {index < steps.length - 1 && (
              <span aria-hidden="true" className={`h-0.5 w-3 rounded ${step.complete ? "bg-[var(--sp-peri)]" : "bg-[var(--sp-line)]"}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- Thẻ chọn cách chia kế hoạch ---------- */

export function PlanModeCards({ mode, onChange }: { mode: PlanMode; onChange: (mode: PlanMode) => void }) {
  const options: { value: PlanMode; title: string; tag: string; text: string; icon: typeof IconLayers }[] = [
    {
      value: "chapter",
      title: "Theo chương",
      tag: "Tuyến tính",
      text: "Chia đều các chương theo ngày, học lần lượt từ chương đầu đến chương cuối.",
      icon: IconLayers,
    },
    {
      value: "focus",
      title: "Theo trọng tâm",
      tag: "Trọng số",
      text: "Dồn 70–80% thời gian cho chương trọng tâm, phần còn lại đọc lướt.",
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
            className={`relative flex gap-3 rounded-2xl border-2 p-4 text-left transition ${
              active
                ? option.value === "focus"
                  ? "border-[var(--sp-pink)] bg-[var(--sp-pink-bg)] shadow-[3px_3px_0_var(--sp-pink-line)]"
                  : "border-[var(--sp-peri)] bg-[var(--sp-lav)] shadow-[3px_3px_0_var(--sp-lav-line)]"
                : "border-[var(--sp-line)] bg-white hover:border-[var(--sp-lav-line)]"
            }`}
          >
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                option.value === "focus" ? "bg-white text-[var(--sp-pink-dark)]" : "bg-white text-[var(--sp-peri-dark)]"
              } ring-1 ring-[var(--sp-line)]`}
            >
              <Icon size={19} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-[15px] font-bold text-[var(--sp-ink)]">{option.title}</span>
                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-[var(--sp-muted)] ring-1 ring-[var(--sp-line)]">
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

/* ---------- Thẻ xem trước kế hoạch ---------- */

export function PlanPreviewCard({
  mode,
  onModeChange,
  daysToExam,
  studyDayCount,
  reviewDayCount,
  dailyHours,
  outline,
  focus,
}: {
  mode: PlanMode;
  onModeChange: (mode: PlanMode) => void;
  daysToExam: number | null;
  studyDayCount: number;
  reviewDayCount: number;
  dailyHours: number;
  outline: OutlineState;
  focus: Set<number>;
}) {
  const chapters = outline.status === "done" ? outline.chapters : [];
  const effectiveFocus = mode === "focus" ? focus : new Set<number>();
  const isFocus = mode === "focus" && focus.size > 0 && focus.size < chapters.length;
  const { shares, review } = chapterShares(chapters, mode, effectiveFocus, reviewDayCount > 0);
  const focusPct = isFocus ? shares.reduce((sum, share, index) => sum + (focus.has(index) ? share : 0), 0) : 0;
  const skimPct = isFocus ? 100 - focusPct - review : 0;
  const lessonCount = chapters.reduce((sum, chapter) => sum + chapter.lesson_count, 0);
  const focusCodes = chapters
    .map((chapter, index) => (focus.has(index) ? chapterLabel(chapter.name, index).code : null))
    .filter(Boolean)
    .join(", ");

  const stats = [
    { value: daysToExam ?? "—", label: "ngày đến thi", icon: IconCalendar, tone: "text-[var(--sp-pink-dark)] bg-[var(--sp-pink-bg)]" },
    { value: studyDayCount || "—", label: "ngày học", icon: IconPen, tone: "text-[var(--sp-peri-dark)] bg-[var(--sp-lav)]" },
    {
      value: lessonCount || "—",
      label: `bài · ${dailyHours} giờ/ngày`,
      icon: IconClock,
      tone: "text-[var(--sp-amber-dark)] bg-[var(--sp-amber-bg)]",
    },
  ];

  return (
    <aside className="sp-card overflow-hidden lg:sticky lg:top-6">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--sp-line)] px-5 py-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--sp-muted)]">
            Xem trước · {mode === "focus" ? "Theo trọng tâm" : "Theo chương"}
          </p>
          <h3 className="mt-0.5 text-lg font-bold text-[var(--sp-ink)]">Kế hoạch dự kiến</h3>
        </div>
        <div className="flex rounded-full bg-[var(--sp-surface-2)] p-1 text-[12px] font-bold" role="tablist">
          {(["chapter", "focus"] as PlanMode[]).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => onModeChange(value)}
              className={`rounded-full px-3 py-1.5 transition ${
                mode === value
                  ? value === "focus"
                    ? "bg-[var(--sp-pink)] text-white"
                    : "bg-[var(--sp-peri)] text-white"
                  : "text-[var(--sp-muted)] hover:text-[var(--sp-ink)]"
              }`}
            >
              {value === "focus" ? "Trọng tâm" : "Theo chương"}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-5 p-5">
        {/* Số liệu */}
        <div className="grid grid-cols-3 gap-2">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className="rounded-2xl border border-[var(--sp-line)] bg-white px-3 py-3">
                <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${stat.tone}`}>
                  <Icon size={15} />
                </span>
                <p className="mt-2 text-[24px] font-black leading-none text-[var(--sp-ink)]">{stat.value}</p>
                <p className="mt-1 text-[11px] font-semibold leading-4 text-[var(--sp-muted)]">{stat.label}</p>
              </div>
            );
          })}
        </div>

        {/* Phân bổ thời gian */}
        <div>
          <p className="text-sm font-bold text-[var(--sp-ink)]">Phân bổ thời gian ôn</p>
          {chapters.length === 0 ? (
            <div className="mt-3 rounded-2xl border-2 border-dashed border-[var(--sp-line)] px-4 py-6 text-center">
              <IconFile size={22} className="mx-auto text-[var(--sp-soft)]" />
              <p className="mt-2 text-[13px] text-[var(--sp-muted)]">
                {outline.status === "loading"
                  ? "AI đang nhận diện chương…"
                  : "Tải tài liệu lên để xem phân bổ thời gian theo từng chương."}
              </p>
            </div>
          ) : (
            <>
              {isFocus ? (
                <>
                  <div className="mt-3 flex h-4 overflow-hidden rounded-full bg-[var(--sp-surface-2)]">
                    <span className="h-full bg-[var(--sp-pink)]" style={{ width: `${focusPct}%` }} />
                    <span className="h-full bg-[var(--sp-peri)]" style={{ width: `${skimPct}%` }} />
                    {review > 0 && <span className="h-full bg-[var(--sp-purple)]" style={{ width: `${review}%` }} />}
                  </div>
                  <ul className="mt-2.5 space-y-1 text-[12px] text-[var(--sp-muted)]">
                    <li className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-[var(--sp-pink)]" />
                      <b className="text-[var(--sp-ink)]">{Math.round(focusPct)}%</b> {focusCodes}: học trước, nhiều thời gian hơn
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-[var(--sp-peri)]" />
                      <b className="text-[var(--sp-ink)]">{Math.round(skimPct)}%</b> {chapters.length - focus.size} chương đọc lướt
                    </li>
                    {review > 0 && (
                      <li className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-[var(--sp-purple)]" />
                        <b className="text-[var(--sp-ink)]">{Math.round(review)}%</b> Ôn tổng hợp ({reviewDayCount} ngày cuối)
                      </li>
                    )}
                  </ul>
                </>
              ) : (
                <p className="mt-1 text-[12px] text-[var(--sp-muted)]">
                  Chia đều theo độ dài từng chương, học lần lượt từ đầu đến cuối.
                </p>
              )}

              {/* Từng chương */}
              <ul className="mt-4 space-y-2.5">
                {chapters.map((chapter, index) => {
                  const { code, title } = chapterLabel(chapter.name, index);
                  const focused = isFocus && focus.has(index);
                  const share = shares[index] || 0;
                  return (
                    <li key={`${chapter.start_chunk}-${index}`} className="grid grid-cols-[38px_minmax(0,1fr)_40px] items-center gap-2">
                      <span
                        className={`rounded-md px-1 py-0.5 text-center text-[11px] font-extrabold ${
                          focused ? "bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]" : "bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]"
                        }`}
                      >
                        {code}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[12px] font-semibold text-[var(--sp-ink)]" title={chapter.name}>
                          {focused && "★ "}
                          {title}
                        </span>
                        <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-[var(--sp-surface-2)]">
                          <span
                            className={`block h-full rounded-full transition-all duration-500 ${
                              focused ? "bg-[var(--sp-pink)]" : "bg-[var(--sp-peri)]"
                            } ${isFocus && !focused ? "opacity-60" : ""}`}
                            style={{ width: `${Math.min(100, share * (isFocus ? 1.3 : 2))}%` }}
                          />
                        </span>
                      </span>
                      <span className="text-right text-[12px] font-bold text-[var(--sp-ink)]">{Math.round(share)}%</span>
                    </li>
                  );
                })}
                {isFocus && review > 0 && (
                  <li className="grid grid-cols-[38px_minmax(0,1fr)_40px] items-center gap-2">
                    <span className="rounded-md bg-[var(--sp-purple)] px-1 py-0.5 text-center text-[11px] font-extrabold text-white">
                      ÔN
                    </span>
                    <span className="text-[12px] font-semibold text-[var(--sp-ink)]">Ôn tổng hợp</span>
                    <span className="text-right text-[12px] font-bold text-[var(--sp-ink)]">{Math.round(review)}%</span>
                  </li>
                )}
              </ul>
            </>
          )}
        </div>
      </div>

      <p className="border-t border-[var(--sp-line)] bg-[var(--sp-surface-2)] px-5 py-3 text-[12px] leading-5 text-[var(--sp-muted)]">
        Sau khi tạo, bạn chuyển tới trang kế hoạch chi tiết với lịch từng ngày.
      </p>
    </aside>
  );
}

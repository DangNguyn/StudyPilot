"use client";

import { tx } from "@/lib/i18n";
/*
 * Lịch tháng của kế hoạch: ô ngày có góc màu khi có lịch, rê chuột (hoặc chạm,
 * hoặc Enter) để mở khung chi tiết gắn cạnh ô, giống bình luận trong bảng tính.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { IconChevronLeft, IconChevronRight, IconLock, IconX } from "@/components/icons";
import {
  buildMonth,
  monthKey,
  monthsBetween,
  type CalendarDay,
  type CalendarEntry,
  type CalendarResult,
} from "@/lib/study-calendar";

const WEEKDAYS = [tx("Thứ 2"), tx("Thứ 3"), tx("Thứ 4"), tx("Thứ 5"), tx("Thứ 6"), tx("Thứ 7"), "CN"];
const WEEKDAY_LONG = [tx("Thứ Hai"), tx("Thứ Ba"), tx("Thứ Tư"), tx("Thứ Năm"), tx("Thứ Sáu"), tx("Thứ Bảy"), tx("Chủ Nhật")];

const ACTION = {
  learn: { label: tx("Vào học"), className: "sp-btn-primary" },
  review: {
    label: tx("Vào ôn"),
    className:
      "border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-pink)] text-white shadow-[3px_3px_0_var(--sp-purple-deep)] hover:-translate-x-px hover:-translate-y-px hover:bg-[var(--sp-pink-dark)]",
  },
  revisit: { label: tx("Xem lại"), className: "sp-btn-secondary" },
} as const;

const BAR = {
  learn: "bg-[var(--sp-peri)]",
  review: "bg-[var(--sp-pink)]",
  exam: "bg-[var(--sp-purple-deep)]",
};

/* Màu dấu X theo kết quả ngày (L5) */
const STAMP: Record<CalendarResult, { bg: string; stroke: string; label: string }> = {
  passed: { bg: "#22c55e", stroke: "#065f46", label: tx("Đã xong · Đạt") },
  pending_review: { bg: "var(--sp-pink)", stroke: "var(--sp-purple-deep)", label: tx("Đã xong · còn buổi ôn") },
  needs_attention: { bg: "#f59e0b", stroke: "#7c2d12", label: tx("Đã xong · Cần chú ý") },
  final_required: { bg: "var(--sp-red)", stroke: "var(--sp-purple-deep)", label: tx("Cần làm bài tổng hợp") },
};

function DoneStamp({ small = false, result = null }: { small?: boolean; result?: CalendarResult | null }) {
  const tone = result ? STAMP[result] : null;
  return (
    <span
      title={tone?.label || tx("Đã xong")}
      className={`grid shrink-0 -rotate-12 place-items-center rounded-full border-2 border-[var(--sp-purple)] shadow-[2px_2px_0_var(--sp-purple-deep)] ${
        small ? "h-6 w-6" : "h-[34px] w-[34px]"
      }`}
      style={{ background: tone?.bg || "var(--sp-yellow)" }}
    >
      <svg viewBox="0 0 16 16" className={small ? "h-3 w-3" : "h-4 w-4"} aria-hidden>
        <path d="M3 3l10 10M13 3L3 13" stroke={tone?.stroke || "var(--sp-purple)"} strokeWidth="3" strokeLinecap="round" />
      </svg>
      <span className="sr-only">{tone?.label || tx("Đã xong")}</span>
    </span>
  );
}

/* Chú giải màu dưới lịch: mỗi ý một dòng ngang hàng */
function CalendarLegend() {
  const items: CalendarResult[] = ["passed", "pending_review", "needs_attention", "final_required"];
  return (
    <ul className="mt-4 grid grid-cols-1 gap-2 text-[12.5px] font-semibold text-[var(--sp-text-2)] sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <li key={item} className="flex items-center gap-2">
          <DoneStamp small result={item} />
          <span>{STAMP[item].label}</span>
        </li>
      ))}
    </ul>
  );
}

function cornerColor(day: CalendarDay) {
  if (day.isExam) return "var(--sp-purple-deep)";
  if (day.hasLate) return "var(--sp-red)";
  if (day.entries.some((entry) => entry.kind === "review")) return "var(--sp-pink)";
  return "var(--sp-peri)";
}

export default function StudyCalendar({
  entries,
  todayKey,
  firstKey,
  lastKey,
}: {
  entries: CalendarEntry[];
  todayKey: string;
  firstKey: string;
  lastKey: string;
}) {
  const months = useMemo(() => monthsBetween(firstKey, lastKey), [firstKey, lastKey]);
  const [monthIndex, setMonthIndex] = useState(() =>
    Math.max(0, months.indexOf(monthKey(todayKey)))
  );
  const month = months[Math.min(monthIndex, months.length - 1)] || monthKey(todayKey);
  const weeks = useMemo(() => buildMonth(month, entries, todayKey), [month, entries, todayKey]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const learnDays = new Set(entries.filter((e) => e.kind === "learn").map((e) => e.dateKey)).size;
  const reviewCount = entries.filter((e) => e.kind === "review").length;
  const exam = entries.find((e) => e.kind === "exam");
  const [year, monthNumber] = month.split("-").map(Number);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpenKey(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const open = (key: string) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setOpenKey(key);
  };
  const closeSoon = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setOpenKey(null), 180);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="sp-accent text-[17px] text-[var(--sp-pink)]">
            {tx("{0} ngày học · {1} buổi ôn{2}", [learnDays, reviewCount, exam ? ` · thi ${exam.dateKey.slice(8, 10)}/${exam.dateKey.slice(5, 7)}` : ""])}
          </p>
          <h3 className="text-[28px] font-extrabold text-[var(--sp-ink)]">
            {tx("Tháng {0}, {1}", [monthNumber, year])}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={tx("Tháng trước")}
            disabled={monthIndex <= 0}
            onClick={() => setMonthIndex((value) => value - 1)}
            className="sp-btn sp-btn-secondary h-10 w-10 p-0"
          >
            <IconChevronLeft size={18} />
          </button>
          <button
            type="button"
            onClick={() => setMonthIndex(Math.max(0, months.indexOf(monthKey(todayKey))))}
            className="sp-btn sp-btn-secondary h-10 px-4 text-sm"
          >

            {tx("Hôm nay")}
          </button>
          <button
            type="button"
            aria-label={tx("Tháng sau")}
            disabled={monthIndex >= months.length - 1}
            onClick={() => setMonthIndex((value) => value + 1)}
            className="sp-btn sp-btn-secondary h-10 w-10 p-0"
          >
            <IconChevronRight size={18} />
          </button>
        </div>
      </div>

      <ul className="mb-5 flex flex-wrap gap-2 text-[12.5px] font-bold">
        <li className="sp-chip bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]">{tx("● Học mới")}</li>
        <li className="sp-chip bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]">{tx("● Ôn lại")}</li>
        <li className="sp-chip bg-[var(--sp-red-bg)] text-[var(--sp-red-dark)]">{tx("● Trễ lịch ôn")}</li>
        <li className="sp-chip bg-[var(--sp-yellow)] text-[var(--sp-purple-deep)]">{tx("⚑ Ngày thi")}</li>
        <li className="sp-chip border-2 border-[var(--sp-purple)] bg-white text-[var(--sp-purple)]">{tx("✕ Đã xong")}</li>
        <li className="sp-chip bg-[var(--sp-red)] text-white">{tx("Hôm nay")}</li>
      </ul>

      <div className="grid grid-cols-7 gap-1.5 sm:gap-2.5" role="grid" aria-label={tx("Lịch tháng {0}", [monthNumber])}>
        {WEEKDAYS.map((label, index) => (
          <div
            key={label}
            className={`pb-0.5 text-center text-[11px] font-extrabold uppercase tracking-[0.08em] sm:text-xs ${
              index > 4 ? "text-[var(--sp-pink)]" : "text-[var(--sp-muted)]"
            }`}
          >
            {label}
          </div>
        ))}

        {weeks.flat().map((day, index) =>
          day ? (
            <DayCell
              key={day.dateKey}
              day={day}
              isOpen={openKey === day.dateKey}
              onOpen={() => open(day.dateKey)}
              onLeave={closeSoon}
              onClose={() => setOpenKey(null)}
            />
          ) : (
            <div
              key={`empty-${index}`}
              aria-hidden
              className="min-h-[60px] rounded-xl border-2 border-dashed border-[var(--sp-line)] sm:min-h-[112px] sm:rounded-[18px]"
            />
          )
        )}
      </div>
      <CalendarLegend />
    </div>
  );
}

function DayCell({
  day,
  isOpen,
  onOpen,
  onLeave,
  onClose,
}: {
  day: CalendarDay;
  isOpen: boolean;
  onOpen: () => void;
  onLeave: () => void;
  onClose: () => void;
}) {
  const has = day.entries.length > 0;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState(day.column >= 4);
  useLayoutEffect(() => {
    if (!isOpen || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    setFlip(rect.right + 14 + 380 > window.innerWidth - 8);
  }, [isOpen]);
  const learn = day.entries.filter((entry) => entry.kind === "learn").length;
  const review = day.entries.filter((entry) => entry.kind === "review").length;

  const tone = day.isToday
    ? "border-[var(--sp-red)] bg-[var(--sp-red-bg)] shadow-[4px_4px_0_var(--sp-red-line)]"
    : day.isExam
      ? "border-[var(--sp-purple-deep)] bg-[var(--sp-yellow)]"
      : day.isPast && !has
        ? "border-[var(--sp-line)] bg-[var(--sp-surface-2)]"
        : "border-[var(--sp-line)] bg-white";

  return (
    <div
      ref={wrapRef}
      className={`relative ${isOpen ? "z-30" : "z-0"}`}
      onMouseEnter={has ? onOpen : undefined}
      onMouseLeave={has ? onLeave : undefined}
    >
      <div
        role={has ? "button" : undefined}
        tabIndex={has ? 0 : undefined}
        aria-expanded={has ? isOpen : undefined}
        aria-label={`${WEEKDAY_LONG[day.column]} ${day.day}${has ? tx(", xem chi tiết") : ""}`}
        onClick={has ? onOpen : undefined}
        onFocus={has ? onOpen : undefined}
        onKeyDown={(event) => {
          if (has && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            onOpen();
          }
        }}
        className={`relative flex min-h-[60px] flex-col gap-1 overflow-hidden rounded-xl border-2 p-1.5 transition sm:min-h-[112px] sm:rounded-[18px] sm:p-2.5 ${tone} ${
          has
            ? `cursor-pointer outline-none hover:-translate-x-0.5 hover:-translate-y-0.5 hover:border-[var(--sp-purple)] hover:shadow-[5px_5px_0_var(--sp-purple-deep)] focus-visible:border-[var(--sp-purple)] focus-visible:shadow-[5px_5px_0_var(--sp-purple-deep)] ${
                isOpen ? "-translate-x-0.5 -translate-y-0.5 border-[var(--sp-purple)] shadow-[5px_5px_0_var(--sp-purple-deep)]" : ""
              }`
            : ""
        }`}
      >
        {has && (
          <span
            aria-hidden
            className="absolute right-0 top-0 h-0 w-0 border-l-[14px] border-t-[14px] border-l-transparent sm:border-l-[16px] sm:border-t-[16px]"
            style={{ borderTopColor: cornerColor(day) }}
          />
        )}
        <div className="flex items-center justify-between gap-1 pr-3">
          <span
            className={`font-[family-name:var(--font-sp-display)] text-[17px] leading-none sm:text-2xl ${
              day.isToday
                ? "text-[var(--sp-red-dark)]"
                : day.isPast && !has
                  ? "text-[var(--sp-soft)]"
                  : "text-[var(--sp-purple)]"
            }`}
          >
            {day.day}
          </span>
          {day.isToday && (
            <span className="hidden whitespace-nowrap rounded-full bg-[var(--sp-red)] px-2 py-0.5 text-[10.5px] font-extrabold text-white lg:inline">

              {tx("Hôm nay")}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-1 sm:flex-col">
          {learn > 0 && (
            <Tag className="bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]" dot="bg-[var(--sp-peri)]">
              {tx("{0} bài học", [learn])}</Tag>
          )}
          {review > 0 && (
            <Tag
              className={day.hasLate ? "bg-[var(--sp-red-bg)] text-[var(--sp-red-dark)]" : "bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]"}
              dot={day.hasLate ? "bg-[var(--sp-red)]" : "bg-[var(--sp-pink)]"}
            >
              {review}  {tx("buổi ôn")}{day.hasLate ? tx(" · trễ") : ""}
            </Tag>
          )}
          {day.finalRequired && (
            <Tag className="bg-[var(--sp-red)] text-white" dot="bg-white">
              {tx("Bài tổng hợp")}
            </Tag>
          )}
          {day.missed && (
            <Tag className="bg-[var(--sp-amber-bg)] text-[var(--sp-amber-dark)]" dot="bg-[var(--sp-amber-dark)]">

              {tx("Chưa học")}
            </Tag>
          )}
          {day.isExam && (
            <Tag className="bg-white text-[var(--sp-purple-deep)]" dot="bg-[var(--sp-purple-deep)]">

              {tx("⚑ Ngày thi")}
            </Tag>
          )}
        </div>

        {day.done && (
          <span className="absolute bottom-1 right-1 sm:bottom-2 sm:right-2">
            <span className="sm:hidden"><DoneStamp small result={day.result} /></span>
            <span className="hidden sm:inline"><DoneStamp result={day.result} /></span>
          </span>
        )}
      </div>

      {isOpen && <DayPopover day={day} flip={flip} onClose={onClose} />}
    </div>
  );
}

function Tag({ children, className, dot }: { children: React.ReactNode; className: string; dot: string }) {
  return (
    <>
      {/* Điện thoại: chỉ hiện chấm màu cho gọn */}
      <span aria-hidden className={`h-2 w-2 rounded-full sm:hidden ${dot}`} />
      <span className={`hidden max-w-full items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-[11.5px] font-bold sm:flex ${className}`}>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        <span className="truncate whitespace-nowrap">{children}</span>
      </span>
    </>
  );
}

function DayPopover({ day, flip, onClose }: { day: CalendarDay; flip: boolean; onClose: () => void }) {
  const title = day.isExam
    ? tx("Ngày thi")
    : day.done
      ? tx("Đã hoàn thành")
      : day.isPast
        ? tx("Chưa hoàn thành")
        : tx("Lịch trong ngày");

  return (
    <div
      role="dialog"
      aria-label={tx("Chi tiết {0} {1}", [WEEKDAY_LONG[day.column], day.day])}
      className={`sp-task-expand max-sm:fixed max-sm:inset-x-3 max-sm:bottom-3 max-sm:z-50 sm:absolute sm:top-[-8px] sm:w-[380px] ${
        flip ? "sm:right-[calc(100%+14px)]" : "sm:left-[calc(100%+14px)]"
      } rounded-[20px] border-2 border-[var(--sp-purple)] bg-white p-4 shadow-[6px_6px_0_var(--sp-purple-deep)]`}
    >
      <span
        aria-hidden
        className={`absolute top-[22px] hidden h-3.5 w-3.5 rotate-45 border-2 border-[var(--sp-purple)] bg-white sm:block ${
          flip ? "-right-[9px] border-b-0 border-l-0" : "-left-[9px] border-r-0 border-t-0"
        }`}
      />
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <p className={`sp-accent ${day.isToday ? "text-[var(--sp-red)]" : "text-[var(--sp-pink)]"}`}>
            {day.isToday ? tx("Hôm nay · ") : ""}
            {WEEKDAY_LONG[day.column]}, {day.dateKey.slice(8, 10)}/{day.dateKey.slice(5, 7)}
          </p>
          <p className="text-lg font-extrabold text-[var(--sp-ink)]">{title}</p>
        </div>
        <div className="flex items-center gap-2">
          {day.done && (
            <span className="sp-chip border-2 border-[var(--sp-purple)] bg-white text-[var(--sp-purple)]">{tx("✕ Đã xong")}</span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={tx("Đóng")}
            className="rounded-lg p-1 text-[var(--sp-muted)] hover:bg-[var(--sp-surface-2)] sm:hidden"
          >
            <IconX size={18} />
          </button>
        </div>
      </div>

      <ul className="max-h-[60vh] overflow-y-auto">
        {day.entries.map((entry) => (
          <EntryRow key={entry.key} entry={entry} />
        ))}
      </ul>
    </div>
  );
}

function EntryRow({ entry }: { entry: CalendarEntry }) {
  const action = entry.action ? ACTION[entry.action.kind] : null;
  return (
    <li className="grid grid-cols-[4px_minmax(0,1fr)_92px] items-center gap-3 border-t-2 border-dashed border-[var(--sp-line)] py-2.5">
      <span className={`self-stretch rounded ${entry.late ? "bg-[var(--sp-red)]" : BAR[entry.kind]}`} />
      <div className="min-w-0">
        <p className="text-[13.5px] font-bold leading-snug text-[var(--sp-ink)]">
          {entry.kind === "review" ? tx("Ôn lại: ") : ""}
          {entry.title}
        </p>
        {entry.lines.map((line, index) => (
          <p
            key={index}
            className={`text-xs leading-relaxed ${
              line.tone === "weak"
                ? "font-bold text-[var(--sp-red-dark)]"
                : line.tone === "mid"
                  ? "font-bold text-[var(--sp-amber-dark)]"
                  : "text-[var(--sp-muted)]"
            }`}
          >
            {line.text}
          </p>
        ))}
      </div>
      {entry.action && action ? (
        entry.action.locked ? (
          <span className="sp-btn sp-btn-secondary w-[92px] cursor-not-allowed px-0 py-2 text-[12.5px] text-[var(--sp-soft)]" title={entry.action.lockReason || tx("Nộp bài kiểm tra của các ngày trước để mở")}>
            <IconLock size={13} />

            {tx("Khóa")}
          </span>
        ) : (
          <Link href={entry.action.href} className={`sp-btn ${action.className} w-[92px] px-0 py-2 text-[12.5px]`}>
            {action.label}
          </Link>
        )
      ) : (
        <span />
      )}
    </li>
  );
}

"use client";

import {
  IconCalendar,
  IconCheck,
  IconFlag,
  IconX,
  Sparkle,
} from "@/components/icons";

export type PickerWeek = {
  weekNumber: number;
  dates: string[];
};

type StudyDayPickerProps = {
  weeks: PickerWeek[];
  selectedDates: string[];
  studyDaysPerWeek: number;
  today: string;
  examDate: string;
  confirmed: boolean;
  expanded: boolean;
  onToggleDate: (weekDates: string[], date: string) => void;
  onToggleWeekday: (columnIndex: number) => void;
  onClear: () => void;
  onConfirm: () => void;
  onHeaderAction: () => void;
};

const SHORT_WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const LONG_WEEKDAYS = [
  "Chủ nhật",
  "Thứ 2",
  "Thứ 3",
  "Thứ 4",
  "Thứ 5",
  "Thứ 6",
  "Thứ 7",
];

function toDate(dateKey: string) {
  return new Date(`${dateKey}T00:00:00`);
}

function addDays(dateKey: string, days: number) {
  const date = toDate(dateKey);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayMonth(dateKey: string) {
  const [, month, day] = dateKey.split("-");
  return `${day}/${month}`;
}

function weekdayIndex(dateKey: string) {
  return toDate(dateKey).getDay();
}

export default function StudyDayPicker({
  weeks,
  selectedDates,
  studyDaysPerWeek,
  today,
  examDate,
  confirmed,
  expanded,
  onToggleDate,
  onToggleWeekday,
  onClear,
  onConfirm,
  onHeaderAction,
}: StudyDayPickerProps) {
  const firstWeek = weeks[0];
  const columns = firstWeek
    ? Array.from({ length: 7 }, (_, index) => addDays(firstWeek.dates[0], index))
    : [];

  const requiredFor = (week: PickerWeek) =>
    Math.min(studyDaysPerWeek, week.dates.length);
  const selectedIn = (week: PickerWeek) =>
    week.dates.filter((date) => selectedDates.includes(date)).length;

  const totalRequired = weeks.reduce((sum, week) => sum + requiredFor(week), 0);
  const totalSelected = weeks.reduce((sum, week) => sum + selectedIn(week), 0);
  const percent = totalRequired
    ? Math.round((totalSelected / totalRequired) * 100)
    : 0;
  const isComplete = totalRequired > 0 && totalSelected === totalRequired;

  /* Thứ được chọn ở mọi tuần (dùng cho nút chọn nhanh và phần tóm tắt) */
  const columnState = columns.map((_, columnIndex) => {
    const columnDates = weeks
      .map((week) => week.dates[columnIndex])
      .filter((date): date is string => Boolean(date));
    return (
      columnDates.length > 0 &&
      columnDates.every((date) => selectedDates.includes(date))
    );
  });

  const pattern = columns
    .filter((_, index) => columnState[index])
    .map((date) => SHORT_WEEKDAYS[weekdayIndex(date)]);
  const isUniformPattern =
    pattern.length > 0 &&
    weeks.every(
      (week) =>
        selectedIn(week) ===
        columns.filter(
          (_, index) => columnState[index] && week.dates[index]
        ).length
    );

  return (
    <div className="rounded-[22px] border-2 border-[var(--sp-purple)] bg-white p-5 shadow-[6px_6px_0_var(--sp-lav-line)] sm:p-6">
      {/* Tiêu đề */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]">
            <IconCalendar size={22} />
            <Sparkle
              size={12}
              className="sp-twinkle absolute -right-1.5 -top-1.5 text-[var(--sp-pink)]"
            />
          </span>
          <div>
            <p className="sp-accent text-[15px] leading-tight text-[var(--sp-pink)]">
              {studyDaysPerWeek} ngày mỗi tuần
            </p>
            <h3 className="text-lg text-[var(--sp-ink)]">
              Chọn ngày học của bạn
            </h3>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="min-w-[150px]">
            <p className="text-right text-sm font-bold text-[var(--sp-ink)]">
              {totalSelected}/{totalRequired} ngày
            </p>
            <div
              className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--sp-surface-2)]"
              role="progressbar"
              aria-label="Số ngày học đã chọn"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  isComplete ? "bg-[var(--sp-peri)]" : "bg-[var(--sp-yellow)]"
                }`}
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={onHeaderAction}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--sp-line)] text-[var(--sp-muted)] transition hover:bg-[var(--sp-surface-2)] hover:text-[var(--sp-ink)]"
            aria-label={
              confirmed
                ? expanded
                  ? "Thu gọn bảng chọn ngày học"
                  : "Mở bảng chọn ngày học"
                : "Đóng bảng chọn ngày học"
            }
          >
            {confirmed ? (
              <span
                className={`text-base transition ${expanded ? "rotate-180" : ""}`}
                aria-hidden="true"
              >
                ⌄
              </span>
            ) : (
              <IconX size={18} />
            )}
          </button>
        </div>
      </div>

      {/* Tóm tắt khi đã xác nhận và thu gọn */}
      {confirmed && !expanded && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl bg-[var(--sp-lav)] px-4 py-3 text-sm text-[var(--sp-ink)]">
          <IconCheck size={16} className="text-[var(--sp-peri-dark)]" />
          <span className="font-semibold">Đã lưu lịch học:</span>
          {isUniformPattern ? (
            <>
              {pattern.map((label) => (
                <span
                  key={label}
                  className="sp-chip bg-[var(--sp-peri)] text-white"
                >
                  {label}
                </span>
              ))}
              <span className="text-[var(--sp-muted)]">mỗi tuần</span>
            </>
          ) : (
            <span>
              {totalSelected} ngày trong {weeks.length} tuần
            </span>
          )}
        </div>
      )}

      {expanded && (
        <>
          {!examDate ? (
            <p className="mt-5 rounded-2xl bg-[var(--sp-surface-2)] p-4 text-sm text-[var(--sp-muted)]">
              Chọn ngày thi trước để StudyPilot hiển thị các tuần ôn tập.
            </p>
          ) : weeks.length === 0 ? (
            <p className="mt-5 rounded-2xl bg-[var(--sp-pink-bg)] p-4 text-sm text-[var(--sp-pink-dark)]">
              Ngày thi phải sau hôm nay để tạo lịch học.
            </p>
          ) : (
            <>
              {/* Chọn nhanh */}
              <div className="mt-5 rounded-2xl bg-[var(--sp-surface-2)] p-4">
                <p className="mb-2.5 text-sm font-semibold text-[var(--sp-text-2)]">
                  Chọn nhanh cho mọi tuần
                  <span className="ml-1 font-normal text-[var(--sp-muted)]">
                    · bấm vào thứ bạn muốn học
                  </span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {columns.map((date, columnIndex) => {
                    const active = columnState[columnIndex];
                    return (
                      <button
                        key={date}
                        type="button"
                        aria-pressed={active}
                        title={`${LONG_WEEKDAYS[weekdayIndex(date)]} mọi tuần`}
                        onClick={() => onToggleWeekday(columnIndex)}
                        className={`h-10 min-w-[52px] rounded-full border-2 px-3 text-sm font-bold transition ${
                          active
                            ? "border-[var(--sp-purple-deep)] bg-[var(--sp-peri)] text-white shadow-[2px_2px_0_var(--sp-purple-deep)]"
                            : "border-[var(--sp-line)] bg-white text-[var(--sp-text-2)] hover:border-[var(--sp-lav-line)] hover:text-[var(--sp-peri-dark)]"
                        }`}
                      >
                        {SHORT_WEEKDAYS[weekdayIndex(date)]}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Lưới lịch */}
              <div className="mt-5">
                <div>
                  <div className="mb-2 grid grid-cols-7 gap-1 px-1.5 sm:grid-cols-[96px_repeat(7,minmax(0,1fr))_64px] sm:gap-2">
                    <span className="hidden sm:block" />
                    {columns.map((date) => (
                      <span
                        key={date}
                        className={`text-center text-xs font-bold uppercase tracking-wide ${
                          weekdayIndex(date) === 0
                            ? "text-[var(--sp-pink)]"
                            : "text-[var(--sp-muted)]"
                        }`}
                      >
                        {SHORT_WEEKDAYS[weekdayIndex(date)]}
                      </span>
                    ))}
                    <span className="hidden sm:block" />
                  </div>

                  <div className="space-y-2">
                    {weeks.map((week) => {
                      const required = requiredFor(week);
                      const count = selectedIn(week);
                      const full = count >= required;
                      const lastDate = week.dates[week.dates.length - 1];

                      return (
                        <div
                          key={week.weekNumber}
                          className={`rounded-2xl p-1.5 transition ${
                            full
                              ? "bg-[var(--sp-lav)]/60"
                              : "bg-transparent"
                          }`}
                        >
                          {/* Tiêu đề tuần trên điện thoại */}
                          <div className="mb-1.5 flex items-center justify-between px-1 sm:hidden">
                            <p className="text-sm font-bold text-[var(--sp-purple)]">
                              Tuần {week.weekNumber}
                              <span className="ml-1.5 text-xs font-medium text-[var(--sp-muted)]">
                                {dayMonth(week.dates[0])}–{dayMonth(lastDate)}
                              </span>
                            </p>
                            <span
                              className={`sp-chip ${
                                full
                                  ? "bg-[var(--sp-peri)] text-white"
                                  : "bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]"
                              }`}
                            >
                              {full && <IconCheck size={12} strokeWidth={3} />}
                              {count}/{required}
                            </span>
                          </div>

                          <div className="grid grid-cols-7 items-center gap-1 sm:grid-cols-[96px_repeat(7,minmax(0,1fr))_64px] sm:gap-2">
                          <div className="hidden pl-1.5 sm:block">
                            <p className="text-sm font-bold text-[var(--sp-purple)]">
                              Tuần {week.weekNumber}
                            </p>
                            <p className="text-[11px] text-[var(--sp-muted)]">
                              {dayMonth(week.dates[0])}–{dayMonth(lastDate)}
                            </p>
                          </div>

                          {columns.map((_, columnIndex) => {
                            const date = week.dates[columnIndex];

                            if (!date) {
                              const filler = addDays(week.dates[0], columnIndex);
                              if (filler === examDate) {
                                return (
                                  <div
                                    key={`exam-${columnIndex}`}
                                    className="flex h-12 flex-col items-center justify-center rounded-xl bg-[var(--sp-purple)] text-[var(--sp-yellow)] sm:h-16"
                                    title="Ngày thi"
                                  >
                                    <IconFlag size={18} />
                                    <span className="text-[11px] font-bold text-white">
                                      Thi
                                    </span>
                                  </div>
                                );
                              }
                              return (
                                <div
                                  key={`empty-${columnIndex}`}
                                  className="h-12 rounded-xl border-2 border-dashed border-[var(--sp-line)] sm:h-16"
                                  aria-hidden="true"
                                />
                              );
                            }

                            const isSelected = selectedDates.includes(date);
                            const isToday = date === today;
                            const isDimmed = full && !isSelected;
                            const [, month, day] = date.split("-");

                            return (
                              <button
                                key={date}
                                type="button"
                                aria-pressed={isSelected}
                                aria-label={`${LONG_WEEKDAYS[weekdayIndex(date)]} ${dayMonth(date)}${isToday ? ", hôm nay" : ""}`}
                                onClick={() => onToggleDate(week.dates, date)}
                                className={`group relative flex h-12 flex-col items-center justify-center rounded-xl border-2 transition sm:h-16 ${
                                  isSelected
                                    ? "border-[var(--sp-purple-deep)] bg-[var(--sp-peri)] text-white shadow-[2px_2px_0_var(--sp-purple-deep)]"
                                    : isDimmed
                                      ? "border-transparent bg-[var(--sp-surface-2)] text-[var(--sp-soft)] hover:text-[var(--sp-muted)]"
                                      : "border-[var(--sp-line)] bg-white text-[var(--sp-ink)] hover:-translate-y-0.5 hover:border-[var(--sp-peri)] hover:shadow-[0_4px_0_var(--sp-lav-line)]"
                                }`}
                              >
                                {isSelected && (
                                  <span className="absolute right-1 top-1 hidden h-4 w-4 sm:flex items-center justify-center rounded-full bg-white text-[var(--sp-peri-dark)]">
                                    <IconCheck size={11} strokeWidth={3} />
                                  </span>
                                )}
                                <span className="text-base font-extrabold leading-none sm:text-xl">
                                  {Number(day)}
                                </span>
                                <span
                                  className={`mt-0.5 hidden text-[10.5px] font-medium sm:block ${
                                    isSelected
                                      ? "text-white/80"
                                      : "text-[var(--sp-muted)]"
                                  }`}
                                >
                                  th{Number(month)}
                                </span>
                                {isToday && (
                                  <span
                                    className={`absolute bottom-1 h-1.5 w-1.5 rounded-full ${
                                      isSelected ? "bg-white" : "bg-[var(--sp-pink)]"
                                    }`}
                                  />
                                )}
                              </button>
                            );
                          })}

                          <span
                            className={`sp-chip hidden justify-center px-1 sm:inline-flex ${
                              full
                                ? "bg-[var(--sp-peri)] text-white"
                                : "bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]"
                            }`}
                          >
                            {full && <IconCheck size={12} strokeWidth={3} />}
                            {count}/{required}
                          </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Chú thích */}
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--sp-muted)]">
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-peri)]" />
                  Ngày học
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--sp-pink)]" />
                  Hôm nay
                </span>
                <span className="flex items-center gap-1.5">
                  <IconFlag size={13} className="text-[var(--sp-purple)]" />
                  Ngày thi (không tính vào lịch)
                </span>
              </div>
            </>
          )}

          {/* Hành động */}
          <div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t border-[var(--sp-line)] pt-4">
            {totalSelected > 0 && (
              <button
                type="button"
                onClick={onClear}
                className="sp-btn sp-btn-secondary px-4 py-2.5 text-sm"
              >
                Xoá lựa chọn
              </button>
            )}
            <button
              type="button"
              onClick={onConfirm}
              className="sp-btn sp-btn-primary px-5 py-2.5 text-sm"
            >
              <IconCheck size={16} />
              Xác nhận ngày học
            </button>
          </div>
        </>
      )}
    </div>
  );
}

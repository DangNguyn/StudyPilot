/*
 * Dữ liệu cho lịch tháng của trang Kế hoạch. Ngày dạng "YYYY-MM-DD".
 */

export type CalendarKind = "learn" | "review" | "exam";
/* Kết quả của buổi trên lịch (L5): xanh / hồng (còn buổi ôn) / vàng (cần chú ý) / chờ bài tổng hợp */
export type CalendarResult = "passed" | "pending_review" | "needs_attention" | "final_required";
export type CalendarAction = "learn" | "review" | "revisit";

export type CalendarEntry = {
  key: string;
  kind: CalendarKind;
  dateKey: string;
  title: string;
  done: boolean;
  /* Buổi ôn đã qua ngày mà chưa làm */
  late?: boolean;
  result?: CalendarResult;
  /* Mỗi phần tử là một dòng thông tin phụ */
  lines: { text: string; tone?: "weak" | "mid" }[];
  action?: { kind: CalendarAction; href: string; locked?: boolean; lockReason?: string | null };
};

export type CalendarDay = {
  dateKey: string;
  day: number;
  /* 0 = Thứ Hai ... 6 = Chủ nhật */
  column: number;
  entries: CalendarEntry[];
  done: boolean;
  isToday: boolean;
  isPast: boolean;
  isExam: boolean;
  hasLate: boolean;
  /* Ngày đã qua còn buổi học chưa làm */
  missed: boolean;
  /* Màu dấu X của ngày đã xong (ưu tiên: chờ tổng hợp > còn buổi ôn > cần chú ý > đạt) */
  result: CalendarResult | null;
  /* Có buổi đang chờ bài tổng hợp 20 câu */
  finalRequired: boolean;
};

const RESULT_RANK: Record<CalendarResult, number> = {
  final_required: 0,
  pending_review: 1,
  needs_attention: 2,
  passed: 3,
};

export function dayResult(entries: CalendarEntry[]): CalendarResult | null {
  const results = entries.filter((entry) => entry.kind !== "exam" && entry.result).map((entry) => entry.result!);
  if (!results.length) return null;
  return results.sort((a, b) => RESULT_RANK[a] - RESULT_RANK[b])[0];
}

const pad = (value: number) => String(value).padStart(2, "0");

export function monthKey(dateKey: string) {
  return dateKey.slice(0, 7);
}

/* Các tháng từ tháng đầu tiên đến tháng cuối cùng có trong danh sách ngày */
export function monthsBetween(firstKey: string, lastKey: string) {
  const months: string[] = [];
  let [y, m] = firstKey.split("-").map(Number);
  const [ly, lm] = lastKey.split("-").map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    months.push(`${y}-${pad(m)}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

/* Lưới một tháng: các tuần bắt đầu từ Thứ Hai, ô ngoài tháng là null */
export function buildMonth(
  month: string,
  entries: CalendarEntry[],
  todayKey: string
): (CalendarDay | null)[][] {
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstColumn = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const byDate = new Map<string, CalendarEntry[]>();
  // Trong một ngày: học mới trước, rồi ôn lại, cuối cùng là ngày thi
  const order = { learn: 0, review: 1, exam: 2 };
  for (const entry of [...entries].sort((a, b) => order[a.kind] - order[b.kind])) {
    byDate.set(entry.dateKey, [...(byDate.get(entry.dateKey) || []), entry]);
  }

  const cells: (CalendarDay | null)[] = Array(firstColumn).fill(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = `${month}-${pad(day)}`;
    const dayEntries = byDate.get(dateKey) || [];
    const work = dayEntries.filter((entry) => entry.kind !== "exam");
    cells.push({
      dateKey,
      day,
      column: (firstColumn + day - 1) % 7,
      entries: dayEntries,
      done: work.length > 0 && work.every((entry) => entry.done),
      isToday: dateKey === todayKey,
      isPast: dateKey < todayKey,
      isExam: dayEntries.some((entry) => entry.kind === "exam"),
      hasLate: work.some((entry) => entry.late),
      missed:
        dateKey < todayKey &&
        work.some((entry) => entry.kind === "learn" && !entry.done),
      result: dayResult(work),
      finalRequired: work.some((entry) => entry.result === "final_required"),
    });
  }
  while (cells.length % 7) cells.push(null);

  const weeks: (CalendarDay | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  return weeks;
}

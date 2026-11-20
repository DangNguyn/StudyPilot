/*
 * Dữ liệu cho lịch tháng của trang Kế hoạch. Ngày dạng "YYYY-MM-DD".
 */

export type CalendarKind = "learn" | "review" | "exam";
export type CalendarAction = "learn" | "review" | "revisit";

export type CalendarEntry = {
  key: string;
  kind: CalendarKind;
  dateKey: string;
  title: string;
  done: boolean;
  /* Buổi ôn đã qua ngày mà chưa làm */
  late?: boolean;
  /* Mỗi phần tử là một dòng thông tin phụ */
  lines: { text: string; tone?: "weak" | "mid" }[];
  action?: { kind: CalendarAction; href: string; locked?: boolean };
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
};

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
    });
  }
  while (cells.length % 7) cells.push(null);

  const weeks: (CalendarDay | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  return weeks;
}

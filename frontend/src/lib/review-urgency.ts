/*
 * Mức ưu tiên của một phần kiến thức cần ôn lại (bài kiểm tra dưới 80%).
 * Ngày dạng "YYYY-MM-DD" theo giờ Việt Nam.
 */

export type ReviewLevel = "urgent" | "unscheduled" | "due" | "scheduled";

export type ReviewUrgency = {
  level: ReviewLevel;
  /* Chưa chọn lịch từ 4–7 ngày: nhấn mạnh hơn nhưng chưa tới mức khẩn */
  strong: boolean;
  /* Số ngày kể từ khi làm bài kiểm tra */
  ageDays: number;
  label: string;
  /* Dùng để xếp: số nhỏ ưu tiên trước */
  rank: number;
};

/* Các mốc do chủ dự án duyệt ngày 20/11/2026 */
export const UNSCHEDULED_STRONG_DAYS = 4;
export const UNSCHEDULED_URGENT_DAYS = 7;
export const EXAM_URGENT_DAYS = 3;

function dayNumber(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

export function daysFrom(fromKey: string, toKey: string) {
  return Math.round(dayNumber(toKey) - dayNumber(fromKey));
}

function dayMonth(dateKey: string) {
  const [, m, d] = dateKey.split("-");
  return `${d}/${m}`;
}

export function getReviewUrgency({
  reviewDate,
  quizDateKey,
  todayKey,
  examKey,
}: {
  reviewDate: string | null;
  quizDateKey: string;
  todayKey: string;
  examKey: string | null;
}): ReviewUrgency {
  const ageDays = Math.max(0, daysFrom(quizDateKey, todayKey));
  const daysToExam = examKey ? daysFrom(todayKey, examKey) : null;
  const base = { strong: false, ageDays };

  if (reviewDate && reviewDate < todayKey) {
    const late = daysFrom(reviewDate, todayKey);
    return { ...base, level: "urgent", rank: 0, label: `Khẩn · trễ lịch ôn ${late} ngày` };
  }

  if (!reviewDate && ageDays > UNSCHEDULED_URGENT_DAYS) {
    return { ...base, level: "urgent", rank: 0, label: `Khẩn · chưa chọn lịch ${ageDays} ngày` };
  }

  if (daysToExam !== null && daysToExam >= 0 && daysToExam <= EXAM_URGENT_DAYS && reviewDate !== todayKey) {
    return {
      ...base,
      level: "urgent",
      rank: 0,
      label: daysToExam === 0 ? "Khẩn · hôm nay thi" : `Khẩn · còn ${daysToExam} ngày tới thi`,
    };
  }

  if (reviewDate === todayKey) {
    return { ...base, level: "due", rank: 1, label: "Đến hạn ôn hôm nay" };
  }

  if (reviewDate) {
    return { ...base, level: "scheduled", rank: 3, label: `Đã lên lịch · ôn vào ${dayMonth(reviewDate)}` };
  }

  const strong = ageDays >= UNSCHEDULED_STRONG_DAYS;
  return {
    ...base,
    strong,
    level: "unscheduled",
    rank: strong ? 1.5 : 2,
    label: ageDays === 0 ? "Chưa chọn lịch ôn" : `Chưa chọn lịch · ${ageDays} ngày`,
  };
}

/* Nhãn mức điểm: quyết định hình thức ôn lại theo đặc tả F6 */
export function scoreBand(percent: number) {
  return percent < 50
    ? { weak: true, label: "Yếu, dưới 50%" }
    : { weak: false, label: "Cần củng cố, 50–79%" };
}

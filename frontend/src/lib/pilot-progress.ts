/*
 * Tiến độ dùng cho Nhà của Pilot: số sao, chuỗi ngày học và điều kiện mở khoá đồ.
 * Hàm thuần (không gọi API) để chạy thử bằng node: node src/lib/pilot-progress.test.ts
 */

export type ProgressInput = {
  /* Trạng thái các buổi học (chỉ đếm buổi "completed") */
  sessionStatuses: string[];
  /* Các lần nộp quiz: điểm 0-100 và thời điểm nộp (ISO) */
  attempts: { score: number; submittedAt?: string | null }[];
  /* Hôm nay dạng YYYY-MM-DD theo giờ máy người dùng */
  todayKey: string;
};

export type PilotProgress = {
  stars: number;
  completedSessions: number;
  goodQuizzes: number;
  perfectQuizzes: number;
  streak: number;
};

export type UnlockRule = "streak5" | "streak7" | "good3" | "perfect1" | "sessions10";

const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

function shiftKey(key: string, days: number) {
  const [y, m, d] = key.split("-").map(Number);
  return keyOf(new Date(y, m - 1, d + days));
}

/* Số ngày liên tiếp có nộp quiz, tính tới hôm nay (hoặc hôm qua nếu hôm nay chưa học) */
export function studyStreak(dayKeys: Iterable<string>, todayKey: string) {
  const days = new Set(dayKeys);
  let cursor = days.has(todayKey) ? todayKey : shiftKey(todayKey, -1);
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = shiftKey(cursor, -1);
  }
  return streak;
}

export function pilotProgress({ sessionStatuses, attempts, todayKey }: ProgressInput): PilotProgress {
  const completedSessions = sessionStatuses.filter((status) => status === "completed").length;
  const scores = attempts.map((attempt) => Math.round(Number(attempt.score) || 0));
  const goodQuizzes = scores.filter((score) => score >= 80).length;
  const perfectQuizzes = scores.filter((score) => score >= 100).length;
  const dayKeys: string[] = [];
  for (const attempt of attempts) {
    const date = attempt.submittedAt ? new Date(attempt.submittedAt) : null;
    if (date && !Number.isNaN(date.getTime())) dayKeys.push(keyOf(date));
  }
  return {
    // 1 sao mỗi buổi học xong + 1 sao mỗi bài quiz đạt từ 80%
    stars: completedSessions + goodQuizzes,
    completedSessions,
    goodQuizzes,
    perfectQuizzes,
    streak: studyStreak(dayKeys, todayKey),
  };
}

export function isUnlocked(rule: UnlockRule | undefined, progress: PilotProgress) {
  switch (rule) {
    case "streak5":
      return progress.streak >= 5;
    case "streak7":
      return progress.streak >= 7;
    case "good3":
      return progress.goodQuizzes >= 3;
    case "perfect1":
      return progress.perfectQuizzes >= 1;
    case "sessions10":
      return progress.completedSessions >= 10;
    default:
      return true;
  }
}

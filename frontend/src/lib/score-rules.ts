/*
 * Ngưỡng điểm dùng chung (đặc tả F6, chốt 26/11/2026), giống backend/score_rules.py:
 *   < 50  Yếu · 50–79 Cần củng cố · >= 80 Đạt. Đúng 50% thuộc nhóm giữa, đúng 80% là ĐẠT.
 * Chạy được bằng node (không import "@/lib/i18n"; web gắn hàm dịch ở globalThis.__spTx).
 */
type Translate = (vi: string, vars?: ReadonlyArray<unknown>) => string;
const tx: Translate = (vi, vars) => {
  const translate = (globalThis as { __spTx?: Translate }).__spTx;
  if (translate) return translate(vi, vars);
  return vi.replace(/\{(\d+)\}/g, (_, index) => String(vars?.[Number(index)] ?? ""));
};

export const WEAK_BELOW = 50;
export const PASS_SCORE = 80;

export type ScoreLevel = "weak" | "mid" | "pass";

export function isPass(percent: number | null | undefined) {
  return Number(percent ?? 0) >= PASS_SCORE;
}

export function scoreLevel(percent: number): ScoreLevel {
  if (percent >= PASS_SCORE) return "pass";
  if (percent >= WEAK_BELOW) return "mid";
  return "weak";
}

/* Một bộ nhãn duy nhất cho mọi trang; "attention" = bài tổng hợp chưa đạt */
export function levelLabel(level: ScoreLevel | "attention") {
  return {
    weak: tx("Yếu"),
    mid: tx("Cần củng cố"),
    pass: tx("Đạt"),
    attention: tx("Cần chú ý"),
  }[level];
}

/* Màu chữ / nền theo mức (dùng chung) */
export function levelTone(level: ScoreLevel | "attention") {
  return {
    weak: { text: "text-[var(--sp-pink-dark)]", box: "border-[var(--sp-pink-line,#f3b3c6)] bg-[var(--sp-pink-bg)]" },
    mid: { text: "text-[var(--sp-amber-dark)]", box: "border-[#f0d98a] bg-[var(--sp-amber-bg)]" },
    pass: { text: "text-emerald-700", box: "border-emerald-200 bg-emerald-50" },
    attention: { text: "text-[#b45309]", box: "border-[#fbbf77] bg-[#fff4e5]" },
  }[level];
}

/* Điểm % của một lượt làm: ưu tiên số câu đúng / tổng câu */
export function attemptPercent(attempt: {
  score?: number | null;
  correct_count?: number | null;
  total_questions?: number | null;
}) {
  const total = Number(attempt.total_questions || 0);
  if (total > 0) return Math.round((Number(attempt.correct_count || 0) / total) * 100);
  return Math.round(Number(attempt.score || 0));
}

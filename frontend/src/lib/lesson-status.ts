/*
 * Trạng thái của từng buổi học: MỘT nguồn duy nhất cho Tổng quan, Kế hoạch,
 * Đánh giá năng lực và Kiểm tra kiến thức (L7, 26/11/2026).
 * Hàm thuần, không gọi API; chạy được bằng node: node src/lib/lesson-status.test.ts
 *
 * Quy tắc (docs/phan-tich-luong-kiem-tra.md, mục 1 và "Quy tắc hiển thị chung"):
 * - Điểm lần đầu = lượt nộp đầu tiên của quiz gốc: quyết định đạt hay phải ôn.
 * - Điểm hiện tại = lượt nộp mới nhất của quiz gốc / bài kiểm tra lại / bài tổng hợp.
 * - Một nút "việc tiếp theo" giống nhau ở mọi trang.
 */
import { isPass, levelLabel, scoreLevel, type ScoreLevel, attemptPercent } from "./score-rules.ts";

type Translate = (vi: string, vars?: ReadonlyArray<unknown>) => string;
const tx: Translate = (vi, vars) => {
  const translate = (globalThis as { __spTx?: Translate }).__spTx;
  if (translate) return translate(vi, vars);
  return vi.replace(/\{(\d+)\}/g, (_, index) => String(vars?.[Number(index)] ?? ""));
};

export type LessonSession = {
  id: string;
  topic_id?: string | null;
  scheduled_start: string;
  status: string;
};

export type LessonQuiz = {
  id: string;
  study_session_id?: string | null;
  is_retake?: boolean;
  is_final?: boolean;
  review_plan_id?: string | null;
  review_status?: string | null;
  review_date?: string | null;
  needs_attention?: boolean;
  final_quiz_id?: string | null;
  /* Đã ôn lại xong (bài tổng hợp mở được) */
  review_done?: boolean;
};

export type LessonAttempt = {
  attempt_id: string;
  quiz_id: string;
  score?: number | null;
  correct_count?: number | null;
  total_questions?: number | null;
  submitted_at?: string | null;
  review_plan?: { id: string; status?: string | null } | null;
};

export type PlanLock = {
  locked: boolean;
  review_plan_id?: string;
  origin_session_id?: string | null;
  session_order?: number | null;
  final_quiz_id?: string | null;
  review_done?: boolean;
  reason?: string;
};

export type LessonLevel = ScoreLevel | "attention" | "none";

export type NextKind =
  | "learn" // Vào học
  | "quiz" // Làm bài kiểm tra (có quiz)
  | "ensure_quiz" // Làm bài kiểm tra (chưa có quiz, cần tạo bù)
  | "pick_date" // Chọn ngày ôn
  | "review" // Vào ôn
  | "retake" // Làm bài kiểm tra lại
  | "final" // Ôn lại và làm bài tổng hợp
  | "revisit"; // Xem lại

export type LessonStatus = {
  sessionId: string;
  topicId: string | null;
  /* Buổi N trong kế hoạch, theo thứ tự thời gian */
  order: number;
  dateKey: string;
  sessionStatus: string;
  originalQuizId: string | null;
  firstAttemptId: string | null;
  firstScore: number | null;
  currentScore: number | null;
  currentAttemptId: string | null;
  level: LessonLevel;
  levelLabel: string;
  review: null | {
    planId: string;
    status: string;
    reviewDate: string | null;
    late: boolean;
    retakeQuizId: string | null;
    finalQuizId: string | null;
    needsAttention: boolean;
  };
  next: {
    kind: NextKind;
    label: string;
    href: string | null;
    locked: boolean;
    lockReason: string | null;
  };
};

export type LessonLinks = (sessionId: string) => { learn: string; review: string; revisit: string };

/* Một đích duy nhất cho mọi trang: trang Tài liệu học tập của buổi, theo chế độ */
export function lessonLinksFor(subjectId?: string | null): LessonLinks {
  return (sessionId) => {
    const base = subjectId
      ? `/study-materials?subject=${encodeURIComponent(subjectId)}&session=${encodeURIComponent(sessionId)}`
      : `/study-materials?session=${encodeURIComponent(sessionId)}`;
    return { learn: `${base}&mode=learn`, review: `${base}&mode=review`, revisit: `${base}&mode=revisit` };
  };
}

/* Trang không gọi /lock: suy ra khoá từ bài kiểm tra lại / bài tổng hợp đang "final_required" */
export function deriveLock(quizzes: LessonQuiz[]): PlanLock {
  const pending = quizzes.find((quiz) => quiz.review_status === "final_required" && quiz.study_session_id);
  if (!pending) return { locked: false };
  return {
    locked: true,
    origin_session_id: pending.study_session_id,
    final_quiz_id: pending.is_final ? pending.id : pending.final_quiz_id || null,
    reason: tx("Kế hoạch đang tạm khoá: làm xong bài tổng hợp 20 câu để mở."),
  };
}

const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
export function toDateKey(value: string | Date) {
  return dateKeyFormatter.format(new Date(value));
}

const NEXT_LABEL: Record<NextKind, string> = {
  learn: "Vào học",
  quiz: "Làm bài kiểm tra",
  ensure_quiz: "Làm bài kiểm tra",
  pick_date: "Chọn ngày ôn",
  review: "Vào ôn",
  retake: "Làm bài kiểm tra lại",
  final: "Ôn lại ngay",
  revisit: "Xem lại",
};

export function nextLabel(kind: NextKind) {
  return tx(NEXT_LABEL[kind]);
}

function bySubmitted(a: LessonAttempt, b: LessonAttempt) {
  return String(a.submitted_at || "").localeCompare(String(b.submitted_at || ""));
}

export function buildLessonStatuses({
  sessions,
  quizzes,
  attempts,
  todayKey,
  links,
  lock,
}: {
  sessions: LessonSession[];
  quizzes: LessonQuiz[];
  attempts: LessonAttempt[];
  todayKey: string;
  links: LessonLinks;
  lock?: PlanLock | null;
}): LessonStatus[] {
  if (lock === undefined) lock = deriveLock(quizzes);
  const originalBySession = new Map<string, LessonQuiz>();
  const retakeBySession = new Map<string, LessonQuiz>();
  const finalBySession = new Map<string, LessonQuiz>();
  for (const quiz of quizzes) {
    const sessionId = quiz.study_session_id;
    if (!sessionId) continue;
    if (quiz.is_final) finalBySession.set(sessionId, quiz);
    else if (quiz.is_retake) retakeBySession.set(sessionId, quiz);
    else if (!originalBySession.has(sessionId)) originalBySession.set(sessionId, quiz);
  }

  const submittedByQuiz = new Map<string, LessonAttempt[]>();
  for (const attempt of attempts) {
    if (!attempt.submitted_at) continue;
    submittedByQuiz.set(attempt.quiz_id, [...(submittedByQuiz.get(attempt.quiz_id) || []), attempt]);
  }
  for (const list of submittedByQuiz.values()) list.sort(bySubmitted);

  const ordered = [...sessions].sort(
    (a, b) => String(a.scheduled_start).localeCompare(String(b.scheduled_start)) || a.id.localeCompare(b.id)
  );

  return ordered.map((session, index) => {
    const original = originalBySession.get(session.id) || null;
    const retake = retakeBySession.get(session.id) || null;
    const final = finalBySession.get(session.id) || null;
    const originalAttempts = original ? submittedByQuiz.get(original.id) || [] : [];
    const first = originalAttempts[0] || null;
    const allAttempts = [original, retake, final]
      .filter((quiz): quiz is LessonQuiz => Boolean(quiz))
      .flatMap((quiz) => submittedByQuiz.get(quiz.id) || [])
      .sort(bySubmitted);
    const latest = allAttempts[allAttempts.length - 1] || null;
    const firstScore = first ? attemptPercent(first) : null;
    const currentScore = latest ? attemptPercent(latest) : null;

    // Buổi ôn: lấy từ bài kiểm tra lại (hoặc review plan gắn với lượt nộp đầu nếu chưa có bài)
    const reviewSource = retake || final;
    const planId = reviewSource?.review_plan_id || (first && !isPass(firstScore) ? first.review_plan?.id : null) || null;
    const reviewStatus = reviewSource?.review_status || (planId ? first?.review_plan?.status || "pending" : null);
    const reviewDate = retake?.review_date || final?.review_date || null;
    const needsAttention = Boolean(retake?.needs_attention || final?.needs_attention);
    const review =
      planId && firstScore !== null && !isPass(firstScore)
        ? {
            planId,
            status: String(reviewStatus || "pending"),
            reviewDate,
            late: Boolean(reviewDate && reviewDate < todayKey && reviewStatus !== "completed"),
            retakeQuizId: retake?.id || null,
            finalQuizId: final?.id || retake?.final_quiz_id || null,
            needsAttention,
          }
        : null;

    let level: LessonLevel = "none";
    if (review?.status === "completed" && review.needsAttention) level = "attention";
    else if (currentScore !== null) level = scoreLevel(currentScore);

    const link = links(session.id);
    let kind: NextKind;
    let href: string | null;
    if (session.status === "completed" && first) {
      if (!review || review.status === "completed") {
        kind = "revisit";
        href = link.revisit;
      } else if (review.status === "final_required") {
        kind = "final";
        // Đã ôn lại xong → mở thẳng bài tổng hợp 20 câu
        const reviewDone = Boolean(lock?.review_done || final?.review_done || retake?.review_done);
        href = reviewDone && review.finalQuizId ? `/quizzes/${review.finalQuizId}` : link.review;
      } else if (!review.reviewDate) {
        kind = "pick_date";
        href = `/quiz-results/${first.attempt_id}`;
      } else if (review.status === "in_progress" && review.retakeQuizId) {
        kind = "retake";
        href = `/quizzes/${review.retakeQuizId}`;
      } else {
        kind = "review";
        href = link.review;
      }
    } else if (session.status === "in_progress" || session.status === "completed") {
      kind = original ? "quiz" : "ensure_quiz";
      href = original ? `/quizzes/${original.id}` : null;
    } else {
      kind = "learn";
      href = link.learn;
    }

    // Kế hoạch đang chờ bài tổng hợp: mọi việc khác bị khoá (xem lại vẫn được)
    const lockedHere = Boolean(lock?.locked && lock.origin_session_id !== session.id && kind !== "revisit");

    return {
      sessionId: session.id,
      topicId: session.topic_id || null,
      order: index + 1,
      dateKey: toDateKey(session.scheduled_start),
      sessionStatus: session.status,
      originalQuizId: original?.id || null,
      firstAttemptId: first?.attempt_id || null,
      firstScore,
      currentScore,
      currentAttemptId: latest?.attempt_id || null,
      level,
      levelLabel: level === "none" ? "" : levelLabel(level),
      review,
      next: {
        kind,
        label: nextLabel(kind),
        href,
        locked: lockedHere,
        lockReason: lockedHere ? lock?.reason || tx("Kế hoạch đang tạm khoá") : null,
      },
    };
  });
}

export type TodayTaskKind = "learn" | "quiz" | "review" | "final";

export type SharedTodayTask = {
  key: string;
  kind: TodayTaskKind;
  status: LessonStatus;
  overdue: boolean;
};

/*
 * Mục "Hôm nay" dùng chung cho Tổng quan và Kế hoạch:
 * bài tổng hợp đang chờ → buổi học trễ chưa xong → buổi học hôm nay
 * → bài chưa chọn ngày ôn → buổi ôn đến hạn hoặc trễ.
 */
export function buildTodayTasks(statuses: LessonStatus[], todayKey: string): SharedTodayTask[] {
  const tasks: SharedTodayTask[] = [];
  const push = (status: LessonStatus, kind: TodayTaskKind, overdue: boolean) =>
    tasks.push({ key: `${kind}-${status.sessionId}`, kind, status, overdue });

  for (const status of statuses) {
    if (status.next.kind === "final") push(status, "final", true);
  }
  for (const status of statuses) {
    if (status.sessionStatus === "completed" && status.firstAttemptId) continue;
    if (status.dateKey < todayKey) push(status, status.next.kind === "learn" ? "learn" : "quiz", true);
  }
  for (const status of statuses) {
    if (status.dateKey !== todayKey) continue;
    if (status.sessionStatus === "completed" && status.firstAttemptId) continue;
    push(status, status.next.kind === "learn" ? "learn" : "quiz", false);
  }
  for (const status of statuses) {
    if (status.next.kind === "pick_date") push(status, "review", false);
  }
  for (const status of statuses) {
    const review = status.review;
    if (!review || !review.reviewDate) continue;
    if (!["review", "retake"].includes(status.next.kind)) continue;
    if (review.reviewDate <= todayKey) push(status, "review", review.late);
  }
  return tasks;
}

/* Kết quả của một ngày trên lịch (dấu X): xanh / hồng (còn buổi ôn) / vàng (cần chú ý) */
export type DayResult = "passed" | "pending_review" | "needs_attention" | "final_required";

export function lessonCalendarResult(status: LessonStatus): DayResult {
  if (status.review?.status === "final_required") return "final_required";
  if (status.level === "attention") return "needs_attention";
  if (status.review && status.review.status !== "completed") return "pending_review";
  return "passed";
}

// Chạy: node src/lib/lesson-status.test.ts
import assert from "node:assert/strict";
import { isPass, scoreLevel } from "./score-rules.ts";
import {
  buildLessonStatuses,
  buildTodayTasks,
  deriveLock,
  lessonCalendarResult,
  lessonLinksFor,
  type LessonQuiz,
} from "./lesson-status.ts";

// Ngưỡng: 49 yếu, 50 giữa, 79 giữa, 80 đạt
assert.equal(scoreLevel(49), "weak");
assert.equal(scoreLevel(50), "mid");
assert.equal(scoreLevel(79), "mid");
assert.equal(scoreLevel(80), "pass");
assert.equal(isPass(80), true);
assert.equal(isPass(79), false);

const TODAY = "2026-11-26";
const links = (id: string) => ({ learn: `/m?s=${id}&mode=learn`, review: `/m?s=${id}&mode=review`, revisit: `/m?s=${id}&mode=revisit` });
const at = (day: string) => `${day}T03:00:00+00:00`;
const attempt = (id: string, quizId: string, correct: number, day: string, total = 10) => ({
  attempt_id: id, quiz_id: quizId, correct_count: correct, total_questions: total, score: (correct / total) * 100,
  submitted_at: at(day),
});

const sessions = [
  { id: "s1", scheduled_start: at("2026-11-20"), status: "completed" }, // 90% đạt
  { id: "s2", scheduled_start: at("2026-11-21"), status: "completed" }, // 70 → kiểm tra lại 50, chưa chọn... có ngày, đã mở
  { id: "s3", scheduled_start: at("2026-11-22"), status: "completed" }, // 80% đúng biên → đạt
  { id: "s4", scheduled_start: at("2026-11-23"), status: "completed" }, // 40%, chưa chọn ngày ôn
  { id: "s5", scheduled_start: at("2026-11-24"), status: "completed" }, // 60, ngày ôn mai, chưa ôn
  { id: "s6", scheduled_start: at("2026-11-25"), status: "in_progress" }, // trễ, thiếu quiz
  { id: "s7", scheduled_start: at("2026-11-26"), status: "scheduled" }, // hôm nay
  { id: "s8", scheduled_start: at("2026-11-19"), status: "completed" }, // tổng hợp 70 → cần chú ý
];
const quizzes: LessonQuiz[] = [
  { id: "q1", study_session_id: "s1" },
  { id: "q2", study_session_id: "s2" },
  { id: "r2", study_session_id: "s2", is_retake: true, review_plan_id: "p2", review_status: "in_progress", review_date: "2026-11-27" },
  { id: "q3", study_session_id: "s3" },
  { id: "q4", study_session_id: "s4" },
  { id: "q5", study_session_id: "s5" },
  { id: "r5", study_session_id: "s5", is_retake: true, review_plan_id: "p5", review_status: "pending", review_date: "2026-11-27" },
  { id: "q7", study_session_id: "s7" },
  { id: "q8", study_session_id: "s8" },
  { id: "r8", study_session_id: "s8", is_retake: true, review_plan_id: "p8", review_status: "completed", review_date: "2026-11-22", needs_attention: true },
  { id: "f8", study_session_id: "s8", is_retake: true, is_final: true, review_plan_id: "p8", review_status: "completed", needs_attention: true },
];
const attempts = [
  attempt("a1", "q1", 9, "2026-11-20"),
  attempt("a2", "q2", 7, "2026-11-21"),
  attempt("a2r", "r2", 5, "2026-11-22"),
  attempt("a3", "q3", 8, "2026-11-22"),
  { ...attempt("a4", "q4", 4, "2026-11-23"), review_plan: { id: "p4", status: "pending" } },
  attempt("a5", "q5", 6, "2026-11-24"),
  attempt("a8", "q8", 3, "2026-11-19"),
  attempt("a8r", "r8", 2, "2026-11-20"),
  attempt("a8f", "f8", 14, "2026-11-21", 20),
];

const statuses = buildLessonStatuses({ sessions, quizzes, attempts, todayKey: TODAY, links });
const by = Object.fromEntries(statuses.map((s) => [s.sessionId, s]));

// Đánh số Buổi N theo thời gian
assert.deepEqual(statuses.map((s) => s.sessionId), ["s8", "s1", "s2", "s3", "s4", "s5", "s6", "s7"]);
assert.equal(by.s1.order, 2);

// 90% đạt → Xem lại
assert.equal(by.s1.level, "pass");
assert.equal(by.s1.next.kind, "revisit");
// Biên 80% là đạt, không có buổi ôn
assert.equal(by.s3.firstScore, 80);
assert.equal(by.s3.level, "pass");
assert.equal(by.s3.review, null);
// Gốc 70 rồi kiểm tra lại 50: lần đầu 70, hiện tại 50, bài kiểm tra lại đang mở
assert.equal(by.s2.firstScore, 70);
assert.equal(by.s2.currentScore, 50);
assert.equal(by.s2.level, "mid");
assert.equal(by.s2.next.kind, "retake");
assert.equal(by.s2.next.href, "/quizzes/r2");
// 40%, chưa chọn ngày ôn → Chọn ngày ôn (dẫn tới trang kết quả)
assert.equal(by.s4.level, "weak");
assert.equal(by.s4.next.kind, "pick_date");
assert.equal(by.s4.next.href, "/quiz-results/a4");
// Đã chọn ngày ôn ngày mai: vào ôn được NGAY (không đợi tới ngày)
assert.equal(by.s5.next.kind, "review");
assert.equal(by.s5.next.href, "/m?s=s5&mode=review");
assert.equal(by.s5.review?.late, false);
// Buổi trễ, thiếu quiz → tạo bù
assert.equal(by.s6.next.kind, "ensure_quiz");
assert.equal(by.s6.next.href, null);
// Hôm nay chưa học
assert.equal(by.s7.next.kind, "learn");
// Tổng hợp 70 → hoàn thành nhưng cần chú ý
assert.equal(by.s8.level, "attention");
assert.equal(by.s8.levelLabel, "Cần chú ý");
assert.equal(by.s8.currentScore, 70);
assert.equal(lessonCalendarResult(by.s8), "needs_attention");
assert.equal(lessonCalendarResult(by.s1), "passed");
assert.equal(lessonCalendarResult(by.s5), "pending_review");

// Hôm nay: buổi trễ s6 trước, rồi s7 hôm nay, rồi s4 chọn ngày ôn; s5 (ôn ngày mai) chưa vào "Hôm nay"
const today = buildTodayTasks(statuses, TODAY).map((t) => `${t.kind}:${t.status.sessionId}`);
assert.deepEqual(today, ["quiz:s6", "learn:s7", "review:s4"]);

// Kế hoạch khoá chờ bài tổng hợp của s2: mọi việc khác khoá, s2 thì không, Xem lại không khoá
const lockedStatuses = buildLessonStatuses({
  sessions,
  quizzes: quizzes.map((q) => (q.review_plan_id === "p2" ? { ...q, review_status: "final_required" } : q)),
  attempts,
  todayKey: TODAY,
  links,
  lock: { locked: true, review_plan_id: "p2", origin_session_id: "s2", reason: "khoá" },
});
const locked = Object.fromEntries(lockedStatuses.map((s) => [s.sessionId, s]));
assert.equal(locked.s2.next.kind, "final");
assert.equal(locked.s2.next.locked, false);
assert.equal(locked.s7.next.locked, true);
assert.equal(locked.s1.next.locked, false);
assert.equal(lessonCalendarResult(locked.s2), "final_required");
assert.equal(buildTodayTasks(lockedStatuses, TODAY)[0].kind, "final");
// Chưa ôn lại → nút đưa về trang ôn; đã ôn xong → mở thẳng bài tổng hợp
assert.equal(locked.s2.next.href, links("s2").review);
const reviewedFinal = buildLessonStatuses({
  sessions,
  quizzes: [
    ...quizzes.map((q) => (q.review_plan_id === "p2" ? { ...q, review_status: "final_required" } : q)),
    { id: "f2", study_session_id: "s2", is_retake: true, is_final: true, review_plan_id: "p2", review_status: "final_required", review_done: true },
  ],
  attempts,
  todayKey: TODAY,
  links,
}).find((s) => s.sessionId === "s2")!;
assert.equal(reviewedFinal.next.kind, "final");
assert.equal(reviewedFinal.next.href, "/quizzes/f2");

// Trang không gọi /lock: tự suy ra khoá từ bài đang chờ bài tổng hợp
assert.equal(deriveLock([{ id: "q", study_session_id: "s1", review_status: "pending", is_retake: true }]).locked, false);
const derived = deriveLock([
  { id: "r", study_session_id: "s1", review_status: "final_required", is_retake: true, final_quiz_id: "f" },
]);
assert.equal(derived.locked, true);
assert.equal(derived.origin_session_id, "s1");
assert.equal(derived.final_quiz_id, "f");

// Một đích chung cho mọi trang
assert.equal(lessonLinksFor("sub").call(null, "s9").review, "/study-materials?subject=sub&session=s9&mode=review");

console.log("OK: lesson-status");

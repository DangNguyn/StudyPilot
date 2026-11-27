// Chạy: node src/lib/review-urgency.test.ts
import assert from "node:assert/strict";
import { getReviewUrgency } from "./review-urgency.ts";

const today = "2026-11-20";
const exam = "2026-11-30";
const at = (quizDateKey: string, reviewDate: string | null, examKey: string | null = exam) =>
  getReviewUrgency({ reviewDate, quizDateKey, todayKey: today, examKey });

// Chưa chọn lịch: dưới 4 ngày nhạt, 4–7 ngày đậm, trên 7 ngày khẩn
assert.equal(at("2026-11-17", null).level, "unscheduled");
assert.equal(at("2026-11-17", null).strong, false);
assert.equal(at("2026-11-16", null).strong, true);
assert.equal(at("2026-11-13", null).level, "unscheduled");
assert.equal(at("2026-11-12", null).level, "urgent");

// Có lịch: tương lai, hôm nay, đã qua
assert.equal(at("2026-11-16", "2026-11-26").level, "scheduled");
assert.equal(at("2026-11-16", "2026-11-20").level, "due");
assert.equal(at("2026-11-16", "2026-11-19").label, "Khẩn · trễ lịch ôn 1 ngày");

// Gần thi (≤3 ngày) thì khẩn, trừ khi hôm nay đã là ngày ôn
assert.equal(at("2026-11-19", null, "2026-11-23").level, "urgent");
assert.equal(at("2026-11-19", "2026-11-20", "2026-11-23").level, "due");
assert.equal(at("2026-11-19", null, "2026-11-24").level, "unscheduled");

// Thứ tự ưu tiên
assert.ok(at("2026-11-16", "2026-11-19").rank < at("2026-11-16", "2026-11-20").rank);
assert.ok(at("2026-11-16", null).rank < at("2026-11-19", null).rank);

// Mức điểm: đúng 50% thuộc nhóm giữa

console.log("OK: review urgency");

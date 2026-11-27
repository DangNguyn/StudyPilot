// Chạy: node src/lib/study-calendar.test.ts
import assert from "node:assert/strict";
import { buildMonth, dayResult, monthsBetween, type CalendarEntry } from "./study-calendar.ts";

const entry = (dateKey: string, kind: CalendarEntry["kind"], done: boolean, late = false): CalendarEntry => ({
  key: `${dateKey}-${kind}-${done}`,
  kind,
  dateKey,
  title: "x",
  done,
  late,
  lines: [],
});

// Tháng 11/2026 bắt đầu Chủ nhật: 6 ô trống, 30 ngày, đủ tuần
const weeks = buildMonth(
  "2026-11",
  [
    entry("2026-11-16", "learn", true),
    entry("2026-11-17", "learn", true),
    entry("2026-11-17", "learn", false),
    entry("2026-11-18", "learn", false),
    entry("2026-11-21", "review", false, true),
    entry("2026-11-30", "exam", false),
  ],
  "2026-11-20"
);
const days = weeks.flat();
assert.equal(days.slice(0, 6).every((day) => day === null), true);
assert.equal(days[6]?.day, 1);
assert.equal(days[6]?.column, 6);
assert.equal(days.length % 7, 0);
const get = (n: number) => days.find((day) => day?.day === n)!;
assert.equal(get(16).column, 0);
assert.equal(get(16).done, true);
assert.equal(get(17).done, false); // còn một buổi chưa xong
assert.equal(get(18).missed, true); // đã qua, chưa học
assert.equal(get(20).isToday, true);
assert.equal(get(19).done, false); // không có lịch thì không đánh dấu
assert.equal(get(21).hasLate, true);
assert.equal(get(30).isExam, true);
assert.equal(get(30).done, false); // ngày thi không tính là "đã xong"

assert.deepEqual(monthsBetween("2026-11-16", "2027-01-05"), ["2026-11", "2026-12", "2027-01"]);
assert.deepEqual(monthsBetween("2026-11-16", "2026-11-30"), ["2026-11"]);

// Trong ngày: học trước, ôn sau
const mixed = buildMonth("2026-11", [entry("2026-11-25", "review", false), entry("2026-11-25", "learn", false)], "2026-11-20")
  .flat()
  .find((day) => day?.day === 25)!;
assert.deepEqual(mixed.entries.map((e) => e.kind), ["learn", "review"]);

// L5: màu dấu X của ngày, ưu tiên trạng thái nặng nhất
const withResult = (result: CalendarEntry["result"]): CalendarEntry => ({ ...entry("2026-11-02", "learn", true), result });
assert.equal(dayResult([withResult("passed")]), "passed");
assert.equal(dayResult([withResult("passed"), withResult("needs_attention")]), "needs_attention");
assert.equal(dayResult([withResult("needs_attention"), withResult("pending_review")]), "pending_review");
assert.equal(dayResult([withResult("pending_review"), withResult("final_required")]), "final_required");
assert.equal(dayResult([entry("2026-11-02", "learn", true)]), null);

console.log("OK: study calendar");

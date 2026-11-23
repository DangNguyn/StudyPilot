import assert from "node:assert/strict";
import { isUnlocked, pilotProgress, studyStreak } from "./pilot-progress.ts";

assert.equal(studyStreak(["2026-11-21", "2026-11-22", "2026-11-23"], "2026-11-23"), 3);
assert.equal(studyStreak(["2026-11-21", "2026-11-22"], "2026-11-23"), 2, "hôm nay chưa học vẫn giữ chuỗi");
assert.equal(studyStreak(["2026-11-20"], "2026-11-23"), 0);
assert.equal(studyStreak(["2026-11-30", "2026-12-01"], "2026-12-01"), 2, "qua tháng");

const p = pilotProgress({
  sessionStatuses: ["completed", "completed", "scheduled", "in_progress"],
  attempts: [
    { score: 100, submittedAt: "2026-11-23T03:00:00" },
    { score: 85, submittedAt: "2026-11-22T03:00:00" },
    { score: 40, submittedAt: "2026-11-22T05:00:00" },
  ],
  todayKey: "2026-11-23",
});
assert.equal(p.completedSessions, 2);
assert.equal(p.goodQuizzes, 2);
assert.equal(p.stars, 4);
assert.equal(p.streak, 2);
assert.equal(isUnlocked("perfect1", p), true);
assert.equal(isUnlocked("good3", p), false);
assert.equal(isUnlocked(undefined, p), true);
console.log("pilot-progress OK");

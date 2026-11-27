"use client";

import { currentLocale, tx } from "@/lib/i18n";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { PilotMascot, SmartLoading } from "@/components/loading-play";
import { getMainTopicTitle } from "@/lib/content-titles";
import StudyCalendar from "@/components/study-calendar";
import type { CalendarEntry } from "@/lib/study-calendar";
import {
  buildLessonStatuses,
  lessonCalendarResult,
  lessonLinksFor,
  buildTodayTasks,
  type LessonStatus,
  type PlanLock,
} from "@/lib/lesson-status";
import { isPass, levelLabel, scoreLevel } from "@/lib/score-rules";
import {
  getReviewUrgency,
  type ReviewLevel,
  type ReviewUrgency,
} from "@/lib/review-urgency";
import {
  IconAlert,
  IconArrowRight,
  IconBook,
  IconCalendar,
  IconChart,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconClock,
  IconFlag,
  IconLock,
  IconMoon,
  IconPen,
  IconPlay,
  IconPlus,
  IconRepeat,
  Sparkle,
} from "@/components/icons";

/* ================= Kiểu dữ liệu ================= */

type ExamPlan = {
  id: string;
  title: string;
  exam_date: string;
  subject_id?: string | null;
  daily_available_minutes: number;
  study_days_per_week?: number;
};

type Topic = {
  id: string;
  name: string;
  hierarchy?: string | null;
  description: string | null;
  difficulty_level: number;
  estimated_minutes: number;
  status: string;
};

type StudySession = {
  id: string;
  topic_id: string;
  scheduled_start: string;
  duration_minutes: number;
  status: string;
  source: string;
  notes: string | null;
  is_unlocked?: boolean;
  lock_reason?: string | null;
};

type StudyMaterial = {
  id: string;
  file_name: string;
};

type Quiz = {
  id: string;
  study_session_id?: string | null;
  is_retake?: boolean;
  /* Bài tổng hợp 20 câu (L4) */
  is_final?: boolean;
  review_plan_id?: string | null;
  review_status?: string | null;
  review_date?: string | null;
  needs_attention?: boolean;
  final_quiz_id?: string | null;
};

type ReviewPlanInfo = {
  id: string;
  status?: string | null;
};

type QuizAttempt = {
  attempt_id: string;
  quiz_id: string;
  score: number | null;
  correct_count: number | null;
  total_questions: number | null;
  submitted_at: string | null;
  review_plan?: ReviewPlanInfo | null;
};

/* Thông tin tổng hợp cho từng buổi học */
type SessionInsight = {
  session: StudySession;
  topic: Topic | undefined;
  dateKey: string;
  quizId: string | null;
  attempt: QuizAttempt | null;
  passed: boolean;
  pendingReviewId: string | null;
  /* Ngày ôn lại người học đã chọn (YYYY-MM-DD), null nếu chưa chọn */
  reviewDate: string | null;
  /* Điểm % mới nhất của buổi (bài chính hoặc bài kiểm tra lại), null nếu chưa kiểm tra */
  currentScore: number | null;
  /* Mức ưu tiên ôn lại, chỉ có khi còn bài kiểm tra lại chưa đạt */
  urgency: ReviewUrgency | null;
  /* Ngày ôn đã hoàn thành (bài kiểm tra lại đạt từ 80%) */
  doneReviewDate: string | null;
  /* Cả ba nút đều mở trang Tài liệu học tập (tóm tắt có câu hỏi lồng) của buổi này */
  links: { learn: string; review: string; revisit: string };
  /* Trạng thái dùng chung (lib/lesson-status.ts): điểm, nhãn, nút việc tiếp theo, khoá */
  lesson: LessonStatus;
};

type TaskKind = "review" | "quiz" | "learn";

type TodayTask = {
  key: string;
  kind: TaskKind;
  insight: SessionInsight;
  overdue: boolean;
  /* Gợi ý ôn phần yếu chưa có lịch: chỉ hiện trên trang, không gửi thông báo */
  extra?: boolean;
};

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

const DAY_MS = 24 * 60 * 60 * 1000;

/* ================= Tiện ích ngày tháng ================= */

const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh",
});

function toDateKey(value: string | Date) {
  return dateKeyFormatter.format(new Date(value));
}

function keyToDate(dateKey: string) {
  return new Date(`${dateKey}T00:00:00`);
}

function daysBetween(fromKey: string, toKey: string) {
  return Math.round(
    (keyToDate(toKey).getTime() - keyToDate(fromKey).getTime()) / DAY_MS
  );
}

function addDays(dateKey: string, days: number) {
  const date = keyToDate(dateKey);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDayMonth(dateKey: string) {
  const [, month, day] = dateKey.split("-");
  return `${day}/${month}`;
}

function formatFullDate(dateKey: string) {
  const [year, month, day] = dateKey.split("-");
  return `${day}/${month}/${year}`;
}

function weekdayLong(dateKey: string) {
  const label = keyToDate(dateKey).toLocaleDateString(currentLocale(), {
    weekday: "long",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function weekdayShort(dateKey: string) {
  const day = keyToDate(dateKey).getDay();
  return day === 0 ? "CN" : `T${day + 1}`;
}

function formatDuration(minutes: number) {
  if (minutes < 60) {
    return tx("{0} phút", [minutes]);
  }

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? tx("{0} giờ {1} phút", [hours, rest]) : tx("{0} giờ", [hours]);
}

/* ================= Tiện ích chủ đề ================= */

function getChapter(topic: Topic | undefined) {
  return String(topic?.hierarchy || "")
    .split(">")[0]
    .trim();
}

function getTopicTitle(topic: Topic | undefined) {
  return topic ? getMainTopicTitle(topic.name) : tx("Chủ đề chưa xác định");
}

/* ================= Trang ================= */

export default function StudyPlanDetailPage() {
  const params = useParams<{ planId: string }>();
  const router = useRouter();
  const planId = params.planId;

  const [plan, setPlan] = useState<ExamPlan | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [materials, setMaterials] = useState<StudyMaterial[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [attempts, setAttempts] = useState<QuizAttempt[]>([]);
  /* Kế hoạch đang khoá chờ bài tổng hợp 20 câu (L4) */
  const [planLock, setPlanLock] = useState<PlanLock | null>(null);
  const [ensureError, setEnsureError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [holdLoading, setHoldLoading] = useState(false);
  const [error, setError] = useState("");
  // Buổi đang được mở rộng trong "Hôm nay học gì?" (null = mặc định buổi của hôm nay)
  const [selectedTaskKey, setSelectedTaskKey] = useState<string | null>(null);
  /* Tuần đang mở trong "Toàn bộ lịch học" (mặc định chỉ mở tuần hiện tại) */

  useEffect(() => {
    async function loadPlanDetails() {
      try {
        setIsLoading(true);
        setError("");

        const planResponse = await fetch(`${API_URL}/api/exam-plans`);
        const planResult = await planResponse.json();

        if (!planResponse.ok) {
          throw new Error(
            planResult.detail || tx("Không thể tải kế hoạch ôn thi.")
          );
        }

        const currentPlan = (planResult.data || []).find(
          (item: ExamPlan) => item.id === planId
        );

        if (!currentPlan) {
          throw new Error(tx("Không tìm thấy kế hoạch ôn thi."));
        }

        setPlan(currentPlan);

        const [topicResponse, sessionResponse] = await Promise.all([
          fetch(`${API_URL}/api/topics?exam_plan_id=${planId}`),
          fetch(`${API_URL}/api/study-sessions?exam_plan_id=${planId}`),
        ]);

        const topicResult = await topicResponse.json();
        const sessionResult = await sessionResponse.json();

        if (!topicResponse.ok) {
          throw new Error(
            topicResult.detail || tx("Không thể tải danh sách chủ đề.")
          );
        }

        if (!sessionResponse.ok) {
          throw new Error(sessionResult.detail || tx("Không thể tải lịch học."));
        }

        setTopics(topicResult.data || []);
        setSessions(sessionResult.data || []);

        // Dữ liệu phụ: lỗi ở đây không chặn việc hiển thị lịch học.
        const [materialResult, quizResult, attemptResult, lockResult] =
          await Promise.allSettled([
            fetch(
              `${API_URL}/api/study-materials?exam_plan_id=${planId}`
            ).then((response) => response.json()),
            fetch(`${API_URL}/api/quizzes?exam_plan_id=${planId}`).then(
              (response) => response.json()
            ),
            fetch(`${API_URL}/api/quiz-attempts`).then((response) =>
              response.json()
            ),
            fetch(`${API_URL}/api/exam-plans/${planId}/lock`).then((response) =>
              response.ok ? response.json() : null
            ),
          ]);

        if (lockResult.status === "fulfilled") {
          setPlanLock(lockResult.value || null);
        }

        if (materialResult.status === "fulfilled") {
          setMaterials(materialResult.value?.data || []);
        }

        if (quizResult.status === "fulfilled") {
          setQuizzes(quizResult.value?.data || []);
        }

        if (attemptResult.status === "fulfilled") {
          setAttempts(attemptResult.value?.data || []);
        }
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : tx("Đã xảy ra lỗi khi tải dữ liệu.")
        );
      } finally {
        setIsLoading(false);
      }
    }

    if (planId) {
      loadPlanDetails();
    }
  }, [planId]);

  /* ---------- Tổng hợp dữ liệu ---------- */

  const todayKey = toDateKey(new Date());

  const topicById = useMemo(
    () => new Map(topics.map((topic) => [topic.id, topic])),
    [topics]
  );

  const insights = useMemo<SessionInsight[]>(() => {
    const originalQuizBySession = new Map<string, Quiz>();
    const retakeBySession = new Map<string, Quiz>();
    const lessonLinks = lessonLinksFor(plan?.subject_id);
    const lessonById = new Map(
      buildLessonStatuses({
        sessions,
        quizzes,
        attempts,
        todayKey,
        links: lessonLinks,
        lock: planLock || undefined,
      }).map((lesson) => [lesson.sessionId, lesson])
    );

    for (const quiz of quizzes) {
      if (!quiz.study_session_id || quiz.is_final) continue;

      if (quiz.is_retake) {
        retakeBySession.set(quiz.study_session_id, quiz);
      } else if (!originalQuizBySession.has(quiz.study_session_id)) {
        originalQuizBySession.set(quiz.study_session_id, quiz);
      }
    }

    // API trả lượt làm bài mới nhất trước.
    const latestAttemptByQuiz = new Map<string, QuizAttempt>();
    for (const attempt of attempts) {
      if (!latestAttemptByQuiz.has(attempt.quiz_id)) {
        latestAttemptByQuiz.set(attempt.quiz_id, attempt);
      }
    }

    return [...sessions]
      .sort(
        (a, b) =>
          new Date(a.scheduled_start).getTime() -
          new Date(b.scheduled_start).getTime()
      )
      .map((session) => {
        const quiz = originalQuizBySession.get(session.id);
        const attempt = quiz
          ? latestAttemptByQuiz.get(quiz.id) || null
          : null;
        const lesson = lessonById.get(session.id)!;
        const retakeQuiz = retakeBySession.get(session.id);
        // Buổi ôn còn mở (kể cả đang chờ bài tổng hợp): theo điểm lần đầu < 80% (L2, L7)
        const pendingReviewId =
          lesson.review && lesson.review.status !== "completed" ? lesson.review.planId : null;

        const retakeAttempt = retakeQuiz ? latestAttemptByQuiz.get(retakeQuiz.id) || null : null;
        const latestAny = [attempt, retakeAttempt]
          .filter((item): item is QuizAttempt => Boolean(item))
          .sort((a, b) =>
            String(b.submitted_at || "").localeCompare(String(a.submitted_at || ""))
          )[0];
        const reviewDate = pendingReviewId ? retakeQuiz?.review_date || null : null;
        const base = plan?.subject_id
          ? `/materials?subject=${encodeURIComponent(plan.subject_id)}&session=${encodeURIComponent(session.id)}`
          : `/study-materials?session=${encodeURIComponent(session.id)}`;
        const currentScore = latestAny
          ? Number(latestAny.total_questions)
            ? Math.round((Number(latestAny.correct_count || 0) / Number(latestAny.total_questions)) * 100)
            : Math.round(Number(latestAny.score || 0))
          : null;

        return {
          session,
          topic: topicById.get(session.topic_id),
          dateKey: toDateKey(session.scheduled_start),
          quizId: quiz?.id || null,
          currentScore,
          attempt,
          passed: lesson.firstScore !== null && isPass(lesson.firstScore),
          pendingReviewId,
          lesson,
          reviewDate,
          doneReviewDate:
            retakeQuiz?.review_status === "completed" ? retakeQuiz.review_date || null : null,
          links: {
            learn: `${base}&mode=learn`,
            review: `${base}&mode=review`,
            revisit: `${base}&mode=revisit`,
          },
          urgency: pendingReviewId
            ? getReviewUrgency({
                reviewDate,
                quizDateKey: toDateKey(attempt?.submitted_at || session.scheduled_start),
                todayKey,
                examKey: plan ? toDateKey(plan.exam_date) : null,
              })
            : null,
        };
      });
  }, [sessions, quizzes, attempts, topicById, todayKey, plan, planLock]);

  /* Buổi ôn lại đã có ngày (người học tự chọn sau bài kiểm tra dưới 80%) */
  const scheduledReviews = useMemo(
    () => insights.filter((insight) => insight.pendingReviewId && insight.reviewDate),
    [insights]
  );

  /* Việc cần làm hôm nay.
     Ngày có lịch học: học theo lịch trước, rồi ôn đến hạn; phần yếu chưa có lịch là gợi ý thêm.
     Ngày không có lịch học: ôn đến hạn trước, rồi gợi ý ôn phần yếu chưa có lịch. */
  const todayPlan = useMemo(() => {
    const learn = (insight: SessionInsight, overdue: boolean): TodayTask => ({
      key: `learn-${insight.session.id}`,
      kind: "learn",
      insight,
      overdue,
    });
    const review = (insight: SessionInsight, extra = false): TodayTask => ({
      key: `review-${insight.session.id}`,
      kind: "review",
      insight,
      overdue: insight.urgency?.level === "urgent",
      extra,
    });

    const todayLearning = insights.filter((insight) => insight.dateKey === todayKey);
    const isStudyDay = todayLearning.length > 0;
    // Cùng danh sách với Tổng quan (buildTodayTasks, L7); buổi hôm nay đã xong vẫn hiện (đã tick)
    const insightById = new Map(insights.map((insight) => [insight.session.id, insight]));
    const shared = buildTodayTasks(
      insights.map((insight) => insight.lesson),
      todayKey
    ).map((task): TodayTask => {
      const insight = insightById.get(task.status.sessionId)!;
      if (task.kind === "learn") return learn(insight, task.overdue);
      if (task.kind === "quiz") return { key: `quiz-${insight.session.id}`, kind: "quiz", insight, overdue: task.overdue };
      if (task.kind === "final") return { key: `review-${insight.session.id}`, kind: "review", insight, overdue: true };
      return review(insight);
    });
    const doneToday = todayLearning
      .filter((insight) => insight.session.status === "completed")
      .map((insight) => learn(insight, false));
    const tasks: TodayTask[] = [...shared, ...doneToday];

    const nextKey = isStudyDay
      ? null
      : insights.find((insight) => insight.dateKey > todayKey)?.dateKey || null;

    return {
      tasks,
      // Bài chưa chọn ngày ôn đã nằm trong danh sách chung
      extras: [] as TodayTask[],
      isStudyDay,
      learningSessions: todayLearning,
      nextLearning: nextKey
        ? {
            dateKey: nextKey,
            sessions: insights.filter((insight) => insight.dateKey === nextKey),
          }
        : null,
    };
  }, [insights, todayKey]);

  /* Lịch các ngày tới (sau ngày đang hiển thị ở khối "Hôm nay") */
  const upcomingDays = useMemo(() => {
    const startKey = todayKey;
    const futureKeys = Array.from(
      new Set([
        ...insights
          .filter((insight) => insight.dateKey > startKey)
          .map((insight) => insight.dateKey),
        ...scheduledReviews
          .filter((insight) => insight.reviewDate! > startKey)
          .map((insight) => insight.reviewDate!),
      ])
    )
      .sort()
      .slice(0, 4);

    if (futureKeys.length === 0) {
      return { days: [], restDays: [] as string[] };
    }

    const days = futureKeys.map((dateKey) => ({
      dateKey,
      items: insights.filter((insight) => insight.dateKey === dateKey),
      reviews: scheduledReviews.filter((insight) => insight.reviewDate === dateKey),
    }));

    const restDays: string[] = [];
    const lastKey = futureKeys[futureKeys.length - 1];
    for (
      let key = addDays(startKey, 1);
      key < lastKey;
      key = addDays(key, 1)
    ) {
      if (!futureKeys.includes(key)) {
        restDays.push(key);
      }
    }

    return { days, restDays };
  }, [insights, scheduledReviews, todayKey]);

  /* Thống kê banner */
  const stats = useMemo(() => {
    const totalSessions = insights.length;
    const completedSessions = insights.filter(
      (insight) => insight.session.status === "completed"
    ).length;

    const chapters = new Map<
      string,
      { total: number; done: number; needsReview: boolean }
    >();

    for (const topic of topics) {
      const key = getChapter(topic) || topic.id;
      if (!chapters.has(key)) {
        chapters.set(key, { total: 0, done: 0, needsReview: false });
      }
    }

    for (const insight of insights) {
      const key = getChapter(insight.topic) || insight.session.topic_id;
      const chapter = chapters.get(key) || {
        total: 0,
        done: 0,
        needsReview: false,
      };
      chapter.total += 1;
      if (insight.session.status === "completed") chapter.done += 1;
      if (insight.pendingReviewId) chapter.needsReview = true;
      chapters.set(key, chapter);
    }

    const chapterList = Array.from(chapters.values());
    const hasChapterNames = topics.some((topic) => getChapter(topic));

    return {
      totalSessions,
      completedSessions,
      percent: totalSessions
        ? Math.round((completedSessions / totalSessions) * 100)
        : 0,
      chapterCount: chapterList.length,
      chapterUnit: hasChapterNames ? tx("chương") : tx("chủ đề"),
      chaptersDone: chapterList.filter(
        (chapter) => chapter.total > 0 && chapter.done === chapter.total
      ).length,
      chaptersNeedReview: chapterList.filter((chapter) => chapter.needsReview)
        .length,
      // Đếm theo bài cho khớp các trang khác (L7): số bài còn buổi ôn
      lessonsNeedReview: insights.filter((insight) => insight.pendingReviewId).length,
      firstDateKey: insights[0]?.dateKey || null,
    };
  }, [insights, topics]);

  /* Lịch tháng: buổi học, buổi ôn (đúng ngày đã chọn) và ngày thi */
  const calendarEntries = useMemo<CalendarEntry[]>(() => {
    const entries: CalendarEntry[] = [];
    for (const insight of insights) {
      const done = insight.session.status === "completed";
      const attempt = insight.attempt;
      const percent = attempt ? attemptPercent(attempt) : null;
      const level = percent !== null ? scoreLevel(percent) : null;
      const band = level && level !== "pass" ? { weak: level === "weak" } : null;
      const reviewOn = insight.reviewDate || insight.doneReviewDate;
      entries.push({
        key: `learn-${insight.session.id}`,
        kind: "learn",
        dateKey: insight.dateKey,
        title: getTopicTitle(insight.topic),
        done,
        // Màu dấu X: chỉ khi đã nộp bài kiểm tra gốc (L5)
        result: done && attempt ? lessonCalendarResult(insight.lesson) : undefined,
        lines: [
          { text: tx("Học mới · {0} phút", [insight.session.duration_minutes]) },
          done && attempt
            ? {
                text: `Quiz ${attempt.correct_count ?? 0}/${attempt.total_questions ?? 0} (${percent}%) · ${level ? levelLabel(level) : ""}`,
                tone: band ? (band.weak ? "weak" : "mid") : undefined,
              }
            : { text: insight.session.status === "in_progress" ? tx("Đang học, chưa nộp bài kiểm tra") : tx("Chưa học") },
          ...(reviewOn ? [{ text: tx("Đã đặt lịch ôn {0}", [formatDayMonth(reviewOn)]) }] : []),
        ],
        action: done
          ? { kind: "revisit", href: insight.links.revisit }
          : {
              kind: "learn",
              href: insight.links.learn,
              locked: isLocked(insight.session) || insight.lesson.next.locked,
              lockReason: insight.lesson.next.lockReason,
            },
      });

      const reviewKey = insight.reviewDate || insight.doneReviewDate;
      if (reviewKey && attempt) {
        const reviewDone = !insight.reviewDate;
        const late = !reviewDone && reviewKey < todayKey;
        entries.push({
          key: `review-${insight.session.id}`,
          kind: "review",
          dateKey: reviewKey,
          title: getTopicTitle(insight.topic),
          done: reviewDone,
          late,
          lines: [
            { text: tx("Từ buổi {0} {1}", [weekdayLong(insight.dateKey), formatDayMonth(insight.dateKey)]) },
            {
              text: `Quiz ${attempt.correct_count ?? 0}/${attempt.total_questions ?? 0} (${percent}%) · ${levelLabel(band?.weak ? "weak" : "mid")}`,
              tone: band?.weak ? "weak" : "mid",
            },
            {
              text: reviewDone
                ? tx("Đã ôn xong, đạt từ 80%")
                : late
                  ? tx("Trễ lịch ôn {0} ngày", [daysBetween(reviewKey, todayKey)])
                  : reviewKey === todayKey
                    ? tx("Đến hạn hôm nay")
                    : tx("Đã lên lịch"),
            },
          ],
          action: reviewDone
            ? { kind: "revisit", href: insight.links.revisit }
            : {
                kind: "review",
                href: insight.links.review,
                locked: insight.lesson.next.locked,
                lockReason: insight.lesson.next.lockReason,
              },
        });
      }
    }
    if (plan) {
      entries.push({
        key: "exam",
        kind: "exam",
        dateKey: toDateKey(plan.exam_date),
        title: `Thi: ${plan.title}`,
        done: false,
        lines: [{ text: tx("Còn {0} ngày", [Math.max(0, daysBetween(todayKey, toDateKey(plan.exam_date)))]) }],
      });
    }
    return entries;
  }, [insights, plan, todayKey]);

  /* ---------- Trạng thái tải ---------- */

  if (isLoading || holdLoading) {
    return (
      <SmartLoading
        text={tx("Đang tải lộ trình ôn tập…")}
        sub={tx("Pilot đang xếp lịch học và lịch ôn của bạn.")}
        stages={[tx("Tải kế hoạch"), tx("Xếp buổi học"), tx("Gắn lịch ôn"), tx("Vẽ lịch tháng")]}
        continueLabel={tx("Xem kế hoạch")}
        done={!isLoading}
        onHoldChange={setHoldLoading}
      />
    );
  }

  if (error || !plan) {
    return (
      <div className="sp-card mx-auto max-w-3xl p-8">
        <p className="text-sm font-medium text-[var(--sp-pink-dark)]">
          {error || tx("Không tìm thấy kế hoạch.")}
        </p>
        <button
          type="button"
          onClick={() => router.push("/study-plans")}
          className="sp-btn sp-btn-primary mt-5 px-5 py-2.5 text-sm"
        >

          {tx("Quay lại kế hoạch")}
        </button>
      </div>
    );
  }

  /* ---------- Giá trị hiển thị ---------- */

  const examKey = toDateKey(plan.exam_date);
  const daysLeft = Math.max(0, daysBetween(todayKey, examKey));
  const titleWords = plan.title.trim().split(/\s+/);
  const titleTail =
    titleWords.length > 2 ? titleWords.slice(-2).join(" ") : plan.title;
  const titleHead =
    titleWords.length > 2 ? titleWords.slice(0, -2).join(" ") : "";
  const dailyHours = plan.daily_available_minutes / 60;
  const dailyLabel = Number.isInteger(dailyHours)
    ? tx("{0} giờ/ngày", [dailyHours])
    : tx("{0} phút/ngày", [plan.daily_available_minutes]);

  const learningTotalMinutes = todayPlan.learningSessions.reduce(
    (sum, insight) => sum + (insight.session.duration_minutes || 0),
    0
  );
  const learningDone = todayPlan.learningSessions.filter(
    (insight) => insight.session.status === "completed"
  ).length;

  const openTasks = todayPlan.tasks.filter(
    (task) =>
      task.kind !== "learn" || task.insight.session.status !== "completed"
  );
  const doneTasks = todayPlan.tasks.filter(
    (task) =>
      task.kind === "learn" && task.insight.session.status === "completed"
  );
  const allTasks = [...openTasks, ...doneTasks];
  // Mặc định mở rộng việc đầu tiên chưa xong; bấm việc khác để xem hành trình của việc đó.
  const todayTask = openTasks[0] || allTasks[0];
  const nextLearningMinutes = (todayPlan.nextLearning?.sessions || []).reduce(
    (sum, insight) => sum + (insight.session.duration_minutes || 0),
    0
  );
  const featured =
    allTasks.find((task) => task.key === selectedTaskKey) || todayTask;

  /* Mở việc: "ensure:<buổi>" = buổi chưa có quiz → tạo bù rồi mở bài (L1) */
  const openTask = async (href: string) => {
    if (!href.startsWith("ensure:")) {
      router.push(href);
      return;
    }
    setEnsureError("");
    try {
      const response = await fetch(`${API_URL}/api/study-sessions/${href.slice(7)}/ensure-quiz`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.quiz_id) throw new Error(data?.detail || tx("Chưa tạo được bài kiểm tra, hãy thử lại."));
      router.push(`/quizzes/${data.quiz_id}`);
    } catch (openError) {
      setEnsureError(openError instanceof Error ? openError.message : tx("Chưa tạo được bài kiểm tra, hãy thử lại."));
    }
  };
  const lockedLesson = planLock?.locked
    ? insights.find((insight) => insight.session.id === planLock.origin_session_id) || null
    : null;

  const renderTask = (task: TodayTask) =>
    featured && task.key === featured.key ? (
      <FeaturedTask
        key={task.key}
        task={task}
        isToday={task.insight.dateKey === todayKey}
        examKey={examKey}
        todayKey={todayKey}
        onOpen={openTask}
      />
    ) : (
      <CompactTask
        key={task.key}
        task={task}
        isToday={task.insight.dateKey === todayKey}
        onSelect={() => setSelectedTaskKey(task.key)}
        onOpen={openTask}
      />
    );

  return (
    <div className="mx-auto max-w-[1240px] space-y-7">
      {/* ===== Tiêu đề ===== */}
      <section className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <nav
            aria-label="Breadcrumb"
            className="mb-3 flex items-center gap-1.5 text-sm font-medium text-[var(--sp-muted)]"
          >
            <Link
              href="/study-plans"
              className="hover:text-[var(--sp-peri-dark)]"
            >

              {tx("Kế hoạch ôn thi")}
            </Link>
            <IconChevronRight size={14} />
            <span className="truncate text-[var(--sp-text-2)]">
              {plan.title}
            </span>
          </nav>

          <h1 className="flex flex-wrap items-end gap-x-3 text-[44px] sm:text-[56px]">
            <span>
              {titleHead && <>{titleHead} </>}
              <span className="sp-squiggle">{titleTail}</span>
            </span>
            <Sparkle
              size={26}
              className="sp-twinkle mb-4 text-[var(--sp-yellow)]"
            />
          </h1>

          <p className="mt-2 text-[15px] text-[var(--sp-muted)]">
            {materials.length > 0 && (
              <>

                {tx("Tạo từ")}{" "}
                <span className="font-semibold text-[var(--sp-ink)]">
                  {materials[0].file_name}
                </span>
                {materials.length > 1 &&
                  tx(" và {0} tài liệu khác", [materials.length - 1])}
                {" · "}
              </>
            )}
            {dailyLabel}
            {plan.study_days_per_week
              ? tx(" · {0} ngày/tuần", [plan.study_days_per_week])
              : ""}
          </p>
        </div>

        <div className="flex shrink-0 gap-3">
          <Link
            href="/study-plans"
            className="sp-btn sp-btn-primary px-5 py-3 text-[15px]"
          >
            <IconPlus size={18} />

            {tx("Tạo kế hoạch mới")}
          </Link>
        </div>
      </section>

      {/* ===== Kế hoạch đang khoá chờ bài tổng hợp 20 câu (L4) ===== */}
      {planLock?.locked && (
        <section
          role="alert"
          className="grid grid-cols-1 items-center gap-3 rounded-[24px] border-2 border-[var(--sp-red)] bg-[var(--sp-red-bg)] px-5 py-4 shadow-[4px_4px_0_var(--sp-red-line)] sm:grid-cols-[1fr_220px]"
        >
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-bold text-[var(--sp-red-dark)]">
              <IconLock size={18} className="shrink-0" />
              {tx("Kế hoạch đang tạm khoá")}
            </p>
            <p className="mt-1 text-sm text-[var(--sp-text-2)]">
              {lockedLesson
                ? tx("Bài kiểm tra lại của buổi {0} ({1}) chưa đạt 80%. Ôn lại buổi đó rồi làm bài tổng hợp 20 câu, xong sẽ mở khoá các buổi khác.", [
                    lockedLesson.lesson.order,
                    getTopicTitle(lockedLesson.topic),
                  ])
                : planLock.reason}
            </p>
          </div>
          {lockedLesson && (
            <Link href={lockedLesson.links.review} className="sp-btn sp-btn-primary w-full justify-center px-4 py-2.5 text-sm">
              {tx("Ôn lại ngay")}
              <IconArrowRight size={16} />
            </Link>
          )}
        </section>
      )}

      {ensureError && (
        <p role="alert" className="rounded-2xl border-2 border-[var(--sp-pink-line)] bg-white px-4 py-3 text-sm text-[var(--sp-pink-dark)]">
          {ensureError}
        </p>
      )}

      {/* ===== Banner thống kê ===== */}
      <section className="relative overflow-hidden rounded-[28px] bg-[var(--sp-purple)] px-6 py-6 text-white sm:px-8">
        <Sparkle
          size={30}
          className="sp-twinkle pointer-events-none absolute right-8 top-5 text-[var(--sp-pink)]"
        />
        <Sparkle
          size={16}
          className="pointer-events-none absolute right-20 top-16 text-[var(--sp-yellow)]"
        />

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0">
          <BannerStat icon={<IconFlag size={16} />} label={tx("Ngày thi")}>
            <p className="text-[30px] font-extrabold leading-tight">
              {formatFullDate(examKey)}
            </p>
            <p className="text-sm text-white/70">{weekdayLong(examKey)}</p>
          </BannerStat>

          <BannerStat icon={<IconClock size={16} />} label={tx("Còn lại")} divided>
            <p className="text-[30px] font-extrabold leading-tight">
              {daysLeft} <span className="text-lg font-semibold">{tx("ngày")}</span>
            </p>
            <p className="text-sm text-white/70">
              {stats.firstDateKey
                ? tx("Bắt đầu từ {0}", [formatDayMonth(stats.firstDateKey)])
                : tx("Chưa có lịch học")}
            </p>
          </BannerStat>

          <BannerStat
            icon={<IconChart size={16} />}
            label={tx("Tiến độ kế hoạch")}
            divided
          >
            <p className="text-[30px] font-extrabold leading-tight">
              {stats.percent}%
              <span className="ml-2 text-base font-semibold text-white/80">
                {tx("· {0}/{1} buổi", [stats.completedSessions, stats.totalSessions])}</span>
            </p>
            <div
              className="mt-2 h-2.5 w-full max-w-[260px] overflow-hidden rounded-full bg-white/15"
              role="progressbar"
              aria-label={tx("Tiến độ kế hoạch")}
              aria-valuenow={stats.percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-[var(--sp-yellow)] transition-all duration-500"
                style={{ width: `${stats.percent}%` }}
              />
            </div>
          </BannerStat>

          <BannerStat
            icon={<IconBook size={16} />}
            label={tx("Nội dung cần học")}
            divided
          >
            <p className="text-[30px] font-extrabold leading-tight">
              {stats.chapterCount}{" "}
              <span className="text-lg font-semibold">
                {stats.chapterUnit}
              </span>
            </p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <span className="sp-chip bg-white/15 text-white">
                {tx("{0}/{1} bài đã học", [stats.completedSessions, stats.totalSessions])}</span>
              {stats.lessonsNeedReview > 0 && (
                <span className="sp-chip bg-[var(--sp-pink)]/30 text-[#ffd3e2]">
                  {tx("{0} bài cần ôn lại", [stats.lessonsNeedReview])}</span>
              )}
            </div>
          </BannerStat>
        </div>
      </section>

      {/* ===== Hôm nay + Sắp tới ===== */}
      <div className="grid grid-cols-1 gap-7 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="sp-card-pop p-5 sm:p-7">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="sp-accent text-lg text-[var(--sp-pink)]">
                {`${weekdayLong(todayKey)}, ${formatDayMonth(todayKey)}`}
              </p>
              <h2 className="text-[26px] text-[var(--sp-ink)]">
                {todayPlan.isStudyDay ? tx("Hôm nay học gì?") : tx("Hôm nay không có lịch học")}
              </h2>
            </div>

            {todayPlan.learningSessions.length > 0 && (
              <span className="sp-chip bg-[var(--sp-surface-2)] text-[var(--sp-text-2)]">
                {todayPlan.learningSessions.length}  {tx("buổi ·")}{" "}
                {formatDuration(learningTotalMinutes)} · xong {learningDone}/
                {todayPlan.learningSessions.length}
              </span>
            )}
          </div>

          {!featured ? (
            <EmptyState hasSessions={insights.length > 0} />
          ) : (
            <div className="space-y-4">
              {[...openTasks, ...doneTasks].map((task) => renderTask(task))}

              {todayPlan.extras.length > 0 && (
                <div
                  role="alert"
                  className="rounded-[20px] border-2 border-[var(--sp-red)] bg-[var(--sp-red-bg)] p-4 shadow-[4px_4px_0_var(--sp-red-line)]"
                >
                  <p className="flex items-center gap-2 font-bold text-[var(--sp-red-dark)]">
                    <IconAlert size={18} />

                    {tx("Bắt buộc chọn ngày ôn cho")} {todayPlan.extras.length}  {tx("bài chưa đạt 80%")}
                  </p>
                  <ul className="mt-2 space-y-2">
                    {todayPlan.extras.map(({ insight }) => (
                      <li
                        key={insight.session.id}
                        className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-3 rounded-xl bg-white px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-[var(--sp-ink)]">{getTopicTitle(insight.topic)}</p>
                          <p className="text-xs text-[var(--sp-muted)]">
                            {tx("Buổi {0} {1}", [weekdayLong(insight.dateKey), formatDayMonth(insight.dateKey)])}
                          </p>
                        </div>
                        {insight.attempt ? (
                          <Link
                            href={`/quiz-results/${insight.attempt.attempt_id}`}
                            className="sp-btn sp-btn-primary w-[120px] px-0 py-2 text-[13px]"
                          >

                            {tx("Chọn ngày ôn")}
                          </Link>
                        ) : (
                          <span />
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {todayPlan.nextLearning && (
            <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl bg-[var(--sp-surface-2)] px-4 py-3 text-sm text-[var(--sp-text-2)]">
              <IconCalendar size={16} className="shrink-0 text-[var(--sp-peri-dark)]" />

              {tx("Buổi học kế tiếp:")}
              <span className="font-semibold text-[var(--sp-ink)]">
                {weekdayLong(todayPlan.nextLearning.dateKey)}, {formatDayMonth(todayPlan.nextLearning.dateKey)}
              </span>
              · {todayPlan.nextLearning.sessions.length}  {tx("buổi ·")} {formatDuration(nextLearningMinutes)}
            </p>
          )}
        </section>

        <UpcomingCard days={upcomingDays.days} restDays={upcomingDays.restDays} todayKey={todayKey} daysLeft={daysLeft} />
      </div>

      {/* ===== Lịch tháng ===== */}
      <section id="full-schedule" className="sp-card-pop scroll-mt-24 p-5 sm:p-7">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]">
            <IconCalendar size={20} />
          </span>
          <div>
            <h2 className="text-xl text-[var(--sp-ink)]">{tx("Toàn bộ lịch học")}</h2>
            <p className="text-sm text-[var(--sp-muted)]">

              {tx("Rê chuột (hoặc chạm) vào ngày có góc màu để xem buổi học, buổi ôn và vào học ngay.")}
            </p>
          </div>
        </div>

        {insights.length === 0 ? (
          <EmptyState hasSessions={false} />
        ) : (
          <StudyCalendar
            entries={calendarEntries}
            todayKey={todayKey}
            firstKey={insights[0].dateKey}
            lastKey={examKey}
          />
        )}
      </section>
    </div>
  );
}

/* ================= Thành phần con ================= */

function BannerStat({
  icon,
  label,
  divided = false,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  divided?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`min-w-0 lg:pr-5 ${
        divided ? "lg:border-l lg:border-white/15 lg:pl-7" : ""
      }`}
    >
      <p className="mb-1.5 flex items-center gap-2 text-sm font-medium text-white/75">
        {icon}
        {label}
      </p>
      {children}
    </div>
  );
}

/* ================= Sắp tới: dòng thời gian 4 ngày học tới ================= */

type UpcomingDay = { dateKey: string; items: SessionInsight[]; reviews: SessionInsight[] };

/* 140 → "2h20′", 45 → "45′" */
function shortMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}′`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)}h${rest ? `${String(rest).padStart(2, "0")}′` : ""}`;
}

function UpcomingCard({
  days,
  restDays,
  todayKey,
  daysLeft,
}: {
  days: UpcomingDay[];
  restDays: string[];
  todayKey: string;
  daysLeft: number;
}) {
  const [line, setLine] = useState(0);
  const minutesOf = (day: UpcomingDay) => day.items.reduce((sum, insight) => sum + (insight.session.duration_minutes || 0), 0);
  const lessonCount = days.reduce((sum, day) => sum + day.items.length, 0);
  const reviewCount = days.reduce((sum, day) => sum + day.reviews.length, 0);
  const totalMinutes = days.reduce((sum, day) => sum + minutesOf(day), 0);
  const tomorrow = addDays(todayKey, 1);
  const dayName = (key: string) => (key === tomorrow ? "Mai" : `${weekdayLong(key)} ${formatDayMonth(key)}`);

  // Câu Pilot nói: việc ngày gần nhất, ngày nặng nhất, đếm ngược ngày thi
  const lines: string[] = [];
  const first = days[0];
  if (first) {
    lines.push(
      first.items.length === 0 && first.reviews.length === 1
        ? tx("{0} mình ôn lại “{1}” nha, chỉ một bài thôi!", [dayName(first.dateKey), getTopicTitle(first.reviews[0].topic)])
        : tx("{0} có {1}, cố lên!", [dayName(first.dateKey), [
            first.items.length && tx("{0} bài mới", [first.items.length]),
            first.reviews.length && tx("{0} bài ôn", [first.reviews.length]),
          ]
            .filter(Boolean)
            .join(" + ")])
    );
  }
  const heaviest = [...days].sort((a, b) => minutesOf(b) - minutesOf(a))[0];
  if (heaviest && heaviest !== first && heaviest.items.length + heaviest.reviews.length >= 3) {
    lines.push(
      tx("{0} hơi nặng: {1} bài mới{2}. Nhớ ngủ sớm hôm trước nha!", [weekdayLong(heaviest.dateKey), heaviest.items.length, heaviest.reviews.length ? tx(" + {0} bài ôn", [heaviest.reviews.length]) : ""])
    );
  }
  lines.push(tx("Còn {0} ngày nữa là thi, mình đi cùng bạn!", [daysLeft]));

  return (
    <aside className="flex flex-col rounded-[24px] border-2 border-[var(--sp-purple-deep)] bg-white p-5 shadow-[6px_6px_0_var(--sp-lav-line)] sm:p-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
        <div>
          <p className="sp-accent text-[17px] text-[var(--sp-pink)]">{tx("{0} ngày học tới", [days.length])}</p>
          <h2 className="text-[22px] text-[var(--sp-ink)]">{tx("Sắp tới")}</h2>
        </div>
        <a href="#full-schedule" className="flex items-center gap-1 text-sm font-bold text-[var(--sp-peri-dark)] hover:underline">

          {tx("Cả lịch")} <IconArrowRight size={16} />
        </a>
      </div>

      {days.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-[var(--sp-surface-2)] p-5 text-sm text-[var(--sp-muted)]">

          {tx("Không còn buổi học nào phía trước. Hãy ôn lại các chương cần củng cố trước ngày thi.")}
        </p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              { value: lessonCount, label: tx("buổi học"), shadow: "var(--sp-lav-line)" },
              { value: reviewCount, label: tx("buổi ôn"), shadow: "var(--sp-pink-line)" },
              { value: shortMinutes(totalMinutes), label: tx("tổng giờ"), shadow: "#f3dc9b" },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-[14px] border-2 border-[var(--sp-purple-deep)] px-2.5 py-1.5"
                style={{ boxShadow: `2px 2px 0 ${stat.shadow}` }}
              >
                <p className="text-[19px] font-extrabold leading-tight text-[var(--sp-purple)]">{stat.value}</p>
                <p className="text-[11.5px] font-bold text-[var(--sp-muted)]">{stat.label}</p>
              </div>
            ))}
          </div>

          <ol className="relative mt-4 space-y-3.5 before:absolute before:bottom-3 before:left-[25px] before:top-3 before:border-l-2 before:border-dashed before:border-[var(--sp-lav-line)]">
            {days.map((day, index) => {
              const next = index === 0;
              const minutes = minutesOf(day);
              return (
                <li key={day.dateKey} className="relative grid grid-cols-[52px_minmax(0,1fr)] items-start gap-3">
                  <div
                    className={`relative z-[1] grid h-14 content-center justify-items-center rounded-[15px] border-2 border-[var(--sp-purple-deep)] ${
                      next ? "bg-[var(--sp-yellow)] shadow-[3px_3px_0_var(--sp-pink)]" : "bg-white shadow-[2px_2px_0_var(--sp-lav-line)]"
                    }`}
                  >
                    <span className={`text-[11px] font-extrabold uppercase leading-none ${next ? "text-[var(--sp-purple-deep)]" : "text-[var(--sp-muted)]"}`}>
                      {day.dateKey === addDays(todayKey, 1) ? "Mai" : weekdayShort(day.dateKey)}
                    </span>
                    <span className="text-[16px] font-extrabold leading-tight text-[var(--sp-purple)]">{formatDayMonth(day.dateKey)}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="mb-1.5 mt-0.5 flex items-center justify-between gap-2 text-[12px] font-extrabold text-[var(--sp-muted)]">
                      {weekdayLong(day.dateKey)}
                      <span className={day.items.length === 0 ? "text-[var(--sp-pink-dark)]" : ""}>
                        {[minutes > 0 && formatDuration(minutes), day.reviews.length > 0 && tx("{0} buổi ôn", [day.reviews.length])]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </p>
                    <ul className="space-y-1.5">
                      {day.items.map((insight) => (
                        <li
                          key={insight.session.id}
                          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border-2 border-l-[5px] border-[var(--sp-lav-line)] border-l-[var(--sp-peri)] bg-white px-2.5 py-1.5 transition hover:-translate-x-px hover:-translate-y-px hover:shadow-[3px_3px_0_var(--sp-lav-line)]"
                        >
                          <span className="line-clamp-2 text-[13.5px] font-bold leading-snug text-[var(--sp-ink)]" title={getTopicTitle(insight.topic)}>
                            {getTopicTitle(insight.topic)}
                          </span>
                          <span className="whitespace-nowrap rounded-full bg-[var(--sp-lav)] px-2 py-0.5 text-[11.5px] font-extrabold tabular-nums text-[var(--sp-peri-dark)]">
                            {insight.session.duration_minutes}′
                          </span>
                        </li>
                      ))}
                      {day.reviews.map((insight) => (
                        <li
                          key={`review-${insight.session.id}`}
                          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border-2 border-l-[5px] border-[var(--sp-pink-line)] border-l-[var(--sp-pink)] bg-[var(--sp-pink-bg)] px-2.5 py-1.5"
                        >
                          <span className="line-clamp-2 text-[13.5px] font-bold leading-snug text-[var(--sp-ink)]" title={getTopicTitle(insight.topic)}>
                            <span className="text-[var(--sp-pink-dark)]">{tx("↻ Ôn lại ·")} </span>
                            {getTopicTitle(insight.topic)}
                          </span>
                          {/* Vào ôn được ngay, không cần đợi tới ngày đã chọn (L3) */}
                          <Link
                            href={insight.links.review}
                            aria-disabled={insight.lesson.next.locked}
                            title={insight.lesson.next.lockReason || tx("Vào ôn ngay")}
                            className={`rounded-full bg-[var(--sp-pink)] px-2.5 py-0.5 text-[11.5px] font-extrabold text-white hover:bg-[var(--sp-pink-dark)] ${
                              insight.lesson.next.locked ? "pointer-events-none opacity-50" : ""
                            }`}
                          >
                            {tx("Vào ôn")}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                </li>
              );
            })}
          </ol>

          {restDays.length > 0 && (
            <p className="mt-3 flex items-center gap-2 text-[12.5px] font-semibold text-[var(--sp-muted)]">
              <IconMoon size={15} className="shrink-0" />
              {restDays.map((key) => `${weekdayLong(key)} ${formatDayMonth(key)}`).join(", ")}  {tx("nghỉ")}
            </p>
          )}
        </>
      )}

      {/* Pilot nhắc việc sắp tới: lấp chỗ trống cuối thẻ */}
      <div className="mt-auto grid grid-cols-[72px_minmax(0,1fr)] items-end gap-2.5 pt-4">
        <button
          type="button"
          aria-label={tx("Bấm để Pilot nói câu khác")}
          onClick={() => setLine((value) => (value + 1) % lines.length)}
          className="h-[72px] w-[72px]"
        >
          <PilotMascot size={72} />
        </button>
        <p
          key={line}
          className="sp-hero-bubble mb-3.5 rounded-[14px_14px_14px_4px] border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-lav)] px-3 py-2 text-[13px] font-bold leading-snug text-[var(--sp-ink)] shadow-[3px_3px_0_var(--sp-pink-line)] before:hidden"
          role="status"
        >
          {lines[line % lines.length]}
        </p>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t-2 border-dashed border-[var(--sp-line)] pt-3 text-[12.5px] font-semibold text-[var(--sp-text-2)]">
        <Legend color="var(--sp-peri)" label={tx("Học mới")} />
        <Legend color="var(--sp-pink)" label={tx("Ôn lại")} />
        <Legend color="var(--sp-yellow)" label={tx("Ngày gần nhất")} />
      </div>
    </aside>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function EmptyState({ hasSessions }: { hasSessions: boolean }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-[var(--sp-line)] bg-[var(--sp-surface-2)] px-6 py-10 text-center">
      <Sparkle size={24} className="mx-auto mb-3 text-[var(--sp-yellow)]" />
      <p className="font-bold text-[var(--sp-ink)]">
        {hasSessions
          ? tx("Bạn đã hoàn thành mọi buổi học")
          : tx("Lộ trình chưa được tạo")}
      </p>
      <p className="mx-auto mt-1 max-w-md text-sm text-[var(--sp-muted)]">
        {hasSessions
          ? tx("Hãy làm lại Quiz hoặc ôn Flashcard để giữ kiến thức trước ngày thi.")
          : tx("Sau khi AI phân tích tài liệu, StudyPilot sẽ chia các bài thành từng buổi học theo thời gian của bạn.")}
      </p>
    </div>
  );
}

function isLocked(session: StudySession) {
  if (session.status === "in_progress" || session.status === "completed") {
    return false;
  }
  return session.is_unlocked === false;
}

function getTaskAction(task: TodayTask) {
  const { insight } = task;

  if (task.kind === "review") {
    // Một nút "việc tiếp theo" giống mọi trang: Chọn ngày ôn / Vào ôn / Làm bài kiểm tra lại / bài tổng hợp
    const next = insight.lesson.next;
    if (next.href && ["pick_date", "review", "retake", "final"].includes(next.kind)) {
      return { href: next.href, label: next.label };
    }
    return { href: insight.links.review, label: tx("Vào ôn") };
  }

  if (task.kind === "quiz") {
    // Chưa có quiz → "ensure:<buổi>": trang tự tạo bù rồi mở (L1)
    return insight.quizId
      ? { href: `/quizzes/${insight.quizId}`, label: tx("Làm bài kiểm tra") }
      : { href: `ensure:${insight.session.id}`, label: tx("Làm bài kiểm tra") };
  }

  const status = insight.session.status;
  if (status === "completed") return { href: insight.links.revisit, label: tx("Xem lại") };
  return {
    href: insight.links.learn,
    label: status === "in_progress" ? tx("Học tiếp") : tx("Vào học"),
  };
}

const TASK_STYLE: Record<
  TaskKind,
  { label: string; chip: string; icon: React.ReactNode }
> = {
  review: {
    label: tx("Ôn lại"),
    chip: "border border-[var(--sp-pink-line)] bg-white text-[var(--sp-pink-dark)]",
    icon: <IconRepeat size={14} />,
  },
  quiz: {
    label: tx("Kiểm tra"),
    chip: "bg-[var(--sp-purple)] text-white",
    icon: <IconPen size={14} />,
  },
  learn: {
    label: tx("Học mới"),
    chip: "bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]",
    icon: <IconBook size={14} />,
  },
};

function TaskReason({ task }: { task: TodayTask }) {
  const { insight } = task;

  if (insight.lesson.next.locked) {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-sm text-[var(--sp-red-dark)]">
        <IconLock size={14} className="shrink-0" />
        {tx("Tạm khoá: làm xong bài tổng hợp 20 câu để mở")}
      </p>
    );
  }

  if (insight.lesson.next.kind === "final") {
    return (
      <p className="mt-1.5 text-sm font-medium text-[var(--sp-red-dark)]">
        {tx("Bài kiểm tra lại chưa đạt 80%: ôn lại rồi làm bài tổng hợp 20 câu để mở khoá kế hoạch.")}
      </p>
    );
  }

  if (task.kind === "review") {
    return <ReviewOrigin insight={insight} withDateLink />;
  }

  if (task.kind === "quiz") {
    return (
      <p className="mt-1.5 text-sm text-[var(--sp-muted)]">

        {tx("Bạn đã vào học buổi này: nộp bài kiểm tra cuối buổi để hoàn thành.")}
      </p>
    );
  }

  if (isLocked(insight.session)) {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-sm text-[var(--sp-muted)]">
        <IconLock size={14} className="shrink-0" />
        {insight.session.lock_reason ||
          tx("Hoàn thành các buổi trước để mở khóa")}
      </p>
    );
  }

  if (task.overdue) {
    return (
      <p className="mt-1.5 text-sm font-medium text-[var(--sp-amber-dark)]">
        {tx("Trễ lịch từ {0}, nên học bù hôm nay", [formatDayMonth(insight.dateKey)])}</p>
    );
  }

  const chapter = getChapter(insight.topic);
  return chapter ? (
    <p className="mt-1.5 truncate text-sm text-[var(--sp-muted)]">
      {chapter}
    </p>
  ) : null;
}

function FeaturedTask({
  task,
  isToday,
  examKey,
  todayKey,
  onOpen,
}: {
  task: TodayTask;
  isToday: boolean;
  examKey: string;
  todayKey: string;
  onOpen: (href: string) => void;
}) {
  const { insight } = task;
  const style = TASK_STYLE[task.kind];
  const action = getTaskAction(task);
  const locked = (task.kind === "learn" && isLocked(insight.session)) || insight.lesson.next.locked;
  const isReview = task.kind === "review";
  const reviewStyle = isReview ? urgencyStyle(insight.urgency) : null;

  return (
    <article
      className={`sp-task-expand relative rounded-[20px] p-5 sm:p-6 ${
        reviewStyle ? reviewStyle.card : "border border-[var(--sp-lav-line)] bg-[var(--sp-lav)]"
      }`}
    >
      {isToday && (
        <span className="absolute -top-2.5 left-5 rounded-full bg-[var(--sp-pink)] px-2.5 py-0.5 text-[11px] font-bold text-white">

          {tx("Hôm nay")}
        </span>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div
          className={`flex shrink-0 items-baseline gap-2 sm:w-[92px] sm:flex-col sm:items-center sm:gap-0 sm:border-r-2 sm:border-dashed sm:pr-5 ${
            reviewStyle ? reviewStyle.divider : "sm:border-[var(--sp-lav-line)]"
          }`}
        >
          <p className="text-[40px] font-extrabold leading-none text-[var(--sp-purple)]">
            {insight.session.duration_minutes}
          </p>
          <p className="text-sm font-semibold text-[var(--sp-muted)]">{tx("phút")}</p>
        </div>

        <div className="min-w-0 flex-1">
          {isReview && insight.urgency ? (
            <UrgencyChip urgency={insight.urgency} />
          ) : (
            <span className={`sp-chip ${style.chip}`}>
              {style.icon}
              {style.label}
            </span>
          )}
          <h3 className="mt-2 text-[21px] text-[var(--sp-ink)]">
            {getTopicTitle(insight.topic)}
          </h3>
          <TaskReason task={task} />
        </div>

        <button
          type="button"
          disabled={locked}
          onClick={() => onOpen(action.href)}
          className="sp-btn sp-btn-primary shrink-0 px-6 py-3 text-[15px]"
        >
          {locked ? <IconLock size={17} /> : <IconPlay size={17} />}
          {locked ? (insight.lesson.next.locked ? tx("Đang khoá") : tx("Chưa mở khóa")) : action.label}
        </button>
      </div>

      <Journey
        insight={insight}
        examKey={examKey}
        todayKey={todayKey}
        focus={task.kind}
      />
    </article>
  );
}

function CompactTask({
  task,
  isToday,
  onSelect,
  onOpen,
}: {
  task: TodayTask;
  isToday: boolean;
  onSelect: () => void;
  onOpen: (href: string) => void;
}) {
  const { insight } = task;
  const style = TASK_STYLE[task.kind];
  const action = getTaskAction(task);
  const locked = (task.kind === "learn" && isLocked(insight.session)) || insight.lesson.next.locked;
  const done =
    task.kind === "learn" && insight.session.status === "completed";
  const reviewStyle = task.kind === "review" ? urgencyStyle(insight.urgency) : null;

  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={tx("Xem hành trình: {0}", [getTopicTitle(insight.topic)])}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={`group relative flex cursor-pointer flex-col gap-4 rounded-[20px] p-5 transition hover:-translate-y-0.5 hover:shadow-[4px_4px_0_var(--sp-lav-line)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sp-peri)] sm:flex-row sm:items-center ${
        reviewStyle
          ? reviewStyle.card
          : "border-2 border-[var(--sp-line)] bg-white hover:border-[var(--sp-lav-line)]"
      } ${done ? "opacity-70 hover:opacity-100" : ""}`}
    >
      {isToday && (
        <span className="absolute -top-2.5 left-5 rounded-full bg-[var(--sp-pink)] px-2.5 py-0.5 text-[11px] font-bold text-white">

          {tx("Hôm nay")}
        </span>
      )}
      <div className="flex shrink-0 items-baseline gap-2 sm:w-[92px] sm:flex-col sm:items-center sm:gap-0 sm:border-r-2 sm:border-dashed sm:border-[var(--sp-line)] sm:pr-5">
        <p className="text-[32px] font-extrabold leading-none text-[var(--sp-purple)]">
          {insight.session.duration_minutes}
        </p>
        <p className="text-sm font-semibold text-[var(--sp-muted)]">{tx("phút")}</p>
      </div>

      <div className="min-w-0 flex-1">
        {reviewStyle && insight.urgency ? (
          <UrgencyChip urgency={insight.urgency} />
        ) : (
          <span className={`sp-chip ${style.chip}`}>
            {done ? <IconCheck size={14} /> : style.icon}
            {done ? tx("Đã xong") : style.label}
          </span>
        )}
        <h3 className="mt-2 text-lg text-[var(--sp-ink)]">
          {getTopicTitle(insight.topic)}
        </h3>
        <TaskReason task={task} />
        <p className="mt-2 flex items-center gap-1 text-xs font-bold text-[var(--sp-peri-dark)] opacity-70 transition group-hover:opacity-100">

          {tx("Bấm để xem hành trình")}
          <IconChevronDown size={14} className="transition group-hover:translate-y-0.5" />
        </p>
      </div>

      <button
        type="button"
        disabled={locked}
        onClick={(event) => {
          event.stopPropagation();
          onOpen(action.href);
        }}
        className="sp-btn sp-btn-secondary shrink-0 px-5 py-2.5 text-sm"
      >
        {locked && <IconLock size={15} />}
        {locked ? (insight.lesson.next.locked ? tx("Đang khoá") : tx("Chưa mở khóa")) : action.label}
      </button>
    </article>
  );
}

/*
 * Hành trình của một bài: Học → Kiểm tra → (Ôn tập) → Ngày thi.
 * Chỉ hiển thị các mốc có thật trong dữ liệu.
 */
function Journey({
  insight,
  examKey,
  todayKey,
  focus,
}: {
  insight: SessionInsight;
  examKey: string;
  todayKey: string;
  focus: TaskKind;
}) {
  type StepState = "done" | "current" | "todo" | "warn" | "exam";
  type Step = {
    key: string;
    title: string;
    caption: string;
    dateKey: string | null;
    state: StepState;
    icon: React.ReactNode;
  };

  const { session, attempt } = insight;
  const learned = session.status === "completed";
  const attemptKey = attempt?.submitted_at
    ? toDateKey(attempt.submitted_at)
    : null;
  const failed = attempt !== null && !insight.passed;

  const steps: Step[] = [
    {
      key: "learn",
      title:
        insight.dateKey === todayKey
          ? tx("Hôm nay")
          : formatDayMonth(insight.dateKey),
      caption: learned ? tx("Đã học") : tx("Học lần đầu"),
      dateKey: insight.dateKey,
      state: learned ? "done" : focus === "learn" ? "current" : "todo",
      icon: learned ? <IconCheck size={18} /> : <IconBook size={18} />,
    },
    {
      key: "quiz",
      title: attemptKey
        ? formatDayMonth(attemptKey)
        : focus === "quiz"
          ? tx("Hôm nay")
          : "Quiz",
      caption: attempt
        ? tx("Đúng {0}/{1} câu", [attempt.correct_count ?? 0, attempt.total_questions ?? 0])
        : tx("Kiểm tra"),
      dateKey: attemptKey,
      state: attempt
        ? insight.passed
          ? "done"
          : "warn"
        : focus === "quiz"
          ? "current"
          : "todo",
      icon: attempt ? (
        insight.passed ? (
          <IconCheck size={18} />
        ) : (
          <IconAlert size={17} />
        )
      ) : (
        <IconPen size={17} />
      ),
    },
  ];

  if (failed) {
    const reviewDone = !insight.pendingReviewId;
    steps.push({
      key: "review",
      title: reviewDone ? tx("Đã ôn") : tx("Hôm nay"),
      caption: reviewDone ? tx("Ôn tập xong") : tx("Ôn lại"),
      dateKey: reviewDone ? null : todayKey,
      state: reviewDone ? "done" : "current",
      icon: reviewDone ? <IconCheck size={18} /> : <IconRepeat size={18} />,
    });
  }

  steps.push({
    key: "exam",
    title: formatDayMonth(examKey),
    caption: tx("Ngày thi"),
    dateKey: examKey,
    state: "exam",
    icon: <IconFlag size={17} />,
  });

  const circleStyle: Record<StepState, string> = {
    done: "border-[var(--sp-peri)] bg-[var(--sp-peri)] text-white",
    current:
      "border-[var(--sp-pink)] bg-[var(--sp-pink)] text-white shadow-[0_0_0_5px_rgba(224,69,123,0.18)]",
    todo: "border-dashed border-[var(--sp-lav-line)] bg-white text-[var(--sp-soft)]",
    warn: "border-[var(--sp-pink)] bg-white text-[var(--sp-pink)]",
    exam: "border-[var(--sp-purple)] bg-[var(--sp-purple)] text-[var(--sp-yellow)]",
  };

  return (
    <div className="mt-5 rounded-2xl border border-[var(--sp-line)] bg-white p-4 sm:p-5">
      <p className="mb-5 flex items-center gap-2 text-[15px] font-bold text-[var(--sp-purple)]">
        <IconRepeat size={17} />

        {tx("Hành trình của bài này")}
      </p>

      <ol className="flex items-start overflow-x-auto pb-1 pt-3">
        {steps.map((step, index) => {
          const next = steps[index + 1];
          const gap =
            next && step.dateKey && next.dateKey
              ? daysBetween(step.dateKey, next.dateKey)
              : null;

          return (
            <li
              key={step.key}
              className={`flex items-start ${next ? "min-w-[150px] flex-1" : "shrink-0"}`}
            >
              <div className="flex w-[96px] shrink-0 flex-col items-center text-center">
                <span
                  className={`flex h-11 w-11 items-center justify-center rounded-full border-2 ${circleStyle[step.state]}`}
                >
                  {step.icon}
                </span>
                <span
                  className={`mt-2 text-[14.5px] font-bold ${
                    step.state === "current"
                      ? "text-[var(--sp-pink-dark)]"
                      : "text-[var(--sp-ink)]"
                  }`}
                >
                  {step.title}
                </span>
                <span className="text-[13px] leading-tight text-[var(--sp-muted)]">
                  {step.caption}
                </span>
              </div>

              {next && (
                <div className="relative mt-[21px] min-w-[40px] flex-1">
                  <span
                    className={`block w-full ${
                      step.state === "done"
                        ? "h-0.5 bg-[var(--sp-peri)]"
                        : "border-t-2 border-dashed border-[var(--sp-lav-line)]"
                    }`}
                  />
                  {gap !== null && gap > 0 && (
                    <span className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs font-bold text-[var(--sp-peri-dark)]">
                      {tx("+{0} ngày", [gap])}</span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ---------- Mức ôn lại: màu, nhãn, nguồn gốc ---------- */

const URGENCY_STYLE: Record<
  ReviewLevel,
  { card: string; divider: string; chip: string; text: string; row: string; icon: React.ReactNode }
> = {
  urgent: {
    card: "border-2 border-[var(--sp-red)] bg-[var(--sp-red-bg)]",
    divider: "sm:border-[var(--sp-red-line)]",
    chip: "bg-[var(--sp-red)] text-white",
    text: "text-[var(--sp-red-dark)]",
    row: "bg-[var(--sp-red-bg)]",
    icon: <IconAlert size={14} />,
  },
  unscheduled: {
    card: "border-2 border-[var(--sp-amber-dark)]/25 bg-[var(--sp-amber-bg)]",
    divider: "sm:border-[var(--sp-amber-dark)]/25",
    chip: "border border-[var(--sp-amber-dark)]/30 bg-white text-[var(--sp-amber-dark)]",
    text: "text-[var(--sp-amber-dark)]",
    row: "bg-[var(--sp-amber-bg)]/60",
    icon: <IconCalendar size={14} />,
  },
  due: {
    card: "border-2 border-[var(--sp-pink)] bg-[var(--sp-pink-bg)]",
    divider: "sm:border-[var(--sp-pink-line)]",
    chip: "bg-[var(--sp-pink)] text-white",
    text: "text-[var(--sp-pink-dark)]",
    row: "bg-[var(--sp-pink-bg)]",
    icon: <IconRepeat size={14} />,
  },
  scheduled: {
    card: "border-2 border-[var(--sp-line)] bg-[var(--sp-surface-2)]",
    divider: "sm:border-[var(--sp-line)]",
    chip: "border border-[var(--sp-line)] bg-white text-[var(--sp-text-2)]",
    text: "text-[var(--sp-peri-dark)]",
    row: "bg-[var(--sp-surface-2)]",
    icon: <IconCalendar size={14} />,
  },
};

function urgencyStyle(urgency: ReviewUrgency | null) {
  const style = URGENCY_STYLE[urgency?.level || "unscheduled"];
  // Chưa chọn lịch 4–7 ngày: viền đậm hơn
  return urgency?.level === "unscheduled" && urgency.strong
    ? { ...style, card: "border-2 border-[var(--sp-amber-dark)]/70 bg-[var(--sp-amber-bg)]" }
    : style;
}

function UrgencyChip({ urgency }: { urgency: ReviewUrgency }) {
  const style = urgencyStyle(urgency);
  return (
    <span className={`sp-chip ${style.chip}`}>
      {urgency.level === "urgent" ? (
        <span aria-hidden className="sp-urgent-dot h-2 w-2 rounded-full bg-white" />
      ) : (
        style.icon
      )}
      {urgency.label}
    </span>
  );
}

function attemptPercent(attempt: QuizAttempt) {
  return Number(attempt.total_questions)
    ? Math.round((Number(attempt.correct_count || 0) / Number(attempt.total_questions)) * 100)
    : Math.round(Number(attempt.score || 0));
}

/* "Kiến thức của buổi học Thứ Hai 16/11 · Quiz 0/10 (0%) · Yếu, dưới 50%" */
function ReviewOrigin({
  insight,
  compact = false,
  withDateLink = false,
}: {
  insight: SessionInsight;
  compact?: boolean;
  withDateLink?: boolean;
}) {
  const attempt = insight.attempt;
  const percent = attempt ? attemptPercent(attempt) : null;
  const level = percent !== null ? scoreLevel(percent) : null;
  const band = level && level !== "pass" ? { weak: level === "weak", label: levelLabel(level) } : null;
  return (
    <>
      <p className={compact ? "text-xs text-[var(--sp-muted)]" : "mt-1.5 text-sm text-[var(--sp-text-2)]"}>

        {tx("Kiến thức của buổi học")} {weekdayLong(insight.dateKey)} {formatDayMonth(insight.dateKey)}
        {attempt &&
          ` · Quiz ${attempt.correct_count ?? 0}/${attempt.total_questions ?? 0} (${percent}%)`}
        {band && (
          <>
            {" · "}
            <span
              className={`font-semibold ${
                band.weak ? "text-[var(--sp-red-dark)]" : "text-[var(--sp-amber-dark)]"
              }`}
            >
              {band.label}
            </span>
          </>
        )}
      </p>
      {withDateLink && attempt && (
        <Link
          href={`/quiz-results/${attempt.attempt_id}`}
          onClick={(event) => event.stopPropagation()}
          className="mt-1.5 inline-flex items-center gap-1 text-xs font-bold text-[var(--sp-peri-dark)] hover:underline"
        >
          <IconCalendar size={13} />
          {insight.reviewDate ? tx("Đổi ngày ôn") : tx("Chọn ngày ôn")}
        </Link>
      )}
    </>
  );
}

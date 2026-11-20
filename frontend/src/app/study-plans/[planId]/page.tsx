"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { SmartLoading } from "@/components/loading-play";
import { getMainTopicTitle } from "@/lib/content-titles";
import StudyCalendar from "@/components/study-calendar";
import type { CalendarEntry } from "@/lib/study-calendar";
import {
  getReviewUrgency,
  scoreBand,
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
  review_plan_id?: string | null;
  review_status?: string | null;
  review_date?: string | null;
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

const PASS_SCORE = 50;
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
  const label = keyToDate(dateKey).toLocaleDateString("vi-VN", {
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
    return `${minutes} phút`;
  }

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} giờ ${rest} phút` : `${hours} giờ`;
}

/* ================= Tiện ích chủ đề ================= */

function getChapter(topic: Topic | undefined) {
  return String(topic?.hierarchy || "")
    .split(">")[0]
    .trim();
}

function getTopicTitle(topic: Topic | undefined) {
  return topic ? getMainTopicTitle(topic.name) : "Chủ đề chưa xác định";
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
            planResult.detail || "Không thể tải kế hoạch ôn thi."
          );
        }

        const currentPlan = (planResult.data || []).find(
          (item: ExamPlan) => item.id === planId
        );

        if (!currentPlan) {
          throw new Error("Không tìm thấy kế hoạch ôn thi.");
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
            topicResult.detail || "Không thể tải danh sách chủ đề."
          );
        }

        if (!sessionResponse.ok) {
          throw new Error(sessionResult.detail || "Không thể tải lịch học.");
        }

        setTopics(topicResult.data || []);
        setSessions(sessionResult.data || []);

        // Dữ liệu phụ: lỗi ở đây không chặn việc hiển thị lịch học.
        const [materialResult, quizResult, attemptResult] =
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
          ]);

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
            : "Đã xảy ra lỗi khi tải dữ liệu."
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

    for (const quiz of quizzes) {
      if (!quiz.study_session_id) continue;

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
        const score = Number(attempt?.score ?? 0);
        const failed = attempt !== null && score < PASS_SCORE;

        let pendingReviewId: string | null = null;
        const retakeQuiz = retakeBySession.get(session.id);

        // Bài kiểm tra lại chỉ được tạo khi dưới 80%: còn bài chưa đạt là còn buổi ôn.
        if (retakeQuiz?.review_plan_id && retakeQuiz.review_status !== "completed") {
          pendingReviewId = retakeQuiz.review_plan_id;
        } else if (
          failed &&
          !retakeQuiz &&
          attempt?.review_plan &&
          attempt.review_plan.status !== "completed"
        ) {
          pendingReviewId = attempt.review_plan.id;
        }

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
          passed: attempt !== null && score >= PASS_SCORE,
          pendingReviewId,
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
  }, [sessions, quizzes, attempts, topicById, todayKey, plan]);

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
    const overdueLearning = insights.filter(
      (insight) => insight.dateKey < todayKey && insight.session.status !== "completed"
    );
    // Khẩn trước, cùng mức thì điểm thấp trước
    const reviews = insights
      .filter((insight) => insight.pendingReviewId && insight.urgency)
      .sort(
        (a, b) =>
          a.urgency!.rank - b.urgency!.rank ||
          (a.currentScore ?? 0) - (b.currentScore ?? 0)
      );
    // Đã có lịch và tới ngày (hoặc trễ, hoặc khẩn vì sát ngày thi)
    const dueReviews = reviews.filter(
      (insight) =>
        insight.reviewDate &&
        (insight.reviewDate <= todayKey || insight.urgency!.level === "urgent")
    );
    const unscheduled = reviews.filter((insight) => !insight.reviewDate);
    const quizTasks: TodayTask[] = insights
      .filter(
        (insight) =>
          insight.session.status === "in_progress" && insight.quizId && !insight.attempt
      )
      .map((insight) => ({
        key: `quiz-${insight.session.id}`,
        kind: "quiz",
        insight,
        overdue: false,
      }));

    const tasks: TodayTask[] = isStudyDay
      ? [
          ...overdueLearning.map((insight) => learn(insight, true)),
          ...todayLearning.map((insight) => learn(insight, false)),
          ...quizTasks,
          ...dueReviews.map((insight) => review(insight)),
        ]
      : [
          ...dueReviews.map((insight) => review(insight)),
          ...quizTasks,
          ...overdueLearning.map((insight) => learn(insight, true)),
        ];

    const nextKey = isStudyDay
      ? null
      : insights.find((insight) => insight.dateKey > todayKey)?.dateKey || null;

    return {
      tasks,
      extras: unscheduled.map((insight) => review(insight, true)),
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
      chapterUnit: hasChapterNames ? "chương" : "chủ đề",
      chaptersDone: chapterList.filter(
        (chapter) => chapter.total > 0 && chapter.done === chapter.total
      ).length,
      chaptersNeedReview: chapterList.filter((chapter) => chapter.needsReview)
        .length,
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
      const band = percent !== null && percent < 80 ? scoreBand(percent) : null;
      const reviewOn = insight.reviewDate || insight.doneReviewDate;
      entries.push({
        key: `learn-${insight.session.id}`,
        kind: "learn",
        dateKey: insight.dateKey,
        title: getTopicTitle(insight.topic),
        done,
        lines: [
          { text: `Học mới · ${insight.session.duration_minutes} phút` },
          done && attempt
            ? {
                text: `Quiz ${attempt.correct_count ?? 0}/${attempt.total_questions ?? 0} (${percent}%)${band ? ` · ${band.weak ? "Yếu" : "Cần củng cố"}` : " · Đạt"}`,
                tone: band ? (band.weak ? "weak" : "mid") : undefined,
              }
            : { text: insight.session.status === "in_progress" ? "Đang học, chưa nộp bài kiểm tra" : "Chưa học" },
          ...(reviewOn ? [{ text: `Đã đặt lịch ôn ${formatDayMonth(reviewOn)}` }] : []),
        ],
        action: done
          ? { kind: "revisit", href: insight.links.revisit }
          : { kind: "learn", href: insight.links.learn, locked: isLocked(insight.session) },
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
            { text: `Từ buổi ${weekdayLong(insight.dateKey)} ${formatDayMonth(insight.dateKey)}` },
            {
              text: `Quiz ${attempt.correct_count ?? 0}/${attempt.total_questions ?? 0} (${percent}%) · ${band?.weak ? "Yếu" : "Cần củng cố"}`,
              tone: band?.weak ? "weak" : "mid",
            },
            {
              text: reviewDone
                ? "Đã ôn xong, đạt từ 80%"
                : late
                  ? `Trễ lịch ôn ${daysBetween(reviewKey, todayKey)} ngày`
                  : reviewKey === todayKey
                    ? "Đến hạn hôm nay"
                    : "Đã lên lịch",
            },
          ],
          action: reviewDone
            ? { kind: "revisit", href: insight.links.revisit }
            : { kind: "review", href: insight.links.review },
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
        lines: [{ text: `Còn ${Math.max(0, daysBetween(todayKey, toDateKey(plan.exam_date)))} ngày` }],
      });
    }
    return entries;
  }, [insights, plan, todayKey]);

  /* ---------- Trạng thái tải ---------- */

  if (isLoading || holdLoading) {
    return (
      <SmartLoading
        text="Đang tải lộ trình ôn tập…"
        sub="Pilot đang xếp lịch học và lịch ôn của bạn."
        stages={["Tải kế hoạch", "Xếp buổi học", "Gắn lịch ôn", "Vẽ lịch tháng"]}
        continueLabel="Xem kế hoạch"
        done={!isLoading}
        onHoldChange={setHoldLoading}
      />
    );
  }

  if (error || !plan) {
    return (
      <div className="sp-card mx-auto max-w-3xl p-8">
        <p className="text-sm font-medium text-[var(--sp-pink-dark)]">
          {error || "Không tìm thấy kế hoạch."}
        </p>
        <button
          type="button"
          onClick={() => router.push("/study-plans")}
          className="sp-btn sp-btn-primary mt-5 px-5 py-2.5 text-sm"
        >
          Quay lại kế hoạch
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
    ? `${dailyHours} giờ/ngày`
    : `${plan.daily_available_minutes} phút/ngày`;

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

  const renderTask = (task: TodayTask) =>
    featured && task.key === featured.key ? (
      <FeaturedTask
        key={task.key}
        task={task}
        isToday={task.insight.dateKey === todayKey}
        examKey={examKey}
        todayKey={todayKey}
        onOpen={(href) => router.push(href)}
      />
    ) : (
      <CompactTask
        key={task.key}
        task={task}
        isToday={task.insight.dateKey === todayKey}
        onSelect={() => setSelectedTaskKey(task.key)}
        onOpen={(href) => router.push(href)}
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
              Kế hoạch ôn thi
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
                Tạo từ{" "}
                <span className="font-semibold text-[var(--sp-ink)]">
                  {materials[0].file_name}
                </span>
                {materials.length > 1 &&
                  ` và ${materials.length - 1} tài liệu khác`}
                {" · "}
              </>
            )}
            {dailyLabel}
            {plan.study_days_per_week
              ? ` · ${plan.study_days_per_week} ngày/tuần`
              : ""}
          </p>
        </div>

        <div className="flex shrink-0 gap-3">
          <Link
            href="/study-plans"
            className="sp-btn sp-btn-primary px-5 py-3 text-[15px]"
          >
            <IconPlus size={18} />
            Tạo kế hoạch mới
          </Link>
        </div>
      </section>

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
          <BannerStat icon={<IconFlag size={16} />} label="Ngày thi">
            <p className="text-[30px] font-extrabold leading-tight">
              {formatFullDate(examKey)}
            </p>
            <p className="text-sm text-white/70">{weekdayLong(examKey)}</p>
          </BannerStat>

          <BannerStat icon={<IconClock size={16} />} label="Còn lại" divided>
            <p className="text-[30px] font-extrabold leading-tight">
              {daysLeft} <span className="text-lg font-semibold">ngày</span>
            </p>
            <p className="text-sm text-white/70">
              {stats.firstDateKey
                ? `Bắt đầu từ ${formatDayMonth(stats.firstDateKey)}`
                : "Chưa có lịch học"}
            </p>
          </BannerStat>

          <BannerStat
            icon={<IconChart size={16} />}
            label="Tiến độ kế hoạch"
            divided
          >
            <p className="text-[30px] font-extrabold leading-tight">
              {stats.percent}%
              <span className="ml-2 text-base font-semibold text-white/80">
                · {stats.completedSessions}/{stats.totalSessions} buổi
              </span>
            </p>
            <div
              className="mt-2 h-2.5 w-full max-w-[260px] overflow-hidden rounded-full bg-white/15"
              role="progressbar"
              aria-label="Tiến độ kế hoạch"
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
            label="Nội dung cần học"
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
                {stats.chaptersDone} đã học
              </span>
              {stats.chaptersNeedReview > 0 && (
                <span className="sp-chip bg-[var(--sp-pink)]/30 text-[#ffd3e2]">
                  {stats.chaptersNeedReview} cần ôn lại
                </span>
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
                {todayPlan.isStudyDay ? "Hôm nay học gì?" : "Hôm nay không có lịch học"}
              </h2>
            </div>

            {todayPlan.learningSessions.length > 0 && (
              <span className="sp-chip bg-[var(--sp-surface-2)] text-[var(--sp-text-2)]">
                {todayPlan.learningSessions.length} buổi ·{" "}
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
                    Bắt buộc chọn ngày ôn cho {todayPlan.extras.length} bài chưa đạt 80%
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
                            Buổi {weekdayLong(insight.dateKey)} {formatDayMonth(insight.dateKey)}
                          </p>
                        </div>
                        {insight.attempt ? (
                          <Link
                            href={`/quiz-results/${insight.attempt.attempt_id}`}
                            className="sp-btn sp-btn-primary w-[120px] px-0 py-2 text-[13px]"
                          >
                            Chọn ngày ôn
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
              Buổi học kế tiếp:
              <span className="font-semibold text-[var(--sp-ink)]">
                {weekdayLong(todayPlan.nextLearning.dateKey)}, {formatDayMonth(todayPlan.nextLearning.dateKey)}
              </span>
              · {todayPlan.nextLearning.sessions.length} buổi · {formatDuration(nextLearningMinutes)}
            </p>
          )}
        </section>

        <aside className="sp-card flex flex-col p-5 sm:p-6">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <p className="sp-accent text-[17px] text-[var(--sp-pink)]">
                {upcomingDays.days.length} ngày học tới
              </p>
              <h2 className="text-[22px] text-[var(--sp-ink)]">Sắp tới</h2>
            </div>
            <a
              href="#full-schedule"
              className="flex items-center gap-1 text-sm font-bold text-[var(--sp-peri-dark)] hover:underline"
            >
              Cả lịch <IconArrowRight size={16} />
            </a>
          </div>

          {upcomingDays.days.length === 0 ? (
            <p className="rounded-2xl bg-[var(--sp-surface-2)] p-5 text-sm text-[var(--sp-muted)]">
              Không còn buổi học nào phía trước. Hãy ôn lại các chương cần
              củng cố trước ngày thi.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--sp-line)]">
              {upcomingDays.days.map((day) => (
                <li
                  key={day.dateKey}
                  className="grid grid-cols-[56px_minmax(0,1fr)] items-center gap-3 py-3.5 first:pt-1"
                >
                  <div className="flex h-[56px] flex-col items-center justify-center rounded-2xl border-2 border-[var(--sp-lav-line)] bg-[var(--sp-lav)] text-center">
                    <p className="text-xs font-bold uppercase leading-none text-[var(--sp-muted)]">
                      {weekdayShort(day.dateKey)}
                    </p>
                    <p className="mt-1 text-[17px] font-extrabold leading-none text-[var(--sp-purple)]">
                      {formatDayMonth(day.dateKey)}
                    </p>
                  </div>
                  <ul className="min-w-0 space-y-2">
                    {day.items.map((insight) => (
                      <li
                        key={insight.session.id}
                        className="grid grid-cols-[8px_minmax(0,1fr)_30px] items-center gap-2 text-[14px] leading-snug"
                      >
                        <span className="h-2 w-2 rounded-full bg-[var(--sp-peri)]" />
                        <span className="text-[var(--sp-ink)]">
                          {getTopicTitle(insight.topic)}
                        </span>
                        <span className="text-right text-[13px] tabular-nums text-[var(--sp-muted)]">
                          {insight.session.duration_minutes}′
                        </span>
                      </li>
                    ))}
                    {day.reviews.map((insight) => (
                      <li
                        key={`review-${insight.session.id}`}
                        className="grid grid-cols-[8px_minmax(0,1fr)_30px] items-center gap-2 text-[14px] leading-snug"
                      >
                        <span className="h-2 w-2 rounded-full bg-[var(--sp-pink)]" />
                        <span className="text-[var(--sp-ink)]">
                          Ôn lại: {getTopicTitle(insight.topic)}
                        </span>
                        <span className="text-right text-[12px] font-bold text-[var(--sp-pink-dark)]">
                          Ôn
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}

          {upcomingDays.restDays.length > 0 && (
            <p className="mt-2 flex items-center gap-2 text-sm text-[var(--sp-muted)]">
              <IconMoon size={16} className="shrink-0" />
              {upcomingDays.restDays
                .map((key) => `${weekdayLong(key)} ${formatDayMonth(key)}`)
                .join(", ")}{" "}
              nghỉ
            </p>
          )}

          <div className="mt-auto flex flex-wrap gap-x-5 gap-y-2 border-t border-[var(--sp-line)] pt-4 text-[13px] text-[var(--sp-text-2)]">
            <Legend color="var(--sp-peri)" label="Học mới" />
            <Legend color="var(--sp-pink)" label="Ôn lại" />
            <Legend color="var(--sp-purple)" label="Kiểm tra" />
          </div>
        </aside>
      </div>

      {/* ===== Lịch tháng ===== */}
      <section id="full-schedule" className="sp-card-pop scroll-mt-24 p-5 sm:p-7">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]">
            <IconCalendar size={20} />
          </span>
          <div>
            <h2 className="text-xl text-[var(--sp-ink)]">Toàn bộ lịch học</h2>
            <p className="text-sm text-[var(--sp-muted)]">
              Rê chuột (hoặc chạm) vào ngày có góc màu để xem buổi học, buổi ôn và vào học ngay.
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
          ? "Bạn đã hoàn thành mọi buổi học"
          : "Lộ trình chưa được tạo"}
      </p>
      <p className="mx-auto mt-1 max-w-md text-sm text-[var(--sp-muted)]">
        {hasSessions
          ? "Hãy làm lại Quiz hoặc ôn Flashcard để giữ kiến thức trước ngày thi."
          : "Sau khi AI phân tích tài liệu, StudyPilot sẽ chia các bài thành từng buổi học theo thời gian của bạn."}
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
    return { href: insight.links.review, label: "Vào ôn" };
  }

  if (task.kind === "quiz") {
    return { href: `/quizzes/${insight.quizId}`, label: "Làm bài kiểm tra" };
  }

  const status = insight.session.status;
  if (status === "completed") return { href: insight.links.revisit, label: "Xem lại" };
  return {
    href: insight.links.learn,
    label: status === "in_progress" ? "Học tiếp" : "Vào học",
  };
}

const TASK_STYLE: Record<
  TaskKind,
  { label: string; chip: string; icon: React.ReactNode }
> = {
  review: {
    label: "Ôn lại",
    chip: "border border-[var(--sp-pink-line)] bg-white text-[var(--sp-pink-dark)]",
    icon: <IconRepeat size={14} />,
  },
  quiz: {
    label: "Kiểm tra",
    chip: "bg-[var(--sp-purple)] text-white",
    icon: <IconPen size={14} />,
  },
  learn: {
    label: "Học mới",
    chip: "bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]",
    icon: <IconBook size={14} />,
  },
};

function TaskReason({ task }: { task: TodayTask }) {
  const { insight } = task;

  if (task.kind === "review") {
    return <ReviewOrigin insight={insight} withDateLink />;
  }

  if (task.kind === "quiz") {
    return (
      <p className="mt-1.5 text-sm text-[var(--sp-muted)]">
        Bạn đã vào học buổi này: nộp bài kiểm tra cuối buổi để hoàn thành.
      </p>
    );
  }

  if (isLocked(insight.session)) {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-sm text-[var(--sp-muted)]">
        <IconLock size={14} className="shrink-0" />
        {insight.session.lock_reason ||
          "Hoàn thành các buổi trước để mở khóa"}
      </p>
    );
  }

  if (task.overdue) {
    return (
      <p className="mt-1.5 text-sm font-medium text-[var(--sp-amber-dark)]">
        Trễ lịch từ {formatDayMonth(insight.dateKey)}, nên học bù hôm nay
      </p>
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
  const locked = task.kind === "learn" && isLocked(insight.session);
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
          Hôm nay
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
          <p className="text-sm font-semibold text-[var(--sp-muted)]">phút</p>
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
          {locked ? "Chưa mở khóa" : action.label}
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
  const locked = task.kind === "learn" && isLocked(insight.session);
  const done =
    task.kind === "learn" && insight.session.status === "completed";
  const reviewStyle = task.kind === "review" ? urgencyStyle(insight.urgency) : null;

  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={`Xem hành trình: ${getTopicTitle(insight.topic)}`}
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
          Hôm nay
        </span>
      )}
      <div className="flex shrink-0 items-baseline gap-2 sm:w-[92px] sm:flex-col sm:items-center sm:gap-0 sm:border-r-2 sm:border-dashed sm:border-[var(--sp-line)] sm:pr-5">
        <p className="text-[32px] font-extrabold leading-none text-[var(--sp-purple)]">
          {insight.session.duration_minutes}
        </p>
        <p className="text-sm font-semibold text-[var(--sp-muted)]">phút</p>
      </div>

      <div className="min-w-0 flex-1">
        {reviewStyle && insight.urgency ? (
          <UrgencyChip urgency={insight.urgency} />
        ) : (
          <span className={`sp-chip ${style.chip}`}>
            {done ? <IconCheck size={14} /> : style.icon}
            {done ? "Đã xong" : style.label}
          </span>
        )}
        <h3 className="mt-2 text-lg text-[var(--sp-ink)]">
          {getTopicTitle(insight.topic)}
        </h3>
        <TaskReason task={task} />
        <p className="mt-2 flex items-center gap-1 text-xs font-bold text-[var(--sp-peri-dark)] opacity-70 transition group-hover:opacity-100">
          Bấm để xem hành trình
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
        {locked ? "Chưa mở khóa" : action.label}
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
          ? "Hôm nay"
          : formatDayMonth(insight.dateKey),
      caption: learned ? "Đã học" : "Học lần đầu",
      dateKey: insight.dateKey,
      state: learned ? "done" : focus === "learn" ? "current" : "todo",
      icon: learned ? <IconCheck size={18} /> : <IconBook size={18} />,
    },
    {
      key: "quiz",
      title: attemptKey
        ? formatDayMonth(attemptKey)
        : focus === "quiz"
          ? "Hôm nay"
          : "Quiz",
      caption: attempt
        ? `Đúng ${attempt.correct_count ?? 0}/${attempt.total_questions ?? 0} câu`
        : "Kiểm tra",
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
      title: reviewDone ? "Đã ôn" : "Hôm nay",
      caption: reviewDone ? "Ôn tập xong" : "Ôn lại",
      dateKey: reviewDone ? null : todayKey,
      state: reviewDone ? "done" : "current",
      icon: reviewDone ? <IconCheck size={18} /> : <IconRepeat size={18} />,
    });
  }

  steps.push({
    key: "exam",
    title: formatDayMonth(examKey),
    caption: "Ngày thi",
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
        Hành trình của bài này
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
                      +{gap} ngày
                    </span>
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
  const band = percent !== null ? scoreBand(percent) : null;
  return (
    <>
      <p className={compact ? "text-xs text-[var(--sp-muted)]" : "mt-1.5 text-sm text-[var(--sp-text-2)]"}>
        Kiến thức của buổi học {weekdayLong(insight.dateKey)} {formatDayMonth(insight.dateKey)}
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
          {insight.reviewDate ? "Đổi ngày ôn" : "Chọn ngày ôn"}
        </Link>
      )}
    </>
  );
}

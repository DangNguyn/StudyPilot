"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { getMainTopicTitle } from "@/lib/content-titles";
import {
  IconAlert,
  IconArrowRight,
  IconBook,
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
  IconX,
  Sparkle,
} from "@/components/icons";

/* ================= Kiểu dữ liệu ================= */

type ExamPlan = {
  id: string;
  title: string;
  exam_date: string;
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
};

type TaskKind = "review" | "quiz" | "learn";

type TodayTask = {
  key: string;
  kind: TaskKind;
  insight: SessionInsight;
  overdue: boolean;
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

function getChapterCode(chapter: string) {
  const match = chapter.match(
    /(?:chương|chapter|unit|phần|part|bài|lesson)\s*([0-9ivxlc]+)/i
  );
  return match ? `C${match[1].toUpperCase()}` : "";
}

function getTopicTitle(topic: Topic | undefined) {
  return topic ? getMainTopicTitle(topic.name) : "Chủ đề chưa xác định";
}

function getShortTopicLabel(topic: Topic | undefined) {
  const code = getChapterCode(getChapter(topic));
  const title = getTopicTitle(topic);
  return code ? `${code} · ${title}` : title;
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
  const [error, setError] = useState("");
  // Buổi đang được mở rộng trong "Hôm nay học gì?" (null = mặc định buổi của hôm nay)
  const [selectedTaskKey, setSelectedTaskKey] = useState<string | null>(null);
  /* Tuần đang mở trong "Toàn bộ lịch học" (mặc định chỉ mở tuần hiện tại) */
  const [openWeeks, setOpenWeeks] = useState<Record<number, boolean>>({});

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
          reviewDate: pendingReviewId ? retakeQuiz?.review_date || null : null,
        };
      });
  }, [sessions, quizzes, attempts, topicById]);

  /* Buổi ôn lại đã có ngày (người học tự chọn sau bài kiểm tra dưới 80%) */
  const scheduledReviews = useMemo(
    () => insights.filter((insight) => insight.pendingReviewId && insight.reviewDate),
    [insights]
  );

  /* Việc cần làm hôm nay */
  const todayPlan = useMemo(() => {
    const tasks: TodayTask[] = [];

    // 1. Buổi ôn lại: hiện vào đúng ngày đã chọn (trễ thì hiện tiếp);
    //    chưa chọn ngày ("Để sau") thì hiện mỗi ngày để nhắc chọn.
    for (const insight of insights) {
      if (
        insight.pendingReviewId &&
        (!insight.reviewDate || insight.reviewDate <= todayKey)
      ) {
        tasks.push({
          key: `review-${insight.session.id}`,
          kind: "review",
          insight,
          overdue: Boolean(insight.reviewDate && insight.reviewDate < todayKey),
        });
      }
    }

    // 2. Đã vào học nhưng chưa nộp bài kiểm tra (buổi chỉ hoàn thành khi nộp)
    for (const insight of insights) {
      if (
        insight.session.status === "in_progress" &&
        insight.quizId &&
        !insight.attempt
      ) {
        tasks.push({
          key: `quiz-${insight.session.id}`,
          kind: "quiz",
          insight,
          overdue: false,
        });
      }
    }

    // 3. Buổi học bị trễ lịch và buổi học của hôm nay
    const overdue = insights.filter(
      (insight) =>
        insight.dateKey < todayKey &&
        insight.session.status !== "completed"
    );

    let learningDayKey = todayKey;
    let learning = insights.filter(
      (insight) => insight.dateKey === todayKey
    );

    // Hôm nay không có lịch: hiển thị ngày học kế tiếp.
    if (learning.length === 0) {
      const next = insights.find((insight) => insight.dateKey > todayKey);
      if (next) {
        learningDayKey = next.dateKey;
        learning = insights.filter(
          (insight) => insight.dateKey === next.dateKey
        );
      }
    }

    for (const insight of overdue) {
      tasks.push({
        key: `learn-${insight.session.id}`,
        kind: "learn",
        insight,
        overdue: true,
      });
    }

    for (const insight of learning) {
      tasks.push({
        key: `learn-${insight.session.id}`,
        kind: "learn",
        insight,
        overdue: false,
      });
    }

    return {
      tasks,
      learningDayKey,
      learningSessions: learning,
      isToday: learningDayKey === todayKey,
    };
  }, [insights, todayKey]);

  /* Lịch các ngày tới (sau ngày đang hiển thị ở khối "Hôm nay") */
  const upcomingDays = useMemo(() => {
    const startKey =
      todayPlan.learningDayKey > todayKey ? todayPlan.learningDayKey : todayKey;
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
  }, [insights, scheduledReviews, todayPlan.learningDayKey, todayKey]);

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

  /* Lịch đầy đủ theo tuần */
  const studyWeeks = useMemo(() => {
    const firstKey = insights[0]?.dateKey;
    if (!firstKey) return [];

    const weeks = new Map<
      number,
      {
        weekNumber: number;
        days: { dateKey: string; items: SessionInsight[]; reviews: SessionInsight[] }[];
      }
    >();

    const dayOf = (dateKey: string) => {
      const weekNumber =
        Math.floor(Math.max(0, daysBetween(firstKey, dateKey)) / 7) + 1;
      const week = weeks.get(weekNumber) || { weekNumber, days: [] };
      weeks.set(weekNumber, week);
      let day = week.days.find((item) => item.dateKey === dateKey);
      if (!day) {
        day = { dateKey, items: [], reviews: [] };
        week.days.push(day);
      }
      return day;
    };

    for (const insight of insights) {
      dayOf(insight.dateKey).items.push(insight);
    }

    // Buổi ôn lại nằm đúng ngày người học đã chọn (có thể trùng ngày học)
    for (const insight of scheduledReviews) {
      dayOf(insight.reviewDate!).reviews.push(insight);
    }

    for (const week of weeks.values()) {
      week.days.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    }

    return Array.from(weeks.values()).sort(
      (a, b) => a.weekNumber - b.weekNumber
    );
  }, [insights, scheduledReviews]);

  /* ---------- Trạng thái tải ---------- */

  if (isLoading) {
    return (
      <div className="sp-card mx-auto max-w-6xl p-10 text-center text-[var(--sp-muted)]">
        <Sparkle
          size={22}
          className="sp-twinkle mx-auto mb-3 text-[var(--sp-pink)]"
        />
        Đang tải lộ trình ôn tập...
      </div>
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
  // Mặc định mở rộng buổi học đúng ngày hôm nay; bấm buổi khác để xem hành trình của buổi đó.
  const todayTask =
    allTasks.find(
      (task) =>
        task.kind === "learn" &&
        task.insight.dateKey === todayKey &&
        task.insight.session.status !== "completed"
    ) ||
    allTasks.find((task) => task.insight.dateKey === todayKey) ||
    allTasks[0];
  const featured =
    allTasks.find((task) => task.key === selectedTaskKey) || todayTask;

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
                {todayPlan.isToday
                  ? `${weekdayLong(todayKey)}, ${formatDayMonth(todayKey)}`
                  : `Buổi kế tiếp · ${weekdayLong(todayPlan.learningDayKey)}, ${formatDayMonth(todayPlan.learningDayKey)}`}
              </p>
              <h2 className="text-[26px] text-[var(--sp-ink)]">
                {todayPlan.isToday || todayPlan.tasks.length === 0
                  ? "Hôm nay học gì?"
                  : "Hôm nay không có lịch học"}
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
              {allTasks.map((task, index) =>
                task.key === featured.key ? (
                  <FeaturedTask
                    key={task.key}
                    task={task}
                    index={index + 1}
                    isToday={task.insight.dateKey === todayKey}
                    examKey={examKey}
                    todayKey={todayKey}
                    onOpen={(href) => router.push(href)}
                  />
                ) : (
                  <CompactTask
                    key={task.key}
                    task={task}
                    index={index + 1}
                    isToday={task.insight.dateKey === todayKey}
                    onSelect={() => setSelectedTaskKey(task.key)}
                    onOpen={(href) => router.push(href)}
                  />
                )
              )}
            </div>
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
                <li key={day.dateKey} className="flex gap-4 py-4 first:pt-1">
                  <div className="w-12 shrink-0">
                    <p className="text-sm font-semibold text-[var(--sp-muted)]">
                      {weekdayShort(day.dateKey)}
                    </p>
                    <p className="text-[19px] font-extrabold leading-tight text-[var(--sp-purple)]">
                      {formatDayMonth(day.dateKey)}
                    </p>
                  </div>
                  <ul className="min-w-0 flex-1 space-y-2.5">
                    {day.items.map((insight) => (
                      <li
                        key={insight.session.id}
                        className="flex items-start gap-2.5 text-[14.5px]"
                      >
                        <span className="mt-[7px] h-2 w-2 shrink-0 rounded-full bg-[var(--sp-peri)]" />
                        <span className="min-w-0 flex-1 text-[var(--sp-ink)]">
                          {getShortTopicLabel(insight.topic)}
                        </span>
                        <span className="shrink-0 text-[13px] text-[var(--sp-muted)]">
                          {insight.session.duration_minutes}′
                        </span>
                      </li>
                    ))}
                    {day.reviews.map((insight) => (
                      <li
                        key={`review-${insight.session.id}`}
                        className="flex items-start gap-2.5 text-[14.5px]"
                      >
                        <span className="mt-[7px] h-2 w-2 shrink-0 rounded-full bg-[var(--sp-pink)]" />
                        <span className="min-w-0 flex-1 text-[var(--sp-ink)]">
                          Ôn lại: {getShortTopicLabel(insight.topic)}
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

      {/* ===== Nội dung theo chương ===== */}
      <ChapterOverview topics={topics} insights={insights} />

      {/* ===== Lịch đầy đủ ===== */}
      <section id="full-schedule" className="sp-card scroll-mt-24 p-5 sm:p-7">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]">
            <IconClock size={20} />
          </span>
          <div>
            <h2 className="text-xl text-[var(--sp-ink)]">Toàn bộ lịch học</h2>
            <p className="text-sm text-[var(--sp-muted)]">
              Các buổi học được phân bổ theo tuần đến ngày thi.
            </p>
          </div>
        </div>

        {studyWeeks.length === 0 ? (
          <EmptyState hasSessions={false} />
        ) : (
          <div className="space-y-6">
            {studyWeeks.map((week) => {
              const weekItems = week.days.flatMap((day) => day.items);
              const doneCount = weekItems.filter((item) => item.session.status === "completed").length;
              const currentWeek =
                studyWeeks.find((item) =>
                  item.days.some((day) => day.dateKey >= todayKey)
                )?.weekNumber ?? studyWeeks[studyWeeks.length - 1]?.weekNumber;
              const isOpen = openWeeks[week.weekNumber] ?? week.weekNumber === currentWeek;
              const firstDay = week.days[0]?.dateKey;
              const lastDay = week.days[week.days.length - 1]?.dateKey;
              return (
              <div key={week.weekNumber}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() =>
                    setOpenWeeks((state) => ({ ...state, [week.weekNumber]: !isOpen }))
                  }
                  className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition ${
                    isOpen ? "mb-3 bg-[var(--sp-lav)]" : "bg-[var(--sp-surface-2)] hover:bg-[var(--sp-lav)]"
                  }`}
                >
                  <h3 className="text-base text-[var(--sp-purple)]">
                    Tuần {week.weekNumber}
                  </h3>
                  {firstDay && (
                    <span className="hidden text-sm text-[var(--sp-muted)] sm:inline">
                      {formatDayMonth(firstDay)}
                      {lastDay && lastDay !== firstDay ? ` – ${formatDayMonth(lastDay)}` : ""}
                    </span>
                  )}
                  {week.weekNumber === currentWeek && (
                    <span className="sp-chip bg-[var(--sp-pink)] text-white">Tuần này</span>
                  )}
                  <span className="flex-1" />
                  <span className="text-xs font-semibold text-[var(--sp-muted)]">
                    {week.days.length} ngày · {doneCount}/{weekItems.length} bài xong
                  </span>
                  <IconChevronDown
                    size={16}
                    className={`shrink-0 text-[var(--sp-muted)] transition ${isOpen ? "rotate-180" : ""}`}
                  />
                </button>

                {isOpen && (
                <div className="sp-task-expand space-y-2.5">
                  {week.days.map((day) => {
                    const isToday = day.dateKey === todayKey;
                    const minutes = day.items.reduce(
                      (sum, insight) => sum + (insight.session.duration_minutes || 0),
                      0
                    );
                    return (
                      <div
                        key={day.dateKey}
                        className={`flex flex-col overflow-hidden rounded-2xl border-2 sm:flex-row ${
                          isToday
                            ? "border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)]"
                            : "border-[var(--sp-line)] bg-white"
                        }`}
                      >
                        <div
                          className={`flex shrink-0 items-center gap-3 px-4 py-3 sm:w-36 sm:flex-col sm:justify-center sm:gap-0.5 sm:border-r-2 sm:border-dashed sm:text-center ${
                            isToday ? "sm:border-[var(--sp-pink-line)]" : "sm:border-[var(--sp-line)]"
                          }`}
                        >
                          <p
                            className={`text-[12px] font-semibold uppercase tracking-wide ${
                              isToday ? "text-[var(--sp-pink-dark)]" : "text-[var(--sp-muted)]"
                            }`}
                          >
                            {isToday ? "Hôm nay" : weekdayLong(day.dateKey)}
                          </p>
                          <p className="text-[26px] font-black leading-none tracking-tight text-[var(--sp-purple)]">
                            {formatDayMonth(day.dateKey)}
                          </p>
                          <p className="text-[11px] font-medium text-[var(--sp-muted)]">
                            {day.items.length > 0 ? `${day.items.length} bài · ${minutes} phút` : "Ngày ôn lại"}
                          </p>
                        </div>
                        <div className="min-w-0 flex-1 divide-y divide-[var(--sp-line)]">
                          {day.items.map((insight) => (
                            <ScheduleRow
                              key={insight.session.id}
                              insight={insight}
                              onOpen={(href) => router.push(href)}
                            />
                          ))}
                          {day.reviews.map((insight) => (
                            <ReviewScheduleRow
                              key={`review-${insight.session.id}`}
                              insight={insight}
                              overdue={day.dateKey < todayKey}
                              onOpen={(href) => router.push(href)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                )}
              </div>
              );
            })}
          </div>
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
    return {
      href: `/review-plans/${insight.pendingReviewId}`,
      label: "Bắt đầu ôn",
    };
  }

  if (task.kind === "quiz") {
    return { href: `/quizzes/${insight.quizId}`, label: "Làm bài kiểm tra" };
  }

  const status = insight.session.status;
  return {
    href: `/study-sessions/${insight.session.id}`,
    label:
      status === "completed"
        ? "Xem lại"
        : status === "in_progress"
          ? "Học tiếp"
          : "Bắt đầu",
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
  const attempt = insight.attempt;

  if (task.kind === "review" && insight.reviewDate) {
    return (
      <p
        className={`mt-1.5 flex items-center gap-1.5 text-sm ${
          task.overdue ? "font-medium text-[var(--sp-amber-dark)]" : "text-[var(--sp-pink-dark)]"
        }`}
      >
        <IconAlert size={15} className="shrink-0" />
        {task.overdue
          ? `Lịch ôn ${formatDayMonth(insight.reviewDate)} đã qua, nên ôn bù hôm nay`
          : "Hôm nay là ngày ôn lại bạn đã chọn"}
      </p>
    );
  }

  if (task.kind === "review" && attempt) {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-sm text-[var(--sp-pink-dark)]">
        <IconAlert size={15} className="shrink-0" />
        Ưu tiên vì lần kiểm tra gần nhất chỉ đúng{" "}
        {attempt.correct_count ?? 0}/{attempt.total_questions ?? 0} câu
      </p>
    );
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
  index,
  isToday,
  examKey,
  todayKey,
  onOpen,
}: {
  task: TodayTask;
  index: number;
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

  return (
    <article
      className={`sp-task-expand relative rounded-[20px] border p-5 sm:p-6 ${
        isReview
          ? "border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)]"
          : "border-[var(--sp-lav-line)] bg-[var(--sp-lav)]"
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
            isReview
              ? "sm:border-[var(--sp-pink-line)]"
              : "sm:border-[var(--sp-lav-line)]"
          }`}
        >
          <p className="text-[40px] font-extrabold leading-none text-[var(--sp-purple)]">
            {insight.session.duration_minutes}
          </p>
          <p className="text-sm font-semibold text-[var(--sp-muted)]">phút</p>
        </div>

        <div className="min-w-0 flex-1">
          <span className={`sp-chip ${style.chip}`}>
            {style.icon}
            Buổi {index} · {style.label}
          </span>
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
  index,
  isToday,
  onSelect,
  onOpen,
}: {
  task: TodayTask;
  index: number;
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

  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={`Xem hành trình của buổi ${index}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={`group relative flex cursor-pointer flex-col gap-4 rounded-[20px] border-2 border-[var(--sp-line)] bg-white p-5 transition hover:-translate-y-0.5 hover:border-[var(--sp-lav-line)] hover:shadow-[4px_4px_0_var(--sp-lav-line)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sp-peri)] sm:flex-row sm:items-center ${
        done ? "opacity-70 hover:opacity-100" : ""
      }`}
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
        <span className={`sp-chip ${style.chip}`}>
          {done ? <IconCheck size={14} /> : style.icon}
          Buổi {index} · {done ? "Đã xong" : style.label}
        </span>
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

function ChapterOverview({
  topics,
  insights,
}: {
  topics: Topic[];
  insights: SessionInsight[];
}) {
  /* Chương đang mở; mặc định thu gọn, chỉ hiện tên chương + tiến độ */
  const [openChapters, setOpenChapters] = useState<Record<string, boolean>>({});

  if (topics.length === 0) {
    return null;
  }

  const groups = new Map<string, Topic[]>();
  for (const topic of topics) {
    const chapter = getChapter(topic) || "Nội dung khác";
    groups.set(chapter, [...(groups.get(chapter) || []), topic]);
  }

  /*
   * Trạng thái mỗi bài theo điểm kiểm tra mới nhất (bài chính hoặc kiểm tra lại):
   * - good   : đã kiểm tra, điểm từ 80% → tick xanh
   * - review : đã kiểm tra, điểm dưới 80% → X đỏ (làm kiểm tra lại đạt 80% sẽ thành tick xanh)
   * - learned: đã học xong nhưng chưa kiểm tra
   * - todo   : chưa học
   */
  const statusByTopic = new Map<string, "good" | "review" | "learned" | "todo">();
  const scoreByTopic = new Map<string, number>();
  for (const topic of topics) {
    const topicInsights = insights.filter(
      (insight) => insight.session.topic_id === topic.id
    );
    const scores = topicInsights
      .map((insight) => insight.currentScore)
      .filter((score): score is number => score !== null);

    if (scores.length > 0) {
      const lowest = Math.min(...scores);
      scoreByTopic.set(topic.id, lowest);
      statusByTopic.set(topic.id, lowest >= 80 ? "good" : "review");
    } else if (
      topicInsights.length > 0 &&
      topicInsights.every((insight) => insight.session.status === "completed")
    ) {
      statusByTopic.set(topic.id, "learned");
    } else {
      statusByTopic.set(topic.id, "todo");
    }
  }

  return (
    <section className="sp-card p-5 sm:p-7">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--sp-pink-bg)] text-[var(--sp-pink)]">
          <Sparkle size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl text-[var(--sp-ink)]">
            Nội dung AI nhận diện
          </h2>
          <p className="text-sm text-[var(--sp-muted)]">
            {topics.length} bài học, chia theo chương của giáo trình.
          </p>
        </div>
        {groups.size > 0 && (
          <button
            type="button"
            onClick={() => {
              const allOpen = Array.from(groups.keys()).every((chapter) => openChapters[chapter]);
              setOpenChapters(
                Object.fromEntries(Array.from(groups.keys()).map((chapter) => [chapter, !allOpen]))
              );
            }}
            className="sp-btn sp-btn-secondary px-4 py-2 text-sm"
          >
            {Array.from(groups.keys()).every((chapter) => openChapters[chapter])
              ? "Thu gọn tất cả"
              : "Mở tất cả"}
          </button>
        )}
      </div>

      <ul className="-mt-3 mb-5 flex flex-wrap gap-x-4 gap-y-1.5 text-xs font-medium text-[var(--sp-text-2)]">
        <li className="flex items-center gap-1.5">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white">
            <IconCheck size={10} />
          </span>
          Đạt từ 80%
        </li>
        <li className="flex items-center gap-1.5">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--sp-pink)] text-white">
            <IconX size={9} />
          </span>
          Dưới 80%, cần ôn lại
        </li>
        <li className="flex items-center gap-1.5">
          <span className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-[var(--sp-peri)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--sp-peri)]" />
          </span>
          Đã học, chưa kiểm tra
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-4 w-4 rounded-full border-2 border-[var(--sp-lav-line)]" />
          Chưa học
        </li>
      </ul>

      {(() => {
        const renderTopic = (topic: Topic) => {
          const status = statusByTopic.get(topic.id) || "todo";
          const score = scoreByTopic.get(topic.id);
          return (
            <li
              key={topic.id}
              className="flex items-start gap-3 rounded-xl bg-white px-3 py-2.5"
            >
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                  status === "good"
                    ? "bg-emerald-500 text-white"
                    : status === "review"
                      ? "bg-[var(--sp-pink)] text-white"
                      : status === "learned"
                        ? "border-2 border-[var(--sp-peri)] text-[var(--sp-peri)]"
                        : "border-2 border-[var(--sp-lav-line)]"
                }`}
                title={
                  status === "good"
                    ? `Đạt ${score}%`
                    : status === "review"
                      ? `${score}%, cần ôn lại và làm kiểm tra lại`
                      : status === "learned"
                        ? "Đã học, chưa kiểm tra"
                        : "Chưa học"
                }
                aria-label={
                  status === "good"
                    ? "Đạt"
                    : status === "review"
                      ? "Cần ôn lại"
                      : status === "learned"
                        ? "Đã học, chưa kiểm tra"
                        : "Chưa học"
                }
              >
                {status === "good" && <IconCheck size={14} />}
                {status === "review" && <IconX size={13} />}
                {status === "learned" && <span className="h-2 w-2 rounded-full bg-[var(--sp-peri)]" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14.5px] font-semibold text-[var(--sp-ink)]">
                  {getMainTopicTitle(topic.name)}
                </p>
                <p className="text-xs text-[var(--sp-muted)]">
                  Độ khó {topic.difficulty_level}/5 · ~{topic.estimated_minutes} phút
                  {score !== undefined && (
                    <span
                      className={`ml-1 font-bold ${
                        status === "good" ? "text-emerald-700" : "text-[var(--sp-pink-dark)]"
                      }`}
                    >
                      · Điểm {score}%
                    </span>
                  )}
                </p>
              </div>
            </li>
          );
        };

        const renderChapter = (chapter: string, chapterTopics: Topic[], wide: boolean) => {
          const open = openChapters[chapter] ?? false;
          const done = chapterTopics.filter((topic) => statusByTopic.get(topic.id) === "good").length;
          const review = chapterTopics.filter((topic) => statusByTopic.get(topic.id) === "review").length;
          return (
            <div
              key={chapter}
              className="rounded-2xl border border-[var(--sp-line)] bg-[var(--sp-surface-2)] p-4"
            >
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenChapters((state) => ({ ...state, [chapter]: !open }))}
                className="flex w-full items-center gap-3 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-bold text-[var(--sp-purple)]">{chapter}</span>
                  <span className="mt-1.5 flex items-center gap-2 text-xs font-semibold text-[var(--sp-muted)]">
                    <span className="h-1.5 w-24 overflow-hidden rounded-full bg-white">
                      <span
                        className="block h-full rounded-full bg-emerald-500"
                        style={{ width: `${chapterTopics.length ? (done / chapterTopics.length) * 100 : 0}%` }}
                      />
                    </span>
                    {done}/{chapterTopics.length} bài đạt từ 80%
                    {review > 0 && <span className="text-[var(--sp-pink-dark)]">· {review} cần ôn lại</span>}
                  </span>
                </span>
                <IconChevronDown
                  size={18}
                  className={`shrink-0 text-[var(--sp-muted)] transition ${open ? "rotate-180" : ""}`}
                />
              </button>
              {open && (
                <ul className={`sp-task-expand mt-3 ${wide ? "grid gap-2 md:grid-cols-2" : "space-y-2"}`}>
                  {chapterTopics.map(renderTopic)}
                </ul>
              )}
            </div>
          );
        };

        const entries = Array.from(groups.entries());
        const total = topics.length;
        /* Chương chiếm quá nửa số bài (hoặc chỉ có 1 chương) → trải rộng cả 2 cột */
        const wide = entries.filter(
          ([, chapterTopics]) => entries.length === 1 || chapterTopics.length > total / 2
        );
        const rest = entries.filter((entry) => !wide.includes(entry));

        /* Chia các chương còn lại vào 2 cột sao cho số bài 2 bên gần bằng nhau */
        const columns: [string, Topic[]][][] = [[], []];
        const heights = [0, 0];
        for (const entry of [...rest].sort((a, b) => b[1].length - a[1].length)) {
          const target = heights[0] <= heights[1] ? 0 : 1;
          columns[target].push(entry);
          heights[target] += entry[1].length + 1.5;
        }
        const order = new Map(entries.map(([chapter], index) => [chapter, index]));
        for (const column of columns) {
          column.sort((a, b) => (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0));
        }

        return (
          <div className="space-y-4">
            {wide.map(([chapter, chapterTopics]) => renderChapter(chapter, chapterTopics, true))}
            {rest.length > 0 && (
              <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
                {columns.map((column, index) => (
                  <div key={index} className="space-y-4">
                    {column.map(([chapter, chapterTopics]) => renderChapter(chapter, chapterTopics, false))}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}
    </section>
  );
}

function ReviewScheduleRow({
  insight,
  overdue,
  onOpen,
}: {
  insight: SessionInsight;
  overdue: boolean;
  onOpen: (href: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 bg-[var(--sp-pink-bg)]/40 px-4 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 font-semibold text-[var(--sp-ink)]">
          <IconRepeat size={14} className="shrink-0 text-[var(--sp-pink-dark)]" />
          Ôn lại: {getTopicTitle(insight.topic)}
        </p>
        <p className="text-xs text-[var(--sp-muted)]">
          {getChapter(insight.topic) || "—"} · Ôn phần còn yếu rồi làm bài kiểm tra lại
        </p>
      </div>

      <span
        className={`sp-chip w-fit ${
          overdue
            ? "bg-[var(--sp-amber-bg)] text-[var(--sp-amber-dark)]"
            : "bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]"
        }`}
      >
        {overdue ? "Trễ lịch ôn" : "Lịch ôn lại"}
      </span>

      <button
        type="button"
        onClick={() => onOpen(`/review-plans/${insight.pendingReviewId}`)}
        className="sp-btn sp-btn-secondary shrink-0 px-4 py-2 text-sm"
      >
        Vào ôn
      </button>
    </div>
  );
}

function ScheduleRow({
  insight,
  onOpen,
}: {
  insight: SessionInsight;
  onOpen: (href: string) => void;
}) {
  const { session } = insight;
  const locked = isLocked(session);

  const status = locked
    ? {
        label: "Chưa mở khóa",
        style: "bg-[var(--sp-surface-2)] text-[var(--sp-soft)]",
      }
    : insight.pendingReviewId
      ? {
          label: "Cần ôn lại",
          style: "bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]",
        }
      : session.status === "completed"
        ? {
            label: "Đã hoàn thành",
            style: "bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]",
          }
        : session.status === "in_progress"
          ? {
              label: "Đang học",
              style: "bg-[var(--sp-amber-bg)] text-[var(--sp-amber-dark)]",
            }
          : {
              label: "Đã lên lịch",
              style: "bg-[var(--sp-surface-2)] text-[var(--sp-text-2)]",
            };

  return (
    <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-[var(--sp-ink)]">
          {getTopicTitle(insight.topic)}
        </p>
        <p className="text-xs text-[var(--sp-muted)]">
          {getChapter(insight.topic) || "—"} · {session.duration_minutes} phút
          {insight.attempt &&
            ` · Quiz ${insight.attempt.correct_count ?? 0}/${insight.attempt.total_questions ?? 0}`}
        </p>
      </div>

      <span className={`sp-chip w-fit ${status.style}`}>
        {locked && <IconLock size={13} />}
        {status.label}
      </span>

      <button
        type="button"
        disabled={locked}
        title={locked ? session.lock_reason || undefined : undefined}
        onClick={() => onOpen(`/study-sessions/${session.id}`)}
        className="sp-btn sp-btn-secondary shrink-0 px-4 py-2 text-sm"
      >
        {session.status === "completed" ? "Xem lại" : "Vào học"}
      </button>
    </div>
  );
}

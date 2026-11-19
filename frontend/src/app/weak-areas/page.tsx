"use client";

import { useEffect, useMemo, useRef, useState, Suspense } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getMainTopicTitle } from "@/lib/content-titles";
import {
  IconAlert,
  IconArrowRight,
  IconBook,
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconFile,
  IconPlay,
  IconRepeat,
  IconTarget,
  IconTrendDown,
  IconTrendUp,
  Sparkle,
} from "@/components/icons";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

const PASS_SCORE = 50;
const MASTERY_SCORE = 80;

/* ================= Kiểu dữ liệu ================= */

type Subject = { id: string; name: string; created_at?: string };

type ExamPlan = {
  id: string;
  subject_id?: string;
  title?: string;
  exam_date?: string;
  total_topics?: number;
  study_days_per_week?: number | null;
};

/* Một bài học (buổi) trong tuần và điểm kiểm tra của nó */
type LessonScore = {
  session: StudySession;
  topic: Topic | undefined;
  dayNumber: number;
  dateKey: string;
  main: AttemptRow | undefined;
  retake: AttemptRow | undefined;
  current: number | null;
  latest: AttemptRow | undefined;
};

type WeekScore = {
  number: number;
  startKey: string;
  endKey: string;
  lessons: LessonScore[];
  tested: number;
  average: number | null;
  firstAverage: number | null;
};

type Topic = { id: string; name: string; hierarchy?: string | null };

type StudySession = {
  id: string;
  topic_id: string;
  status: string;
  scheduled_start?: string;
  duration_minutes?: number;
};

type Quiz = {
  id: string;
  title?: string;
  study_session_id?: string | null;
  is_retake?: boolean;
  review_plan_id?: string | null;
  review_status?: string | null;
};

type WeakAreaItem = {
  topic_name?: string;
  hierarchy?: string;
  description?: string;
  recommendation?: string;
};

type QuizAttempt = {
  attempt_id: string;
  quiz_id: string;
  quiz_title?: string;
  score: number | null;
  correct_count: number | null;
  total_questions: number | null;
  submitted_at: string | null;
  ai_assessment?: {
    mastery_level?: string;
    summary?: string;
    weak_areas?: WeakAreaItem[];
  } | null;
  review_plan?: { id: string; status?: string | null } | null;
};

type AttemptRow = {
  attempt: QuizAttempt;
  percent: number;
  session: StudySession | undefined;
  topic: Topic | undefined;
  chapterKey: string;
  isRetake: boolean;
  previousPercent: number | null;
};

type ChapterStat = {
  key: string;
  code: string;
  title: string;
  shortTitle: string;
  sessions: StudySession[];
  attempts: AttemptRow[];
  current: number | null;
  previous: number | null;
  pendingReviewId: string | null;
  weakArea: WeakAreaItem | null;
  nextSession: StudySession | undefined;
};

/* ================= Tiện ích ================= */

async function getJson<T>(url: string): Promise<T[]> {
  const response = await fetch(url, { cache: "no-store" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result?.detail || "Không thể tải dữ liệu.");
  }
  return Array.isArray(result?.data) ? result.data : [];
}

const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh",
});

function toDateKey(value: string | Date) {
  return dateKeyFormatter.format(new Date(value));
}

function formatDate(value?: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDayLabel(value: string) {
  const key = toDateKey(value);
  const today = toDateKey(new Date());
  if (key === today) return "hôm nay";
  const date = new Date(`${key}T00:00:00`);
  const weekday = date.toLocaleDateString("vi-VN", { weekday: "long" });
  const [, month, day] = key.split("-");
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${day}/${month}`;
}

function formatWeekday(value: string) {
  const key = toDateKey(value);
  if (key === toDateKey(new Date())) return "Hôm nay";
  const weekday = new Date(`${key}T00:00:00`).toLocaleDateString("vi-VN", {
    weekday: "long",
  });
  return weekday.charAt(0).toUpperCase() + weekday.slice(1);
}

function getAttemptPercent(attempt: QuizAttempt) {
  const total = Number(attempt.total_questions || 0);
  if (total > 0) {
    return Math.round((Number(attempt.correct_count || 0) / total) * 100);
  }
  return Math.round(Number(attempt.score || 0));
}

const CHAPTER_PREFIX =
  /^(?:chương|chapter|unit|phần|part|bài|lesson)\s*([0-9ivxlc]+)\s*[:.\-–—]?\s*/i;

function getLevel(percent: number | null) {
  if (percent === null) {
    return {
      label: "Chưa kiểm tra",
      chip: "bg-[var(--sp-surface-2)] text-[var(--sp-muted)]",
      bar: "",
      text: "text-[var(--sp-muted)]",
    };
  }
  if (percent >= MASTERY_SCORE) {
    return {
      label: "Nắm vững",
      chip: "bg-emerald-50 text-emerald-700",
      bar: "bg-emerald-500",
      text: "text-emerald-700",
    };
  }
  if (percent >= PASS_SCORE) {
    return {
      label: "Cần cải thiện",
      chip: "bg-[var(--sp-amber-bg)] text-[var(--sp-amber-dark)]",
      bar: "bg-[#E6A23C]",
      text: "text-[var(--sp-amber-dark)]",
    };
  }
  return {
    label: "Cần ôn lại",
    chip: "bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]",
    bar: "bg-[var(--sp-pink)]",
    text: "text-[var(--sp-pink-dark)]",
  };
}

function average(values: number[]) {
  return values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : null;
}

/* Điểm hiện tại của chương = trung bình lần làm gần nhất của từng buổi */
function chapterScore(rows: AttemptRow[]) {
  const latest = new Map<string, number>();
  for (const row of rows) {
    latest.set(row.session?.id || row.attempt.quiz_id, row.percent);
  }
  return average(Array.from(latest.values()));
}

/* ================= Trang ================= */

function WeakAreasPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const subjectParam = searchParams.get("subject");

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [plans, setPlans] = useState<ExamPlan[]>([]);
  const [attempts, setAttempts] = useState<QuizAttempt[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingPlan, setIsLoadingPlan] = useState(false);
  const [error, setError] = useState("");
  const [historyFilter, setHistoryFilter] = useState<"all" | "improve">("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [subjectList, planList, attemptList] = await Promise.all([
          getJson<Subject>(`${API_URL}/api/subjects`),
          getJson<ExamPlan>(`${API_URL}/api/exam-plans`),
          getJson<QuizAttempt>(`${API_URL}/api/quiz-attempts`).catch(() => []),
        ]);
        if (!cancelled) {
          setSubjects(subjectList);
          setPlans(planList);
          setAttempts(attemptList);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : "Không thể tải dữ liệu."
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const planBySubject = useMemo(() => {
    const map = new Map<string, ExamPlan>();
    for (const plan of plans) {
      if (!plan.subject_id) continue;
      const current = map.get(plan.subject_id);
      if (!current || Number(plan.total_topics || 0) > Number(current.total_topics || 0)) {
        map.set(plan.subject_id, plan);
      }
    }
    return map;
  }, [plans]);

  const subjectsWithPlan = subjects.filter((subject) => planBySubject.has(subject.id));
  const subject =
    subjectsWithPlan.find((item) => item.id === subjectParam) || subjectsWithPlan[0];
  const plan = subject ? planBySubject.get(subject.id) : undefined;

  useEffect(() => {
    if (!plan) return;
    let cancelled = false;
    (async () => {
      try {
        setIsLoadingPlan(true);
        const [topicList, sessionList, quizList] = await Promise.all([
          getJson<Topic>(`${API_URL}/api/topics?exam_plan_id=${plan.id}`),
          getJson<StudySession>(`${API_URL}/api/study-sessions?exam_plan_id=${plan.id}`),
          getJson<Quiz>(`${API_URL}/api/quizzes?exam_plan_id=${plan.id}`).catch(() => []),
        ]);
        if (!cancelled) {
          setTopics(topicList);
          setSessions(sessionList);
          setQuizzes(quizList);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : "Không thể tải dữ liệu."
          );
        }
      } finally {
        if (!cancelled) setIsLoadingPlan(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [plan]);

  /* ---------- Tổng hợp ---------- */

  const analysis = useMemo(() => {
    const todayKey = toDateKey(new Date());
    const topicById = new Map(topics.map((topic) => [topic.id, topic]));
    const sessionById = new Map(sessions.map((session) => [session.id, session]));
    const quizById = new Map(quizzes.map((quiz) => [quiz.id, quiz]));

    const chapterKeyOf = (topic: Topic | undefined) =>
      String(topic?.hierarchy || "").split(">")[0].trim() || topic?.id || "other";

    /* Lượt làm bài thuộc môn đang xem, cũ → mới */
    const planAttempts = attempts
      .filter((attempt) => quizById.has(attempt.quiz_id))
      .sort(
        (a, b) =>
          new Date(a.submitted_at || 0).getTime() -
          new Date(b.submitted_at || 0).getTime()
      );

    const lastPercentBySession = new Map<string, number>();
    const rows: AttemptRow[] = planAttempts.map((attempt) => {
      const quiz = quizById.get(attempt.quiz_id);
      const session = quiz?.study_session_id
        ? sessionById.get(quiz.study_session_id)
        : undefined;
      const topic = session ? topicById.get(session.topic_id) : undefined;
      const sessionKey = session?.id || attempt.quiz_id;
      const percent = getAttemptPercent(attempt);
      const previousPercent = lastPercentBySession.get(sessionKey) ?? null;
      lastPercentBySession.set(sessionKey, percent);
      return {
        attempt,
        percent,
        session,
        topic,
        chapterKey: chapterKeyOf(topic),
        isRetake: Boolean(quiz?.is_retake),
        previousPercent,
      };
    });

    /* Chương theo thứ tự trong giáo trình */
    const orderedSessions = [...sessions].sort(
      (a, b) =>
        new Date(a.scheduled_start || 0).getTime() -
        new Date(b.scheduled_start || 0).getTime()
    );
    const chapters: ChapterStat[] = [];
    const ensureChapter = (topic: Topic | undefined) => {
      const key = chapterKeyOf(topic);
      let chapter = chapters.find((item) => item.key === key);
      if (!chapter) {
        const title = String(topic?.hierarchy || "").split(">")[0].trim() ||
          (topic ? getMainTopicTitle(topic.name) : "Nội dung khác");
        const match = title.match(CHAPTER_PREFIX);
        chapter = {
          key,
          code: `C${match ? match[1].toUpperCase() : chapters.length + 1}`,
          title,
          shortTitle: title.replace(CHAPTER_PREFIX, "").trim() || title,
          sessions: [],
          attempts: [],
          current: null,
          previous: null,
          pendingReviewId: null,
          weakArea: null,
          nextSession: undefined,
        };
        chapters.push(chapter);
      }
      return chapter;
    };

    for (const topic of topics) ensureChapter(topic);
    for (const session of orderedSessions) {
      ensureChapter(topicById.get(session.topic_id)).sessions.push(session);
    }
    for (const row of rows) ensureChapter(row.topic).attempts.push(row);

    for (const chapter of chapters) {
      chapter.current = chapterScore(chapter.attempts);
      chapter.previous =
        chapter.attempts.length > 1 ? chapterScore(chapter.attempts.slice(0, -1)) : null;

      // Lấy đánh giá AI gần nhất có chỉ ra phần còn yếu trong chương.
      const assessedRow = [...chapter.attempts]
        .reverse()
        .find((row) => (row.attempt.ai_assessment?.weak_areas || []).length > 0);
      chapter.weakArea = assessedRow?.attempt.ai_assessment?.weak_areas?.[0] || null;

      for (const row of chapter.attempts) {
        const review = row.attempt.review_plan;
        if (review && review.status !== "completed" && row.percent < PASS_SCORE) {
          chapter.pendingReviewId = review.id;
        }
      }
      if (!chapter.pendingReviewId) {
        const retake = quizzes.find(
          (quiz) =>
            quiz.is_retake &&
            quiz.review_plan_id &&
            quiz.review_status !== "completed" &&
            chapter.sessions.some((session) => session.id === quiz.study_session_id)
        );
        if (retake?.review_plan_id && (chapter.current ?? 100) < PASS_SCORE) {
          chapter.pendingReviewId = retake.review_plan_id;
        }
      }

      chapter.nextSession = chapter.sessions.find(
        (session) =>
          session.status !== "completed" &&
          toDateKey(session.scheduled_start || new Date()) >= todayKey
      );
    }

    const tested = chapters.filter((chapter) => chapter.current !== null);
    const mastered = tested.filter((chapter) => (chapter.current ?? 0) >= MASTERY_SCORE);
    // Chương có lộ trình ôn tập đang chờ (đang khóa buổi học sau) được ưu tiên trước.
    const needWork = tested
      .filter((chapter) => (chapter.current ?? 0) < MASTERY_SCORE)
      .sort(
        (a, b) =>
          Number(Boolean(b.pendingReviewId)) - Number(Boolean(a.pendingReviewId)) ||
          (a.current ?? 0) - (b.current ?? 0)
      );
    const completedChapters = chapters.filter(
      (chapter) =>
        chapter.sessions.length > 0 &&
        chapter.sessions.every((session) => session.status === "completed")
    );
    const remainingChapters = chapters.filter(
      (chapter) => !completedChapters.includes(chapter)
    );
    const lastSession = orderedSessions[orderedSessions.length - 1];
    const completedSessions = sessions.filter((session) => session.status === "completed").length;
    /* Bài tiếp theo để học: buổi đầu tiên (theo lịch) chưa làm bài kiểm tra */
    const quizzedSessionIds = new Set(
      rows.map((row) => row.session?.id).filter(Boolean)
    );
    const nextLesson =
      orderedSessions.find(
        (session) =>
          !quizzedSessionIds.has(session.id) && session.status !== "completed"
      ) || orderedSessions.find((session) => !quizzedSessionIds.has(session.id));

    const upcomingNew = orderedSessions.find(
      (session) =>
        session.status !== "completed" &&
        toDateKey(session.scheduled_start || new Date()) >= todayKey
    );

    /* ---------- Điểm theo tuần: tổng hợp từ từng bài kiểm tra ---------- */
    const studyDates = Array.from(
      new Set(orderedSessions.map((session) => toDateKey(session.scheduled_start || new Date())))
    ).sort();
    const perWeek = Number(plan?.study_days_per_week || 0);
    const firstMonday = (() => {
      if (!studyDates[0]) return 0;
      const first = new Date(`${studyDates[0]}T00:00:00Z`);
      return first.getTime() - ((first.getUTCDay() + 6) % 7) * 86_400_000;
    })();
    const weekOf = (dateKey: string, dayNumber: number) =>
      perWeek > 0
        ? Math.floor((dayNumber - 1) / perWeek) + 1
        : Math.floor((new Date(`${dateKey}T00:00:00Z`).getTime() - firstMonday) / (7 * 86_400_000)) + 1;

    const weekMap = new Map<number, WeekScore>();
    for (const session of orderedSessions) {
      const dateKey = toDateKey(session.scheduled_start || new Date());
      const dayNumber = studyDates.indexOf(dateKey) + 1;
      const number = weekOf(dateKey, dayNumber);
      const sessionRows = rows.filter((row) => row.session?.id === session.id);
      const main = [...sessionRows].reverse().find((row) => !row.isRetake);
      const retake = [...sessionRows].reverse().find((row) => row.isRetake);
      const latest = sessionRows[sessionRows.length - 1];
      const week = weekMap.get(number) || {
        number,
        startKey: dateKey,
        endKey: dateKey,
        lessons: [],
        tested: 0,
        average: null,
        firstAverage: null,
      };
      week.endKey = dateKey > week.endKey ? dateKey : week.endKey;
      week.startKey = dateKey < week.startKey ? dateKey : week.startKey;
      week.lessons.push({
        session,
        topic: topicById.get(session.topic_id),
        dayNumber,
        dateKey,
        main,
        retake,
        current: latest ? latest.percent : null,
        latest,
      });
      weekMap.set(number, week);
    }
    const weeks = Array.from(weekMap.values()).sort((a, b) => a.number - b.number);
    for (const week of weeks) {
      const tested = week.lessons.filter((lesson) => lesson.current !== null);
      week.tested = tested.length;
      week.average = average(tested.map((lesson) => lesson.current as number));
      week.firstAverage = average(
        week.lessons.filter((lesson) => lesson.main).map((lesson) => lesson.main!.percent)
      );
    }

    return {
      weeks,
      rows,
      chapters,
      tested,
      mastered,
      needWork,
      completedChapters,
      remainingChapters,
      lastSessionDate: lastSession?.scheduled_start,
      completedSessions,
      totalSessions: sessions.length,
      totalQuestions: rows.reduce((sum, row) => sum + Number(row.attempt.total_questions || 0), 0),
      lastUpdated: rows[rows.length - 1]?.attempt.submitted_at,
      nextLesson,
      nextLessonChapter: nextLesson
        ? ensureChapter(topicById.get(nextLesson.topic_id))
        : undefined,
      nextChapter: upcomingNew ? ensureChapter(topicById.get(upcomingNew.topic_id)) : undefined,
    };
  }, [attempts, quizzes, sessions, topics, plan]);

  /* ---------- Hiển thị ---------- */

  if (isLoading) {
    return (
      <div className="sp-card mx-auto max-w-5xl p-10 text-center text-[var(--sp-muted)]">
        <Sparkle size={22} className="sp-twinkle mx-auto mb-3 text-[var(--sp-pink)]" />
        Đang tổng hợp kết quả học tập...
      </div>
    );
  }

  if (error || !subject || !plan) {
    return (
      <div className="sp-card mx-auto max-w-3xl px-6 py-12 text-center">
        <p className="font-bold text-[var(--sp-ink)]">
          {error || "Chưa có môn học nào để đánh giá"}
        </p>
        <p className="mt-1 text-sm text-[var(--sp-muted)]">
          Tạo kế hoạch ôn thi và làm bài kiểm tra sau mỗi buổi học để xem đánh giá năng lực.
        </p>
        <Link href="/study-plans" className="sp-btn sp-btn-primary mt-5 px-5 py-2.5 text-sm">
          Tạo kế hoạch ôn thi
        </Link>
      </div>
    );
  }

  const {
    rows,
    chapters,
    tested,
    mastered,
    needWork,
    completedChapters,
    remainingChapters,
  } = analysis;
  const percent = analysis.totalSessions
    ? Math.round((analysis.completedSessions / analysis.totalSessions) * 100)
    : 0;
  const priorities = needWork.slice(0, 2);
  const history = [...rows]
    .reverse()
    .filter((row) => historyFilter === "all" || row.percent < MASTERY_SCORE);

  const historyDays = [
    ...history
      .reduce((map, row) => {
        const day = row.attempt.submitted_at ? formatDate(row.attempt.submitted_at) : "";
        map.set(day, [...(map.get(day) || []), row]);
        return map;
      }, new Map<string, AttemptRow[]>())
      .entries(),
  ];

  const nextAdvice = (() => {
    const first = priorities[0];
    const next = analysis.nextLessonChapter || analysis.nextChapter;
    if (first && next && next.key !== first.key) {
      return `Ôn lại ${first.code} · ${first.shortTitle} trước, sau đó học tiếp ${next.code} · ${next.shortTitle}.`;
    }
    if (first) return `Ôn lại ${first.code} · ${first.shortTitle} rồi làm lại bài kiểm tra.`;
    if (next) return `Bạn đang làm tốt! Tiếp tục học ${next.code} · ${next.shortTitle} theo lịch.`;
    return "Bạn đã hoàn thành lộ trình. Hãy ôn Flashcards để giữ kiến thức trước ngày thi.";
  })();
  /* Tiếp tục luyện tập → Tài liệu học tập của môn này, mở đúng bài tiếp theo */
  const continueHref = `/study-materials?subject=${encodeURIComponent(subject.id)}${
    analysis.nextLesson ? `&session=${encodeURIComponent(analysis.nextLesson.id)}` : ""
  }`;
  const continueLabel = analysis.nextLessonChapter
    ? `Tiếp tục luyện tập · ${analysis.nextLessonChapter.code}`
    : "Tiếp tục luyện tập";

  return (
    <div className={`mx-auto max-w-[1240px] space-y-6 transition-opacity ${isLoadingPlan ? "opacity-60" : ""}`}>
      {/* Tiêu đề + chọn môn */}
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <nav className="mb-3 flex items-center gap-1.5 text-sm font-medium text-[var(--sp-muted)]">
            Đánh giá năng lực
            <IconChevronRight size={14} />
            <span className="text-[var(--sp-text-2)]">{subject.name}</span>
          </nav>
          <h1 className="flex items-end gap-3 text-[44px] sm:text-[56px]">
            <span>
              Đánh giá <span className="sp-squiggle">năng lực</span>
            </span>
            <Sparkle size={26} className="sp-twinkle mb-4 text-[var(--sp-yellow)]" />
          </h1>
          <p className="mt-2 text-[15px] text-[var(--sp-muted)]">
            {rows.length > 0
              ? `Tổng hợp từ ${analysis.totalQuestions} câu hỏi qua ${rows.length} lượt kiểm tra · cập nhật ngày ${formatDate(analysis.lastUpdated)}`
              : "Chưa có lượt kiểm tra nào. Làm Quiz sau mỗi buổi học để xem đánh giá."}
          </p>
        </div>

        <SubjectSelect
          subjects={subjectsWithPlan}
          value={subject.id}
          onChange={(id) => router.push(`${pathname}?subject=${encodeURIComponent(id)}`)}
        />
      </section>

      {/* Thẻ tổng quan */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard
          icon={<IconCalendar size={22} />}
          iconStyle="bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]"
          label="Tiến độ kế hoạch"
        >
          <p className="text-[30px] font-extrabold leading-tight text-[var(--sp-ink)]">
            {percent}%
            <span className="ml-1.5 text-base font-semibold text-[var(--sp-muted)]">
              · {analysis.completedSessions}/{analysis.totalSessions} buổi
            </span>
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--sp-surface-2)]">
            <div className="h-full rounded-full bg-[var(--sp-peri)]" style={{ width: `${percent}%` }} />
          </div>
        </StatCard>

        <StatCard
          icon={<IconBook size={22} />}
          iconStyle="bg-emerald-50 text-emerald-700"
          label="Chương đã học"
        >
          <p className="text-[30px] font-extrabold leading-tight text-[var(--sp-ink)]">
            {completedChapters.length}
            <span className="text-lg font-semibold text-[var(--sp-muted)]">/{chapters.length} chương</span>
          </p>
          <p className="truncate text-sm text-[var(--sp-muted)]">
            {remainingChapters.length > 0
              ? `${remainingChapters.map((item) => item.code).slice(0, 4).join(", ")}${remainingChapters.length > 4 ? "…" : ""} theo lịch đến ${formatDate(analysis.lastSessionDate).slice(0, 5)}`
              : "Đã học hết các chương"}
          </p>
        </StatCard>

        <StatCard
          icon={<IconAlert size={22} />}
          iconStyle="bg-[var(--sp-amber-bg)] text-[var(--sp-amber-dark)]"
          label="Cần ôn lại"
        >
          <p className="text-[30px] font-extrabold leading-tight text-[var(--sp-amber-dark)]">
            {needWork.length}
            <span className="ml-1 text-lg font-semibold text-[var(--sp-muted)]">chương</span>
          </p>
          <p className="truncate text-sm text-[var(--sp-muted)]">
            {needWork.length > 0
              ? needWork.map((item) => item.code).join(", ") + " dưới 80%"
              : tested.length > 0
                ? "Các chương đã kiểm tra đều nắm vững"
                : "Chưa có dữ liệu kiểm tra"}
          </p>
        </StatCard>
      </section>

      {/* Mức nắm vững + điểm yếu */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_370px]">
        <section className="sp-card p-5 sm:p-7">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="sp-accent text-[17px] text-[var(--sp-pink)]">
                Tổng hợp điểm sau từng bài kiểm tra
              </p>
              <h2 className="text-[22px] text-[var(--sp-ink)]">Nắm vững đến đâu?</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="sp-chip bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]">
                {analysis.weeks.length} tuần
              </span>
              <span className="sp-chip bg-emerald-50 text-emerald-700">
                {analysis.weeks.reduce((sum, week) => sum + week.tested, 0)}/
                {analysis.weeks.reduce((sum, week) => sum + week.lessons.length, 0)} bài đã kiểm tra
              </span>
              <span className="sp-chip bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]">
                {analysis.weeks.reduce(
                  (sum, week) =>
                    sum + week.lessons.filter((lesson) => lesson.current !== null && lesson.current < MASTERY_SCORE).length,
                  0
                )}{" "}
                bài dưới 80%
              </span>
            </div>
          </div>

          {analysis.weeks.length === 0 ? (
            <p className="rounded-2xl bg-[var(--sp-surface-2)] p-6 text-center text-sm text-[var(--sp-muted)]">
              Chưa có lịch học cho môn này.
            </p>
          ) : (
            <div className="space-y-4">
              {analysis.weeks.map((week, index) => (
                <WeekCard
                  key={week.number}
                  week={week}
                  tint={index % 2 === 0 ? "peri" : "pink"}
                  defaultOpen={
                    week.number ===
                    ([...analysis.weeks].reverse().find((item) => item.tested > 0)?.number ?? analysis.weeks[0].number)
                  }
                />
              ))}
            </div>
          )}

          <p className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-[var(--sp-muted)]">
            <span className="flex items-center gap-1.5">
              <span className="h-3 border-l-2 border-dashed border-[var(--sp-text-2)]" />
              Ngưỡng nắm vững {MASTERY_SCORE}%
            </span>
            <span>Điểm tuần = trung bình điểm mới nhất của các bài đã kiểm tra trong tuần</span>
          </p>
        </section>

        <section className="rounded-[22px] border-2 border-[var(--sp-purple)] bg-white p-5 shadow-[6px_6px_0_var(--sp-pink-line)] sm:p-6">
          <p className="sp-accent text-[17px] text-[var(--sp-pink)]">Phát hiện từ kết quả câu hỏi</p>
          <h2 className="text-[22px] text-[var(--sp-ink)]">Đang yếu phần nào?</h2>

          <div className="mt-4 space-y-3">
            {priorities.length === 0 ? (
              <div className="rounded-2xl border border-[var(--sp-line)] bg-[var(--sp-surface-2)] p-5 text-center">
                <Sparkle size={22} className="mx-auto mb-2 text-[var(--sp-yellow)]" />
                <p className="font-bold text-[var(--sp-ink)]">
                  {tested.length > 0 ? "Chưa phát hiện phần yếu" : "Chưa có bài kiểm tra"}
                </p>
                <p className="mt-1 text-sm text-[var(--sp-muted)]">
                  {tested.length > 0
                    ? "Các chương đã kiểm tra đều đạt từ 80% trở lên."
                    : "Làm Quiz sau mỗi buổi học để AI chỉ ra phần bạn còn yếu."}
                </p>
              </div>
            ) : (
              priorities.map((chapter, index) => (
                <PriorityCard key={chapter.key} chapter={chapter} rank={index + 1} />
              ))
            )}
          </div>

          {mastered.length > 0 && (
            <p className="mt-3 flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <IconCheck size={16} className="shrink-0" />
              {mastered.map((item) => item.code).join(", ")} đã nắm vững, chỉ cần ôn theo lịch
            </p>
          )}
        </section>
      </div>

      {/* Gợi ý tiếp theo */}
      <section className="flex flex-col gap-4 rounded-[24px] bg-[var(--sp-purple)] px-5 py-5 text-white shadow-[6px_6px_0_var(--sp-lav-line)] sm:px-7 lg:flex-row lg:items-center">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--sp-pink)] text-white">
          <IconTarget size={24} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="sp-accent text-[17px] text-[#ffbcd3]">Tiếp theo nên ôn gì?</p>
          <p className="text-[17px] font-semibold">{nextAdvice}</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Link
            href={`/materials?subject=${encodeURIComponent(subject.id)}`}
            className="sp-btn border-2 border-white/25 px-4 py-2.5 text-sm text-white hover:bg-white/10"
          >
            <IconFile size={16} />
            Xem lại nội dung
          </Link>
          <Link
            href={`/study-plans/${plan.id}`}
            className="sp-btn border-2 border-white/25 px-4 py-2.5 text-sm text-white hover:bg-white/10"
          >
            <IconCalendar size={16} />
            Về kế hoạch ôn tập
          </Link>
          <Link
            href={continueHref}
            className="sp-btn border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-yellow)] px-5 py-2.5 text-sm text-[var(--sp-purple-deep)] shadow-[3px_3px_0_var(--sp-purple-deep)] hover:-translate-y-0.5"
          >
            <IconPlay size={16} />
            {continueLabel}
          </Link>
        </div>
      </section>

      {/* Lịch sử bài kiểm tra */}
      <section className="sp-card p-5 sm:p-7">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="sp-accent text-[17px] text-[var(--sp-pink)]">Điểm số được lưu sau mỗi lần làm</p>
            <h2 className="text-[22px] text-[var(--sp-ink)]">Lịch sử bài kiểm tra</h2>
          </div>
          <div className="flex rounded-xl bg-[var(--sp-surface-2)] p-1">
            {(
              [
                ["all", `Tất cả (${rows.length})`],
                ["improve", `Cần cải thiện (${rows.filter((row) => row.percent < MASTERY_SCORE).length})`],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={historyFilter === value}
                onClick={() => setHistoryFilter(value)}
                className={`rounded-lg px-3.5 py-1.5 text-sm font-bold transition ${
                  historyFilter === value
                    ? "bg-white text-[var(--sp-peri-dark)] shadow-sm"
                    : "text-[var(--sp-muted)] hover:text-[var(--sp-ink)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {history.length === 0 ? (
          <p className="rounded-2xl bg-[var(--sp-surface-2)] p-6 text-center text-sm text-[var(--sp-muted)]">
            {rows.length === 0
              ? "Chưa có bài kiểm tra nào cho môn này."
              : "Không có bài nào dưới 80%. Tuyệt vời!"}
          </p>
        ) : (
          <div className="space-y-4">
            {historyDays.map(([day, items]) => (
              <div key={day} className="flex flex-col gap-2 sm:flex-row sm:gap-4">
                <div className="flex shrink-0 flex-col items-center justify-center rounded-2xl border-2 border-[var(--sp-line)] bg-white px-2 py-3 text-center sm:w-[110px]">
                  <p className="text-xs font-semibold text-[var(--sp-muted)]">
                    {formatWeekday(items[0].attempt.submitted_at!)}
                  </p>
                  <p className="font-extrabold text-[var(--sp-purple)]">
                    {formatDate(items[0].attempt.submitted_at).slice(0, 5)}
                  </p>
                  <p className="text-xs text-[var(--sp-muted)]">
                    {items.length} bài
                    {items.some((row) => row.percent < MASTERY_SCORE) &&
                      ` · ${items.filter((row) => row.percent < MASTERY_SCORE).length} cần ôn`}
                  </p>
                </div>
                <ul className="min-w-0 flex-1 space-y-2.5">
                  {items.map((row) => (
                    <HistoryRow
                      key={row.attempt.attempt_id}
                      row={row}
                      chapter={chapters.find((item) => item.key === row.chapterKey)}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ================= Thành phần con ================= */

function SubjectSelect({
  subjects,
  value,
  onChange,
}: {
  subjects: Subject[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = subjects.find((subject) => subject.id === value);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative w-full shrink-0 sm:w-[260px]">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((state) => !state)}
        className="flex w-full items-center gap-2.5 rounded-2xl border-2 border-[var(--sp-line)] bg-white px-4 py-3 text-left font-bold text-[var(--sp-ink)] transition hover:border-[var(--sp-lav-line)]"
      >
        <IconBook size={18} className="shrink-0 text-[var(--sp-peri-dark)]" />
        <span className="min-w-0 flex-1 truncate">{current?.name || "Chọn môn học"}</span>
        <IconChevronDown size={17} className={`shrink-0 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute right-0 z-20 mt-2 w-full overflow-hidden rounded-2xl border-2 border-[var(--sp-purple)] bg-white p-1.5 shadow-[5px_5px_0_var(--sp-lav-line)]"
        >
          {subjects.map((subject) => {
            const selected = subject.id === value;
            return (
              <li key={subject.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    setOpen(false);
                    if (!selected) onChange(subject.id);
                  }}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                    selected ? "bg-[var(--sp-lav)]" : "hover:bg-[var(--sp-surface-2)]"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-[var(--sp-ink)]">
                      {subject.name}
                    </span>
                    <span className="text-xs text-[var(--sp-muted)]">
                      Tạo ngày {formatDate(subject.created_at)}
                    </span>
                  </span>
                  {selected && <IconCheck size={16} className="text-[var(--sp-peri-dark)]" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StatCard({
  icon,
  iconStyle,
  label,
  children,
}: {
  icon: React.ReactNode;
  iconStyle: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="sp-card flex items-center gap-4 p-5">
      <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${iconStyle}`}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[var(--sp-text-2)]">{label}</p>
        {children}
      </div>
    </div>
  );
}

function WeekCard({
  week,
  tint,
  defaultOpen,
}: {
  week: WeekScore;
  tint: "peri" | "pink";
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const level = getLevel(week.average);
  const stripe = tint === "peri" ? "bg-[var(--sp-peri)]" : "bg-[var(--sp-pink)]";
  const badge =
    tint === "peri"
      ? "bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]"
      : "bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]";
  const improved =
    week.average !== null && week.firstAverage !== null && week.average > week.firstAverage;

  return (
    <article className="relative overflow-hidden rounded-[20px] border-2 border-[var(--sp-line)] bg-white">
      <span className={`absolute inset-y-0 left-0 w-1.5 ${stripe}`} aria-hidden="true" />
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 py-4 pl-5 pr-4 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:pl-6">
        <div className={`flex h-14 w-14 flex-col items-center justify-center rounded-2xl ${badge}`}>
          <span className="text-[10px] font-bold uppercase tracking-wide">Tuần</span>
          <span className="text-[22px] font-extrabold leading-none">{week.number}</span>
        </div>

        <div className="min-w-0">
          <p className="font-bold text-[var(--sp-ink)]">
            {formatDayMonth(week.startKey)} – {formatDayMonth(week.endKey)}
          </p>
          <p className="text-[13px] text-[var(--sp-muted)]">
            {week.tested}/{week.lessons.length} bài đã kiểm tra
            {improved && (
              <span className="ml-1.5 font-semibold text-emerald-700">
                · tăng từ {week.firstAverage}% sau kiểm tra lại
              </span>
            )}
          </p>
          <div className="relative mt-2 h-2.5 rounded-full bg-[var(--sp-surface-2)]">
            {week.average === null ? (
              <div className="h-full rounded-full bg-[repeating-linear-gradient(135deg,#ece6ef_0_6px,#f7f5fa_6px_12px)]" />
            ) : (
              <div
                className={`h-full rounded-full transition-all duration-700 ${level.bar}`}
                style={{ width: `${Math.max(3, week.average)}%` }}
              />
            )}
            <span
              className="absolute -top-1 h-[18px] border-l-2 border-dashed border-[var(--sp-text-2)]/50"
              style={{ left: `${MASTERY_SCORE}%` }}
              aria-hidden="true"
            />
          </div>
        </div>

        <div className="col-span-2 flex items-center gap-3 sm:col-span-1">
          <p className={`text-[26px] font-extrabold leading-none ${week.average === null ? "text-[var(--sp-soft)]" : "text-[var(--sp-ink)]"}`}>
            {week.average === null ? "–" : `${week.average}%`}
          </p>
          <span className={`sp-chip ${level.chip}`}>{level.label}</span>
        </div>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="col-span-2 flex items-center justify-center gap-1.5 rounded-xl border-2 border-[var(--sp-line)] px-3 py-2 text-sm font-bold text-[var(--sp-peri-dark)] transition hover:border-[var(--sp-lav-line)] sm:col-span-1"
        >
          {open ? "Thu gọn" : "Xem chi tiết"}
          <IconChevronDown size={16} className={`transition ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {open && (
        <ul className="sp-task-expand divide-y divide-[var(--sp-line)] border-t-2 border-dashed border-[var(--sp-line)] bg-[var(--sp-surface-2)]/50 pl-5 sm:pl-6">
          {week.lessons.map((lesson) => {
            const lessonLevel = getLevel(lesson.current);
            return (
              <li
                key={lesson.session.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 py-3 pr-4 sm:grid-cols-[minmax(0,1fr)_200px_56px_auto]"
              >
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wide text-[var(--sp-purple)]">
                    Ngày học {lesson.dayNumber} · {formatDayMonth(lesson.dateKey)}
                  </p>
                  <p className="truncate font-semibold text-[var(--sp-ink)]">
                    {lesson.topic ? getMainTopicTitle(lesson.topic.name) : "Bài học"}
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-1.5 text-[12px]">
                    {lesson.main && (
                      <span className="rounded-full bg-white px-2 py-0.5 font-semibold text-[var(--sp-text-2)]">
                        Lần đầu {lesson.main.percent}%
                      </span>
                    )}
                    {lesson.retake && (
                      <span className="rounded-full bg-[var(--sp-pink-bg)] px-2 py-0.5 font-semibold text-[var(--sp-pink-dark)]">
                        Kiểm tra lại {lesson.retake.percent}%
                      </span>
                    )}
                  </p>
                </div>

                <div className="order-3 col-span-2 h-2 overflow-hidden rounded-full bg-white sm:order-none sm:col-span-1">
                  {lesson.current === null ? (
                    <div className="h-full bg-[repeating-linear-gradient(135deg,#ece6ef_0_6px,#f7f5fa_6px_12px)]" />
                  ) : (
                    <div className={`h-full rounded-full ${lessonLevel.bar}`} style={{ width: `${Math.max(3, lesson.current)}%` }} />
                  )}
                </div>

                <p className={`text-right text-lg font-extrabold ${lesson.current === null ? "text-[var(--sp-soft)]" : lessonLevel.text}`}>
                  {lesson.current === null ? "–" : `${lesson.current}%`}
                </p>

                {lesson.latest ? (
                  <Link
                    href={`/quiz-results/${lesson.latest.attempt.attempt_id}`}
                    className="hidden items-center gap-1 text-sm font-bold text-[var(--sp-peri-dark)] hover:underline sm:flex"
                  >
                    Xem bài
                    <IconArrowRight size={14} />
                  </Link>
                ) : (
                  <span className="hidden text-xs font-semibold text-[var(--sp-muted)] sm:block">Chưa kiểm tra</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}

function formatDayMonth(dateKey: string) {
  const [, month, day] = dateKey.split("-");
  return `${day}/${month}`;
}

function MasteryRow({ chapter }: { chapter: ChapterStat }) {
  const level = getLevel(chapter.current);
  const diff =
    chapter.current !== null && chapter.previous !== null
      ? chapter.current - chapter.previous
      : null;

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 py-4 sm:grid-cols-[minmax(0,190px)_minmax(0,1fr)_52px_112px]">
      <p className="min-w-0 truncate font-semibold text-[var(--sp-ink)]" title={chapter.title}>
        <span className="mr-2 font-bold text-[var(--sp-muted)]">{chapter.code}</span>
        {chapter.shortTitle}
      </p>

      <div className="order-3 col-span-2 sm:order-none sm:col-span-1">
        <div className="relative h-3 rounded-full bg-[var(--sp-surface-2)]">
          {chapter.current === null ? (
            <div className="h-full rounded-full bg-[repeating-linear-gradient(135deg,#ece6ef_0_6px,#f7f5fa_6px_12px)]" />
          ) : (
            <div
              className={`h-full rounded-full transition-all duration-700 ${level.bar}`}
              style={{ width: `${Math.max(3, chapter.current)}%` }}
            />
          )}
          <span
            className="absolute -top-1.5 h-6 border-l-2 border-dashed border-[var(--sp-text-2)]/50"
            style={{ left: `${MASTERY_SCORE}%` }}
            aria-hidden="true"
          />
        </div>
        {chapter.previous !== null && diff !== null && (
          <p className="mt-1 flex items-center gap-1.5 whitespace-nowrap text-[12.5px] text-[var(--sp-muted)]">
            {diff >= 0 ? (
              <IconTrendUp size={14} className="text-emerald-600" />
            ) : (
              <IconTrendDown size={14} className="text-[var(--sp-pink)]" />
            )}
            Lần trước {chapter.previous}%
            <span className={diff >= 0 ? "text-emerald-700" : "text-[var(--sp-pink-dark)]"}>
              ({diff >= 0 ? "+" : ""}
              {diff}%)
            </span>
          </p>
        )}
      </div>

      <p className={`text-right text-lg font-extrabold ${chapter.current === null ? "text-[var(--sp-soft)]" : "text-[var(--sp-ink)]"}`}>
        {chapter.current === null ? "–" : `${chapter.current}%`}
      </p>

      <span className={`sp-chip hidden w-fit sm:inline-flex ${level.chip}`}>{level.label}</span>
    </li>
  );
}

function PriorityCard({ chapter, rank }: { chapter: ChapterStat; rank: number }) {
  const isFirst = rank === 1;
  const level = getLevel(chapter.current);
  const weakName = chapter.weakArea?.topic_name || chapter.weakArea?.description;

  return (
    <article
      className={`rounded-2xl border-2 p-4 ${
        isFirst
          ? "border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)]"
          : "border-[var(--sp-line)] bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span
            className={`sp-chip ${
              isFirst
                ? "bg-white text-[var(--sp-pink-dark)]"
                : "bg-[var(--sp-amber-bg)] text-[var(--sp-amber-dark)]"
            }`}
          >
            Ưu tiên {rank}
          </span>
          <h3 className="mt-2 text-[17px] text-[var(--sp-ink)]">
            {chapter.code}. {chapter.shortTitle}
          </h3>
        </div>
        <p className={`text-[28px] font-extrabold leading-none ${level.text}`}>{chapter.current}%</p>
      </div>

      <ul className="mt-3 space-y-2 text-[14.5px] text-[var(--sp-text-2)]">
        {weakName && (
          <li className="flex gap-2">
            <IconAlert size={16} className="mt-0.5 shrink-0 text-[var(--sp-pink)]" />
            <span>
              Sai nhiều nhất ở phần{" "}
              <strong className="text-[var(--sp-ink)]">{weakName}</strong>
            </span>
          </li>
        )}
        <li className="flex gap-2">
          {chapter.pendingReviewId ? (
            <>
              <IconRepeat size={16} className="mt-0.5 shrink-0 text-[var(--sp-pink)]" />
              <span>
                Có lộ trình ôn tập đang chờ ·{" "}
                <Link
                  href={`/review-plans/${chapter.pendingReviewId}`}
                  className="font-bold text-[var(--sp-peri-dark)] hover:underline"
                >
                  Ôn ngay
                </Link>
              </span>
            </>
          ) : chapter.nextSession?.scheduled_start ? (
            <>
              <IconCalendar size={16} className="mt-0.5 shrink-0 text-[var(--sp-pink)]" />
              <span>
                Học tiếp vào{" "}
                <strong className="text-[var(--sp-ink)]">
                  {formatDayLabel(chapter.nextSession.scheduled_start)}
                </strong>
              </span>
            </>
          ) : (
            <>
              <IconRepeat size={16} className="mt-0.5 shrink-0 text-[var(--sp-pink)]" />
              <span>
                Làm lại bài kiểm tra trong mục{" "}
                <Link href="/quizzes" className="font-bold text-[var(--sp-peri-dark)] hover:underline">
                  Kiểm tra kiến thức
                </Link>
              </span>
            </>
          )}
        </li>
      </ul>
    </article>
  );
}

function HistoryRow({ row, chapter }: { row: AttemptRow; chapter: ChapterStat | undefined }) {
  const level = getLevel(row.percent);
  const diff = row.previousPercent !== null ? row.percent - row.previousPercent : null;
  const title = row.topic ? getMainTopicTitle(row.topic.name) : row.attempt.quiz_title || "Bài kiểm tra";

  return (
    <li className="group flex flex-col gap-3 rounded-2xl border-2 border-[var(--sp-line)] bg-white px-4 py-3.5 transition hover:border-[var(--sp-lav-line)] sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-semibold text-[var(--sp-ink)]">
          {title}
          {row.isRetake && (
            <span className="sp-chip bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]">
              <IconRepeat size={12} />
              Làm lại
            </span>
          )}
        </p>
        <p className="text-xs text-[var(--sp-muted)]">
          {chapter ? `${chapter.code} · ${chapter.shortTitle}` : "—"} · đúng {row.attempt.correct_count ?? 0}/
          {row.attempt.total_questions ?? 0} câu
        </p>
      </div>

      <div className="flex items-center gap-3 sm:w-[260px]">
        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--sp-surface-2)]">
          <div className={`h-full rounded-full ${level.bar}`} style={{ width: `${Math.max(3, row.percent)}%` }} />
        </div>
        <span className="w-12 text-right text-lg font-extrabold text-[var(--sp-ink)]">{row.percent}%</span>
        <span
          className={`w-14 text-right text-xs font-bold ${
            diff === null
              ? "text-[var(--sp-soft)]"
              : diff >= 0
                ? "text-emerald-700"
                : "text-[var(--sp-pink-dark)]"
          }`}
        >
          {diff === null ? "Lần đầu" : `${diff >= 0 ? "+" : ""}${diff}%`}
        </span>
      </div>

      <Link
        href={`/quiz-results/${row.attempt.attempt_id}`}
        className="sp-btn sp-btn-secondary shrink-0 px-4 py-2 text-sm"
      >
        Xem bài
        <IconArrowRight size={15} className="transition group-hover:translate-x-0.5" />
      </Link>
    </li>
  );
}

/* useSearchParams cần nằm trong Suspense để "next build" không báo lỗi */
export default function WeakAreasPage() {
  return (
    <Suspense fallback={null}>
      <WeakAreasPageContent />
    </Suspense>
  );
}

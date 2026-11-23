"use client";

import { currentLocale, tx } from "@/lib/i18n";
import { useEffect, useMemo, useRef, useState, Suspense } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SmartLoading } from "@/components/loading-play";
import { getMainTopicTitle } from "@/lib/content-titles";
import {
  IconAlert,
  IconArrowRight,
  IconBook,
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconClock,
  IconFile,
  IconFlag,
  IconPlay,
  IconRepeat,
  IconTarget,
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
  review_date?: string | null;
  is_unlocked?: boolean;
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
    throw new Error(result?.detail || tx("Không thể tải dữ liệu."));
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
  return new Date(value).toLocaleDateString(currentLocale(), {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
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
      label: tx("Chưa kiểm tra"),
      chip: "bg-[var(--sp-surface-2)] text-[var(--sp-muted)]",
      bar: "",
      text: "text-[var(--sp-muted)]",
    };
  }
  if (percent >= MASTERY_SCORE) {
    return {
      label: tx("Nắm vững"),
      chip: "bg-emerald-50 text-emerald-700",
      bar: "bg-emerald-500",
      text: "text-emerald-700",
    };
  }
  if (percent >= PASS_SCORE) {
    return {
      label: tx("Cần cải thiện"),
      chip: "bg-[var(--sp-amber-bg)] text-[var(--sp-amber-dark)]",
      bar: "bg-[#E6A23C]",
      text: "text-[var(--sp-amber-dark)]",
    };
  }
  return {
    label: tx("Cần ôn lại"),
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
  const [holdLoading, setHoldLoading] = useState(false);
  const [isLoadingPlan, setIsLoadingPlan] = useState(false);
  const [error, setError] = useState("");
  const [masteryView, setMasteryView] = useState<"chapter" | "week">("chapter");

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
            loadError instanceof Error ? loadError.message : tx("Không thể tải dữ liệu.")
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
            loadError instanceof Error ? loadError.message : tx("Không thể tải dữ liệu.")
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
          (topic ? getMainTopicTitle(topic.name) : tx("Nội dung khác"));
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
      lessons: weeks.flatMap((week) => week.lessons),
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

  if (isLoading || holdLoading) {
    return (
      <SmartLoading
        text={tx("Đang tổng hợp kết quả học tập…")}
        sub={tx("Pilot đang chấm lại từng bài kiểm tra, chờ mình xíu nhé!")}
        stages={[tx("Lấy bài làm"), tx("Tính điểm"), tx("Tìm phần yếu"), tx("Gợi ý ôn")]}
        continueLabel={tx("Xem đánh giá")}
        done={!isLoading}
        onHoldChange={setHoldLoading}
      />
    );
  }

  if (error || !subject || !plan) {
    return (
      <div className="sp-card mx-auto max-w-3xl px-6 py-12 text-center">
        <p className="font-bold text-[var(--sp-ink)]">
          {error || tx("Chưa có môn học nào để đánh giá")}
        </p>
        <p className="mt-1 text-sm text-[var(--sp-muted)]">

          {tx("Tạo kế hoạch ôn thi và làm bài kiểm tra sau mỗi buổi học để xem đánh giá năng lực.")}
        </p>
        <Link href="/study-plans" className="sp-btn sp-btn-primary mt-5 px-5 py-2.5 text-sm">

          {tx("Tạo kế hoạch ôn thi")}
        </Link>
      </div>
    );
  }

  const { rows, chapters, tested, mastered, needWork, lessons } = analysis;
  const todayKey = toDateKey(new Date());
  const percent = analysis.totalSessions
    ? Math.round((analysis.completedSessions / analysis.totalSessions) * 100)
    : 0;
  // Tài liệu có từ 2 chương trở lên thì đánh giá theo chương, còn lại theo từng bài học nhỏ.
  const byChapter = chapters.filter((chapter) => chapter.sessions.length > 0).length >= 2;
  const lessonBySession = new Map(lessons.map((lesson) => [lesson.session.id, lesson]));
  const chapterLessons = (chapter: ChapterStat) =>
    chapter.sessions.map((session) => lessonBySession.get(session.id)).filter((lesson): lesson is LessonScore => Boolean(lesson));
  const testedLessons = lessons.filter((lesson) => lesson.current !== null);
  const weakLessons = testedLessons.filter((lesson) => (lesson.current as number) < MASTERY_SCORE);

  const examKey = plan.exam_date ? toDateKey(plan.exam_date) : null;
  const daysLeft = examKey
    ? Math.max(0, Math.round((Date.parse(examKey) - Date.parse(todayKey)) / 86_400_000))
    : null;
  const lastStudy = analysis.lastSessionDate ? formatDate(analysis.lastSessionDate).slice(0, 5) : "";

  const lessonHref = (lesson: LessonScore, mode: "review" | "revisit") =>
    `/materials?subject=${encodeURIComponent(subject.id)}&session=${encodeURIComponent(lesson.session.id)}&mode=${mode}`;

  /* Trạng thái bài ôn của một bài học: ngày ôn đã chọn + nút đi tiếp */
  const reviewFor = (lesson: LessonScore): ReviewInfo => {
    const retake = [...quizzes]
      .reverse()
      .find((quiz) => quiz.is_retake && quiz.study_session_id === lesson.session.id && quiz.review_status !== "completed");
    if (!retake) {
      return { text: tx("Chưa có bài ôn cho bài này"), tone: "muted", rank: 3, primary: { label: tx("Xem lại bài"), href: lessonHref(lesson, "revisit") } };
    }
    if (!retake.review_date) {
      const attempt = (lesson.main || lesson.latest)?.attempt.attempt_id;
      return {
        text: tx("Chưa chọn ngày ôn"),
        tone: "pink",
        rank: 1,
        primary: { label: tx("Chọn ngày ôn"), href: attempt ? `/quiz-results/${attempt}` : lessonHref(lesson, "review") },
      };
    }
    const key = retake.review_date.slice(0, 10);
    const primary = retake.is_unlocked
      ? { label: tx("Làm bài ôn"), href: `/quizzes/${retake.id}` }
      : { label: tx("Vào ôn"), href: lessonHref(lesson, "review") };
    if (key > todayKey) return { text: tx("Bài ôn hẹn ngày {0}", [formatDayMonth(key)]), tone: "amber", rank: 2, primary };
    return {
      text: key === todayKey ? tx("Bài ôn đến hạn hôm nay") : tx("Bài ôn quá hạn từ {0}", [formatDayMonth(key)]),
      tone: "red",
      rank: 0,
      primary,
    };
  };

  /* Phần AI chỉ ra là còn yếu ở lần làm gần nhất của bài học */
  const missFor = (lesson: LessonScore) => {
    const row = [...rows]
      .reverse()
      .find((item) => item.session?.id === lesson.session.id && (item.attempt.ai_assessment?.weak_areas || []).length > 0);
    const area = row?.attempt.ai_assessment?.weak_areas?.[0];
    return area?.topic_name || area?.description || null;
  };
  const lessonName = (lesson: LessonScore) => (lesson.topic ? getMainTopicTitle(lesson.topic.name) : tx("Bài học"));
  const resultsHref = (lesson: LessonScore) =>
    lesson.latest ? `/quiz-results/${lesson.latest.attempt.attempt_id}` : null;

  const weakItems: WeakItem[] = byChapter
    ? needWork.slice(0, 2).map((chapter) => {
        const all = chapterLessons(chapter);
        const done = all.filter((lesson) => lesson.current !== null);
        const weakest = [...done].sort((a, b) => (a.current as number) - (b.current as number))[0];
        return {
          key: chapter.key,
          kicker: tx("{0} · {1}/{2} bài đã kiểm tra", [chapter.code.replace(/^C/, tx("Chương") + " "), done.length, all.length]),
          title: `${chapter.code}. ${chapter.shortTitle}`,
          score: chapter.current ?? 0,
          lines: [
            weakest ? { label: tx("Bài yếu nhất"), value: `${lessonName(weakest)} (${weakest.current}%)` } : null,
            weakest && missFor(weakest) ? { label: tx("Sai nhiều ở"), value: missFor(weakest) as string } : null,
          ].filter((line): line is { label: string; value: string } => Boolean(line)),
          review: weakest ? reviewFor(weakest) : null,
          resultsHref: weakest ? resultsHref(weakest) : null,
          stepLabel: chapter.code,
          stepText: chapter.shortTitle,
        };
      })
    : weakLessons
        .map((lesson) => ({ lesson, review: reviewFor(lesson) }))
        .sort(
          (a, b) =>
            a.review.rank - b.review.rank ||
            (a.lesson.current as number) - (b.lesson.current as number) ||
            a.lesson.dayNumber - b.lesson.dayNumber
        )
        .map(({ lesson, review }) => {
          const miss = missFor(lesson);
          return {
            key: lesson.session.id,
            kicker: tx("Ngày học {0} · {1}", [lesson.dayNumber, formatDayMonth(lesson.dateKey)]),
            title: lessonName(lesson),
            score: lesson.current as number,
            lines: miss ? [{ label: tx("Sai nhiều ở"), value: miss }] : [],
            review,
            resultsHref: resultsHref(lesson),
            stepLabel: tx("Ngày học {0}", [lesson.dayNumber]),
            stepText: lessonName(lesson),
          };
        });
  const shownWeak = weakItems.slice(0, byChapter ? 2 : 3);
  const moreWeak = byChapter ? 0 : weakItems.length - shownWeak.length;

  /* Tiếp theo: ôn phần yếu nhất, rồi học bài kế tiếp theo lịch */
  const nextLesson = analysis.nextLesson ? lessonBySession.get(analysis.nextLesson.id) : undefined;
  const nextChapter = analysis.nextLessonChapter || analysis.nextChapter;
  const learnStep = byChapter
    ? nextChapter && { label: nextChapter.code, text: nextChapter.shortTitle }
    : nextLesson && { label: tx("Ngày học {0}", [nextLesson.dayNumber]), text: lessonName(nextLesson) };
  const reviewStep = shownWeak[0] && { label: shownWeak[0].stepLabel, text: shownWeak[0].stepText };
  const shortStep = (label?: string) => (label ? label.replace(tx("Ngày học"), tx("Ngày")) : "—");

  /* Tiếp tục luyện tập → Tài liệu học tập của môn này, mở đúng bài tiếp theo */
  const continueHref = `/study-materials?subject=${encodeURIComponent(subject.id)}${
    analysis.nextLesson ? `&session=${encodeURIComponent(analysis.nextLesson.id)}` : ""
  }`;
  const continueLabel = learnStep ? tx("Tiếp tục luyện tập · {0}", [shortStep(learnStep.label)]) : tx("Tiếp tục luyện tập");

  const groupCards = byChapter && masteryView === "chapter"
    ? chapters
        .filter((chapter) => chapter.sessions.length > 0)
        .map((chapter, index) => {
          const items = chapterLessons(chapter);
          const doneSessions = chapter.sessions.filter((session) => session.status === "completed").length;
          return {
            key: chapter.key,
            kind: tx("Chương"),
            number: chapter.code.replace(/^C/, ""),
            title: chapter.shortTitle,
            sub: tx("{0}/{1} buổi đã học · {2} bài đã kiểm tra", [doneSessions, chapter.sessions.length, items.filter((lesson) => lesson.current !== null).length]),
            lessons: items,
            tint: index % 2 === 0 ? "peri" : "pink",
          } as const;
        })
    : analysis.weeks.map((week, index) => {
        const improved = week.average !== null && week.firstAverage !== null && week.average > week.firstAverage;
        return {
          key: String(week.number),
          kind: tx("Tuần"),
          number: String(week.number),
          title: `${formatDayMonth(week.startKey)} – ${formatDayMonth(week.endKey)}`,
          sub: tx("{0}/{1} bài đã kiểm tra{2}", [week.tested, week.lessons.length, improved ? tx("· tăng từ {0}% sau kiểm tra lại", [week.firstAverage]) : ""]),
          lessons: week.lessons,
          tint: index % 2 === 0 ? "peri" : "pink",
        } as const;
      });
  // Mở sẵn nhóm gần nhất đã có bài kiểm tra
  const openKey = [...groupCards].reverse().find((card) => card.lessons.some((lesson) => lesson.current !== null))?.key ?? groupCards[0]?.key;

  return (
    <div className={`mx-auto max-w-[1240px] space-y-7 transition-opacity ${isLoadingPlan ? "opacity-60" : ""}`}>
      {/* Tiêu đề + chọn môn */}
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <nav className="mb-3 flex items-center gap-1.5 text-sm font-medium text-[var(--sp-muted)]">

            {tx("Đánh giá năng lực")}
            <IconChevronRight size={14} />
            <span className="text-[var(--sp-text-2)]">{subject.name}</span>
          </nav>
          <h1 className="flex items-end gap-3 text-[44px] sm:text-[56px]">
            <span>

              {tx("Đánh giá")} <span className="sp-squiggle">{tx("năng lực")}</span>
            </span>
            <Sparkle size={26} className="sp-twinkle mb-4 text-[var(--sp-yellow)]" />
          </h1>
          <p className="mt-2 text-[15px] text-[var(--sp-muted)]">
            {rows.length > 0
              ? tx("Tổng hợp từ {0} câu hỏi qua {1} lượt kiểm tra · cập nhật ngày {2}", [analysis.totalQuestions, rows.length, formatDate(analysis.lastUpdated)])
              : tx("Chưa có lượt kiểm tra nào. Làm Quiz sau mỗi buổi học để xem đánh giá.")}
          </p>
        </div>

        <SubjectSelect
          subjects={subjectsWithPlan}
          value={subject.id}
          onChange={(id) => router.push(`${pathname}?subject=${encodeURIComponent(id)}`)}
        />
      </section>

      {/* Thẻ tổng quan: % kế hoạch · buổi đã hoàn thành · cần ôn lại */}
      <section className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <StatCard
          icon={<IconCalendar size={24} />}
          iconStyle="bg-[var(--sp-peri)]"
          shadow="shadow-[5px_5px_0_var(--sp-lav-line)] hover:shadow-[7px_7px_0_var(--sp-lav-line)]"
          label={tx("Tiến độ kế hoạch")}
        >
          <p className="text-[30px] font-extrabold leading-tight text-[var(--sp-ink)]">{percent}%</p>
          <div className="mt-2.5 h-2.5 overflow-hidden rounded-full border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-surface-2)]">
            <div className="h-full bg-[var(--sp-peri)] transition-all duration-700" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-2 text-[13px] text-[var(--sp-muted)]">
            {examKey ? tx("Thi ngày {0} · còn {1} ngày", [formatDayMonth(examKey), daysLeft]) : tx("Theo lịch đến {0}", [lastStudy])}
          </p>
        </StatCard>

        <StatCard
          icon={<IconCheck size={24} />}
          iconStyle="bg-emerald-500"
          shadow="shadow-[5px_5px_0_#a7e3c4] hover:shadow-[7px_7px_0_#a7e3c4]"
          label={tx("Buổi học đã hoàn thành")}
        >
          <p className="text-[30px] font-extrabold leading-tight text-[var(--sp-ink)]">
            {analysis.completedSessions}
            <span className="ml-1 text-base font-semibold text-[var(--sp-muted)]">{tx("/{0} buổi", [analysis.totalSessions])}</span>
          </p>
          {analysis.totalSessions <= 30 ? (
            <div className="mt-2.5 grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.max(1, analysis.totalSessions)}, minmax(0, 1fr))` }}>
              {Array.from({ length: analysis.totalSessions }, (_, index) => (
                <span
                  key={index}
                  className={`h-2.5 rounded border-2 ${
                    index < analysis.completedSessions
                      ? "border-[var(--sp-purple-deep)] bg-emerald-500"
                      : "border-[var(--sp-line)] bg-[var(--sp-surface-2)]"
                  }`}
                />
              ))}
            </div>
          ) : (
            // shortcut: quá 30 buổi thì vạch quá nhỏ, đổi sang một thanh liền
            <div className="mt-2.5 h-2.5 overflow-hidden rounded-full border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-surface-2)]">
              <div className="h-full bg-emerald-500" style={{ width: `${percent}%` }} />
            </div>
          )}
          <p className="mt-2 text-[13px] text-[var(--sp-muted)]">
            {analysis.totalSessions > analysis.completedSessions
              ? tx("Còn {0} buổi theo lịch đến {1}", [analysis.totalSessions - analysis.completedSessions, lastStudy])
              : tx("Đã học hết các buổi theo lịch")}
          </p>
        </StatCard>

        <StatCard
          icon={<IconAlert size={24} />}
          iconStyle="bg-[var(--sp-pink)]"
          shadow="shadow-[5px_5px_0_var(--sp-pink-line)] hover:shadow-[7px_7px_0_var(--sp-pink-line)]"
          label={tx("Cần ôn lại")}
        >
          <p className="text-[30px] font-extrabold leading-tight text-[var(--sp-pink-dark)]">
            {byChapter ? needWork.length : weakLessons.length}
            <span className="ml-1.5 text-base font-semibold text-[var(--sp-muted)]">{byChapter ? tx("chương") : tx("bài học")}</span>
          </p>
          <p className="mt-3 text-[13px] text-[var(--sp-muted)]">
            {tested.length === 0
              ? tx("Chưa có dữ liệu kiểm tra")
              : byChapter
                ? needWork.length > 0
                  ? tx("{0} dưới 80% · {1} bài học cần ôn", [needWork.map((item) => item.code).join(", "), weakLessons.length])
                  : tx("Các chương đã kiểm tra đều nắm vững")
                : tx("dưới 80% trong {0} bài đã kiểm tra", [testedLessons.length])}
          </p>
        </StatCard>
      </section>

      {/* Mức nắm vững + điểm yếu */}
      {/* Màn hình chưa đủ rộng thì khung điểm yếu xuống dưới để cột bài học không bị bóp hẹp */}
      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_380px] 2xl:items-start">
        <section className="sp-card p-5 sm:p-7">
          <div className="mb-5 grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div>
              <p className="sp-accent text-[17px] text-[var(--sp-pink)]">{tx("Tổng hợp điểm sau từng bài kiểm tra")}</p>
              <h2 className="text-[22px] text-[var(--sp-ink)]">{tx("Nắm vững đến đâu?")}</h2>
            </div>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <span className="sp-chip bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]">
                {groupCards.length} {byChapter && masteryView === "chapter" ? tx("chương") : tx("tuần")}
              </span>
              <span className="sp-chip bg-emerald-50 text-emerald-700">
                {tx("{0}/{1} bài đã kiểm tra", [testedLessons.length, lessons.length])}</span>
              <span className="sp-chip bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]">{tx("{0} bài dưới 80%", [weakLessons.length])}</span>
            </div>
          </div>

          {byChapter && (
            <div className="mb-4 flex w-fit rounded-xl bg-[var(--sp-surface-2)] p-1">
              {(
                [
                  ["chapter", tx("Theo chương")],
                  ["week", tx("Theo tuần")],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={masteryView === value}
                  onClick={() => setMasteryView(value)}
                  className={`rounded-lg px-4 py-1.5 text-sm font-bold transition ${
                    masteryView === value
                      ? "bg-white text-[var(--sp-peri-dark)] shadow-sm"
                      : "text-[var(--sp-muted)] hover:text-[var(--sp-ink)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {groupCards.length === 0 ? (
            <p className="rounded-2xl bg-[var(--sp-surface-2)] p-6 text-center text-sm text-[var(--sp-muted)]">

              {tx("Chưa có lịch học cho môn này.")}
            </p>
          ) : (
            <div className="space-y-3.5">
              {groupCards.map(({ key, ...card }) => (
                <GroupCard key={`${masteryView}-${key}`} {...card} defaultOpen={key === openKey} />
              ))}
            </div>
          )}

          <p className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-[var(--sp-muted)]">
            <span className="flex items-center gap-1.5">
              <span className="h-3 border-l-2 border-dashed border-[var(--sp-text-2)]" />

              {tx("Ngưỡng nắm vững")} {MASTERY_SCORE}%
            </span>
            <span>
              {byChapter && masteryView === "chapter" ? tx("Điểm chương") : tx("Điểm tuần")}  {tx("= trung bình điểm mới nhất của các bài đã kiểm tra")}
            </span>
          </p>
        </section>

        <section className="rounded-[22px] border-2 border-[var(--sp-purple)] bg-white p-5 shadow-[6px_6px_0_var(--sp-pink-line)] sm:p-6">
          <p className="sp-accent text-[17px] text-[var(--sp-pink)]">{tx("Phát hiện từ kết quả câu hỏi")}</p>
          <h2 className="text-[22px] text-[var(--sp-ink)]">{tx("Đang yếu")} {byChapter ? tx("chương nào") : tx("bài nào")}?</h2>
          <p className="mb-4 mt-1 text-[13px] text-[var(--sp-muted)]">
            {byChapter
              ? tx("Tài liệu có nhiều chương nên xếp hạng theo chương, kèm bài yếu nhất trong chương.")
              : tx("Xếp hạng theo từng bài học nhỏ, bài ôn đến hạn được ưu tiên trước.")}
          </p>

          {shownWeak.length === 0 ? (
            <div className="rounded-2xl border border-[var(--sp-line)] bg-[var(--sp-surface-2)] p-5 text-center">
              <Sparkle size={22} className="mx-auto mb-2 text-[var(--sp-yellow)]" />
              <p className="font-bold text-[var(--sp-ink)]">
                {tested.length > 0 ? tx("Chưa phát hiện phần yếu") : tx("Chưa có bài kiểm tra")}
              </p>
              <p className="mt-1 text-sm text-[var(--sp-muted)]">
                {tested.length > 0
                  ? tx("Các bài đã kiểm tra đều đạt từ 80% trở lên.")
                  : tx("Làm Quiz sau mỗi buổi học để AI chỉ ra phần bạn còn yếu.")}
              </p>
            </div>
          ) : (
            <div className={`grid gap-4 ${shownWeak.length > 1 ? (shownWeak.length > 2 ? "md:grid-cols-3" : "md:grid-cols-2") : ""} 2xl:grid-cols-1`}>
              {shownWeak.map((item, index) => (
                <WeakCard key={item.key} item={item} rank={index + 1} />
              ))}
            </div>
          )}

          {moreWeak > 0 && (
            <p className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 rounded-2xl border-2 border-dashed border-[var(--sp-lav-line)] bg-[var(--sp-lav)] px-3.5 py-3 text-[13.5px] text-[var(--sp-text-2)]">

              {tx("Còn")} {moreWeak}  {tx("bài học khác dưới 80%")}
              <Link href={`/quizzes?plan=${plan.id}`} className="flex items-center gap-1 font-extrabold text-[var(--sp-peri-dark)] hover:underline">

                {tx("Xem ở mục Ôn tập")}
                <IconArrowRight size={14} />
              </Link>
            </p>
          )}
          {byChapter && mastered.length > 0 && (
            <p className="mt-4 grid grid-cols-[18px_minmax(0,1fr)] items-center gap-2 rounded-2xl bg-emerald-50 px-3.5 py-3 text-[13.5px] text-emerald-800">
              <IconCheck size={16} />
              {mastered.map((item) => item.code).join(", ")}  {tx("đã nắm vững, chỉ cần ôn theo lịch")}
            </p>
          )}
        </section>
      </div>

      {/* Gợi ý tiếp theo + lộ trình */}
      <section className="grid grid-cols-[48px_minmax(0,1fr)] items-start gap-x-[18px] gap-y-4 rounded-[24px] bg-[var(--sp-purple)] px-5 py-5 text-white shadow-[6px_6px_0_var(--sp-lav-line)] sm:px-7 xl:grid-cols-[48px_minmax(0,1fr)_360px]">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--sp-pink)] text-white">
          <IconTarget size={24} />
        </span>
        <div className="min-w-0 self-center">
          <p className="sp-accent text-[17px] text-[#ffbcd3]">{tx("Tiếp theo nên ôn gì?")}</p>
          {reviewStep || learnStep ? (
            <div className="mt-2 grid gap-2">
              {reviewStep && <NextStep icon={<IconRepeat size={14} />} tone="bg-[var(--sp-pink)]" label={tx("1 · Ôn lại")} step={reviewStep} />}
              {learnStep && (
                <NextStep
                  icon={<IconBook size={14} />}
                  tone="bg-white/15"
                  label={reviewStep ? tx("2 · Học tiếp") : tx("1 · Học tiếp")}
                  step={learnStep}
                />
              )}
            </div>
          ) : (
            <p className="mt-1 text-[16.5px] font-semibold">

              {tx("Bạn đã hoàn thành lộ trình. Hãy ôn Flashcards để giữ kiến thức trước ngày thi.")}
            </p>
          )}
        </div>

        {/* Lộ trình: Đã học → Ôn lại → Học tiếp → Thi */}
        <div className="hidden xl:col-start-3 xl:row-start-1 xl:grid xl:grid-rows-[auto_1fr_auto] xl:gap-2.5 xl:rounded-[20px] xl:border-2 xl:border-white/15 xl:bg-white/[0.07] xl:px-4 xl:py-3.5" aria-hidden="true">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.8px] text-white/70">{tx("Lộ trình của bạn")}</span>
            {daysLeft !== null && (
              <span className="flex items-center gap-1 rounded-full border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-yellow)] px-2.5 text-[12px] font-extrabold text-[var(--sp-purple-deep)] shadow-[2px_2px_0_var(--sp-purple-deep)]">
                <IconClock size={13} />

                {tx("Còn")} {daysLeft}  {tx("ngày")}
              </span>
            )}
          </div>
          <div
            className="sp-route-rail relative grid grid-cols-4 items-center"
            style={{ "--sp-route-fill": reviewStep ? "25%" : "50%" } as React.CSSProperties}
          >
            <span className="sp-route-fill" />
            {[
              { icon: <IconCheck size={19} />, tone: "bg-emerald-500 text-white" },
              { icon: <IconRepeat size={19} />, tone: "bg-[var(--sp-pink)] text-white", now: Boolean(reviewStep) },
              { icon: <IconBook size={19} />, tone: "bg-[var(--sp-peri)] text-white", now: !reviewStep },
              { icon: <IconFlag size={19} />, tone: "bg-[var(--sp-yellow)] text-[var(--sp-purple-deep)]" },
            ].map((node, index) => (
              <span
                key={index}
                className={`sp-route-node relative flex h-10 w-10 items-center justify-center justify-self-center rounded-[13px] border-2 border-[var(--sp-purple-deep)] shadow-[3px_3px_0_var(--sp-purple-deep)] ${node.tone} ${node.now ? "sp-route-now" : ""}`}
                style={{ animationDelay: `${0.1 + index * 0.15}s` }}
              >
                {node.icon}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-4 text-center">
            {[
              [tx("Đã học"), tx("{0}/{1} buổi", [analysis.completedSessions, analysis.totalSessions])],
              [tx("Ôn lại"), shortStep(reviewStep?.label)],
              [tx("Học tiếp"), shortStep(learnStep?.label)],
              ["Thi", examKey ? formatDayMonth(examKey) : "—"],
            ].map(([caption, value]) => (
              <div key={caption}>
                <p className="text-[10.5px] font-bold uppercase tracking-wide text-white/65">{caption}</p>
                <p className="text-[13px] font-extrabold">{value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="col-span-2 grid grid-cols-1 gap-3 border-t border-white/15 pt-4 sm:grid-cols-3 xl:col-start-2">
          <Link
            href={`/materials?subject=${encodeURIComponent(subject.id)}`}
            className="sp-btn h-[42px] whitespace-nowrap border-2 border-white/25 px-3 text-[13.5px] text-white hover:bg-white/10"
          >
            <IconFile size={16} />

            {tx("Xem lại nội dung")}
          </Link>
          <Link
            href={`/study-plans/${plan.id}`}
            className="sp-btn h-[42px] whitespace-nowrap border-2 border-white/25 px-3 text-[13.5px] text-white hover:bg-white/10"
          >
            <IconCalendar size={16} />

            {tx("Về kế hoạch ôn tập")}
          </Link>
          <Link
            href={continueHref}
            className="sp-btn h-[42px] whitespace-nowrap border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-yellow)] px-3 text-[13.5px] text-[var(--sp-purple-deep)] shadow-[3px_3px_0_var(--sp-purple-deep)] hover:-translate-x-px hover:-translate-y-px hover:shadow-[4px_4px_0_var(--sp-purple-deep)]"
          >
            <IconPlay size={16} />
            {continueLabel}
          </Link>
        </div>
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
        <span className="min-w-0 flex-1 truncate">{current?.name || tx("Chọn môn học")}</span>
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
                      {tx("Tạo ngày {0}", [formatDate(subject.created_at)])}
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
  shadow,
  label,
  children,
}: {
  icon: React.ReactNode;
  iconStyle: string;
  shadow: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`grid grid-cols-[56px_minmax(0,1fr)] items-start gap-4 rounded-[20px] border-2 border-[var(--sp-purple-deep)] bg-white px-[22px] py-5 transition duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 ${shadow}`}
    >
      <span
        className={`flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-[var(--sp-purple-deep)] text-white shadow-[3px_3px_0_var(--sp-purple-deep)] ${iconStyle}`}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-bold text-[var(--sp-text-2)]">{label}</p>
        {children}
      </div>
    </div>
  );
}

/* Thanh điểm có vạch ngưỡng nắm vững 80% */
function ScoreBar({ percent, small }: { percent: number | null; small?: boolean }) {
  const level = getLevel(percent);
  return (
    <div
      className={`relative rounded-full ${
        small ? "mt-2 h-2 border border-[var(--sp-line)] bg-white" : "mt-2.5 h-2.5 bg-[var(--sp-surface-2)]"
      }`}
    >
      {percent === null ? (
        <div className="h-full rounded-full bg-[repeating-linear-gradient(135deg,#ece6ef_0_6px,#f7f5fa_6px_12px)]" />
      ) : (
        <div
          className={`h-full rounded-full transition-all duration-700 ${level.bar}`}
          style={{ width: `${Math.max(3, percent)}%` }}
        />
      )}
      <span
        className="absolute -top-1 h-[calc(100%+8px)] border-l-2 border-dashed border-[var(--sp-text-2)]/50"
        style={{ left: `${MASTERY_SCORE}%` }}
        aria-hidden="true"
      />
    </div>
  );
}

/*
 * Thẻ một tuần hoặc một chương. Dòng đầu và các dòng bài học dùng chung cột
 * (điểm 58px · nhãn 112px · nút 118px); dòng bài học bắt đầu thẳng tiêu đề.
 */
function GroupCard({
  kind,
  number,
  title,
  sub,
  lessons,
  tint,
  defaultOpen,
}: {
  kind: string;
  number: string;
  title: string;
  sub: string;
  lessons: LessonScore[];
  tint: "peri" | "pink";
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const score = average(lessons.filter((lesson) => lesson.current !== null).map((lesson) => lesson.current as number));
  const level = getLevel(score);
  const stripe = tint === "peri" ? "bg-[var(--sp-peri)]" : "bg-[var(--sp-pink)]";
  const badge =
    tint === "peri"
      ? "bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]"
      : "bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]";

  return (
    <article
      className={`relative overflow-hidden rounded-[20px] border-2 bg-white transition duration-150 ${
        open
          ? "border-[var(--sp-purple-deep)] shadow-[5px_5px_0_var(--sp-lav-line)]"
          : "border-[var(--sp-line)] hover:border-[var(--sp-lav-line)] hover:shadow-[4px_4px_0_var(--sp-lav-line)]"
      }`}
    >
      <span className={`absolute inset-y-0 left-0 w-1.5 ${stripe}`} aria-hidden="true" />
      <div className="grid grid-cols-[56px_minmax(0,1fr)_58px] items-center gap-x-3.5 gap-y-3 py-4 pl-[26px] pr-[18px] sm:grid-cols-[56px_minmax(0,1fr)_58px_112px_118px]">
        <div className={`flex h-14 w-14 flex-col items-center justify-center rounded-2xl ${badge}`}>
          <span className="text-[10px] font-extrabold uppercase tracking-wide">{kind}</span>
          <span className="text-[22px] font-extrabold leading-none">{number}</span>
        </div>
        <div className="min-w-0">
          <p className="font-extrabold leading-snug text-[var(--sp-ink)]">{title}</p>
          <p className="text-[13px] text-[var(--sp-muted)]">{sub}</p>
          <ScoreBar percent={score} />
        </div>
        <p className={`text-right text-[22px] font-extrabold leading-none ${score === null ? "text-[var(--sp-soft)]" : level.text}`}>
          {score === null ? "–" : `${score}%`}
        </p>
        <span className={`sp-chip hidden w-full justify-center px-1.5 text-[12px] sm:inline-flex ${level.chip}`}>{level.label}</span>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="sp-btn sp-btn-secondary col-span-3 h-10 w-full text-[13.5px] !text-[var(--sp-peri-dark)] sm:col-span-1"
        >
          {open ? tx("Thu gọn") : tx("Xem chi tiết")}
          <IconChevronDown size={16} className={`transition ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {open && (
        <ul className="sp-task-expand divide-y divide-[var(--sp-line)] border-t-2 border-dashed border-[var(--sp-line)] bg-[#fbfafd]">
          {lessons.map((lesson) => {
            const lessonLevel = getLevel(lesson.current);
            return (
              <li
                key={lesson.session.id}
                className="grid grid-cols-[minmax(0,1fr)_58px] items-center gap-x-3.5 py-3 pl-[26px] pr-[18px] sm:grid-cols-[minmax(0,1fr)_58px_112px_118px] sm:pl-[96px]"
              >
                <div className="min-w-0">
                  <p className="text-[11.5px] font-extrabold uppercase tracking-wide text-[var(--sp-purple)]">
                    {tx("Ngày học {0} · {1}", [lesson.dayNumber, formatDayMonth(lesson.dateKey)])}
                  </p>
                  <p className="mt-0.5 text-[14.5px] font-semibold leading-snug text-[var(--sp-ink)]">
                    {lesson.topic ? getMainTopicTitle(lesson.topic.name) : tx("Bài học")}
                  </p>
                  {(lesson.main || lesson.retake) && (
                    <p className="mt-1.5 flex flex-wrap gap-1.5 text-[12px]">
                      {lesson.main && (
                        <span className="whitespace-nowrap rounded-full border border-[var(--sp-line)] bg-white px-2 py-0.5 font-semibold text-[var(--sp-text-2)]">
                          {tx("Lần đầu {0}%", [lesson.main.percent])}</span>
                      )}
                      {lesson.retake && (
                        <span className="whitespace-nowrap rounded-full border border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)] px-2 py-0.5 font-semibold text-[var(--sp-pink-dark)]">
                          {tx("Kiểm tra lại {0}%", [lesson.retake.percent])}</span>
                      )}
                    </p>
                  )}
                  <ScoreBar percent={lesson.current} small />
                </div>
                <p className={`text-right text-lg font-extrabold ${lesson.current === null ? "text-[var(--sp-soft)]" : lessonLevel.text}`}>
                  {lesson.current === null ? "–" : `${lesson.current}%`}
                </p>
                <span className={`sp-chip hidden w-full justify-center px-1.5 text-[12px] sm:inline-flex ${lessonLevel.chip}`}>
                  {lessonLevel.label}
                </span>
                {lesson.latest ? (
                  <Link
                    href={`/quiz-results/${lesson.latest.attempt.attempt_id}`}
                    className="sp-btn sp-btn-secondary hidden h-[34px] w-full text-[13px] !text-[var(--sp-peri-dark)] sm:inline-flex"
                  >

                    {tx("Xem bài")}
                    <IconArrowRight size={14} />
                  </Link>
                ) : (
                  <span className="sp-btn hidden h-[34px] w-full cursor-default border-2 border-dashed border-[var(--sp-lav-line)] bg-[var(--sp-surface-2)] text-[13px] text-[var(--sp-soft)] sm:inline-flex">

                    {tx("Chưa làm")}
                  </span>
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

/* Thẻ ưu tiên trong khung "Đang yếu phần nào?" (theo bài học hoặc theo chương) */
function WeakCard({ item, rank }: { item: WeakItem; rank: number }) {
  const isFirst = rank === 1;
  const level = getLevel(item.score);
  const reviewTone = {
    red: "text-[var(--sp-red-dark)]",
    amber: "text-[var(--sp-amber-dark)]",
    pink: "text-[var(--sp-pink-dark)]",
    muted: "text-[var(--sp-muted)]",
  };

  return (
    <article
      className={`flex flex-col rounded-[18px] border-2 border-[var(--sp-purple-deep)] p-4 transition duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 ${
        isFirst
          ? "bg-[var(--sp-pink-bg)] shadow-[4px_4px_0_var(--sp-pink)] hover:shadow-[6px_6px_0_var(--sp-pink)]"
          : "bg-white shadow-[4px_4px_0_var(--sp-pink-line)] hover:shadow-[6px_6px_0_var(--sp-pink-line)]"
      }`}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5">
        <span
          className={`sp-chip w-fit ${
            isFirst ? "bg-white text-[var(--sp-pink-dark)]" : "bg-[var(--sp-amber-bg)] text-[var(--sp-amber-dark)]"
          }`}
        >
          {tx("Ưu tiên {0}", [rank])}
        </span>
        <p className={`text-[28px] font-extrabold leading-none ${level.text}`}>{item.score}%</p>
      </div>
      <p className="mt-2.5 text-[12px] font-extrabold uppercase tracking-wide text-[var(--sp-purple)]">{item.kicker}</p>
      <h3 className="mt-0.5 text-[16px] leading-snug text-[var(--sp-ink)]">{item.title}</h3>

      <ul className="mt-2.5 space-y-2 text-[13.5px] leading-snug text-[var(--sp-text-2)]">
        {item.lines.map((line) => (
          <li key={line.label} className="grid grid-cols-[18px_minmax(0,1fr)] gap-2">
            <IconTarget size={16} className="mt-0.5 text-[var(--sp-pink)]" />
            <span>
              {line.label}: <strong className="text-[var(--sp-ink)]">{line.value}</strong>
            </span>
          </li>
        ))}
        {item.review && (
          <li className={`grid grid-cols-[18px_minmax(0,1fr)] gap-2 font-bold ${reviewTone[item.review.tone]}`}>
            {item.review.tone === "red" ? (
              <IconClock size={16} className="mt-0.5" />
            ) : item.review.tone === "muted" ? (
              <IconRepeat size={16} className="mt-0.5" />
            ) : (
              <IconCalendar size={16} className="mt-0.5" />
            )}
            <span>{item.review.text}</span>
          </li>
        )}
      </ul>

      {(item.review || item.resultsHref) && (
        <div className="mt-auto grid grid-cols-2 gap-2.5 pt-3.5">
          {item.review && (
            <Link href={item.review.primary.href} className="sp-btn sp-btn-primary h-10 !bg-[var(--sp-pink)] text-[13px]">
              <IconPlay size={14} />
              {item.review.primary.label}
            </Link>
          )}
          {item.resultsHref && (
            <Link
              href={item.resultsHref}
              className={`sp-btn sp-btn-secondary h-10 text-[13px] !text-[var(--sp-peri-dark)] ${item.review ? "" : "col-span-2"}`}
            >
              <IconCheck size={14} />

              {tx("Xem câu sai")}
            </Link>
          )}
        </div>
      )}
    </article>
  );
}

/* Một dòng trong "Tiếp theo nên ôn gì?": nhãn cố định 118px để chữ hai dòng thẳng nhau */
function NextStep({
  icon,
  tone,
  label,
  step,
}: {
  icon: React.ReactNode;
  tone: string;
  label: string;
  step: { label: string; text: string };
}) {
  return (
    <div className="grid grid-cols-1 items-center gap-1 sm:grid-cols-[118px_minmax(0,1fr)] sm:gap-3.5">
      <span className={`flex h-[30px] w-fit items-center justify-center gap-1.5 rounded-full px-3 text-[12.5px] font-extrabold text-white sm:w-full ${tone}`}>
        {icon}
        {label}
      </span>
      <p className="text-[16.5px] font-semibold leading-snug">
        <b className="font-extrabold text-[#ffd76e]">{step.label}</b> · {step.text}
      </p>
    </div>
  );
}

type ReviewInfo = {
  text: string;
  tone: "red" | "amber" | "pink" | "muted";
  /* thứ tự ưu tiên: đến hạn/quá hạn → chưa chọn ngày → đã hẹn → chưa có bài ôn */
  rank: number;
  primary: { label: string; href: string };
};

type WeakItem = {
  key: string;
  kicker: string;
  title: string;
  score: number;
  lines: { label: string; value: string }[];
  review: ReviewInfo | null;
  resultsHref: string | null;
  stepLabel: string;
  stepText: string;
};

/* useSearchParams cần nằm trong Suspense để "next build" không báo lỗi */
export default function WeakAreasPage() {
  return (
    <Suspense fallback={null}>
      <WeakAreasPageContent />
    </Suspense>
  );
}

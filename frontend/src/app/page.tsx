"use client";

import { useCallback, useEffect, useMemo, useState, type ComponentType, type SVGProps } from "react";
import Link from "next/link";
import { HomePilot, usePilotRest, type PilotPerch } from "@/components/home-pilot";
import { LoadingMascot } from "@/components/loading-play";
import { getMainTopicTitle } from "@/lib/content-titles";
import { CURRENT_USER } from "@/lib/current-user";
import {
  IconAlert,
  IconArrowRight,
  IconBook,
  IconCalendar,
  IconChart,
  IconCheck,
  IconClock,
  IconFile,
  IconPen,
  IconPlay,
  IconPlus,
  IconRepeat,
} from "@/components/icons";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
const MASTERY_SCORE = 80;

/* ================= Kiểu dữ liệu ================= */

type Subject = { id: string; name?: string };

type ExamPlan = {
  id: string;
  title?: string;
  subject_id?: string;
  exam_date?: string;
  total_sessions?: number;
  completed_sessions?: number;
};

type Topic = { id: string; name?: string; hierarchy?: string | null; exam_plan_id?: string };

type StudySession = {
  id: string;
  topic_id?: string;
  scheduled_start?: string;
  status?: string;
  duration_minutes?: number;
};

type Quiz = {
  id: string;
  exam_plan_id?: string | null;
  study_session_id?: string | null;
  topic_name?: string | null;
  is_retake?: boolean;
  review_status?: string | null;
  review_date?: string | null;
  is_unlocked?: boolean;
  time_limit_minutes?: number | null;
};

type QuizAttempt = {
  attempt_id?: string;
  quiz_id: string;
  score: number;
  correct_count: number;
  total_questions: number;
  submitted_at?: string;
};

type Dashboard = {
  subjects: Subject[];
  plans: ExamPlan[];
  topics: Topic[];
  sessions: StudySession[];
  quizzes: Quiz[];
  attempts: QuizAttempt[];
};

const EMPTY: Dashboard = { subjects: [], plans: [], topics: [], sessions: [], quizzes: [], attempts: [] };

/* ================= Tiện ích ================= */

const vnDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
const toKey = (value: string | Date) => vnDate.format(new Date(value));

function addDays(key: string, days: number) {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(fromKey: string, toKeyValue: string) {
  return Math.round((Date.parse(`${toKeyValue}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000);
}

function formatDay(key: string) {
  const [year, month, day] = key.split("-");
  return `${day}/${month}/${year}`;
}

const dayMonth = (key: string) => formatDay(key).slice(0, 5);
const WEEKDAY = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

/* "ngày mai 21/11", "CN 22/11" (trong 6 ngày tới) hoặc "ngày 05/12" */
function dayPhrase(key: string, todayKey: string) {
  const diff = daysBetween(todayKey, key);
  if (diff === 0) return "hôm nay";
  if (diff === 1) return `ngày mai ${dayMonth(key)}`;
  if (diff > 1 && diff < 7) return `${WEEKDAY[new Date(`${key}T00:00:00Z`).getUTCDay()]} ${dayMonth(key)}`;
  return `ngày ${dayMonth(key)}`;
}

/* Cùng quy ước với trang Đánh giá năng lực */
const CHAPTER_PREFIX = /^(?:chương|chapter|unit|phần|part|bài|lesson)\s*([0-9ivxlc]+)\s*[:.\-–—]?\s*/i;
const chapterKeyOf = (topic: Topic | undefined) => String(topic?.hierarchy || "").split(">")[0].trim() || topic?.id || "other";

async function fetchList<T>(path: string): Promise<T[]> {
  const response = await fetch(`${API_BASE_URL}${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`API ${path} trả về lỗi ${response.status}`);
  const result = await response.json();
  return Array.isArray(result?.data) ? result.data : [];
}

async function loadDashboard(): Promise<{ data: Dashboard; error: string }> {
  const results = await Promise.allSettled([
    fetchList<Subject>("/api/subjects"),
    fetchList<ExamPlan>("/api/exam-plans"),
    fetchList<Topic>("/api/topics"),
    fetchList<StudySession>("/api/study-sessions"),
    fetchList<Quiz>("/api/quizzes"),
    fetchList<QuizAttempt>("/api/quiz-attempts"),
  ]);
  const pick = <T,>(index: number) =>
    results[index].status === "fulfilled" ? (results[index] as PromiseFulfilledResult<T[]>).value : [];
  const failed = results.filter((result) => result.status === "rejected").length;
  return {
    error:
      failed === results.length
        ? "Không kết nối được backend. Hãy kiểm tra backend có đang chạy không."
        : failed > 0
          ? "Một vài dữ liệu chưa tải được, số liệu có thể chưa đầy đủ."
          : "",
    data: {
      subjects: pick<Subject>(0),
      plans: pick<ExamPlan>(1),
      topics: pick<Topic>(2),
      sessions: pick<StudySession>(3),
      quizzes: pick<Quiz>(4),
      attempts: pick<QuizAttempt>(5),
    },
  };
}

const QUICK_LINKS: {
  title: string;
  text: string;
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
  tone: string;
}[] = [
  { title: "Kế hoạch ôn thi", text: "Lịch học và lịch ôn", href: "/study-plans", icon: IconCalendar, tone: "bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]" },
  { title: "Tài liệu học tập", text: "Tóm tắt từng bài học", href: "/study-materials", icon: IconFile, tone: "bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]" },
  { title: "Kiểm tra kiến thức", text: "Có giải thích câu sai", href: "/quizzes", icon: IconPen, tone: "bg-[var(--sp-amber-bg)] text-[var(--sp-amber-dark)]" },
  { title: "Đánh giá năng lực", text: "Tiến độ và điểm yếu", href: "/weak-areas", icon: IconChart, tone: "bg-[#f1e6f7] text-[var(--sp-purple)]" },
];

/* ================= Trang ================= */

export default function Home() {
  const [data, setData] = useState<Dashboard>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pilotRest, setPilotRest] = usePilotRest();

  const apply = useCallback((result: { data: Dashboard; error: string }) => {
    setData(result.data);
    setError(result.error);
    setLoading(false);
  }, []);

  const refreshDashboard = useCallback(() => loadDashboard().then(apply), [apply]);

  useEffect(() => {
    let active = true;
    const load = () =>
      loadDashboard().then((result) => {
        if (active) apply(result);
      });
    void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [apply]);

  const todayKey = toKey(new Date());
  const view = useMemo(() => buildView(data, todayKey), [data, todayKey]);
  const todayLabel = (() => {
    const label = new Date(`${todayKey}T00:00:00`).toLocaleDateString("vi-VN", {
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    return label.charAt(0).toUpperCase() + label.slice(1);
  })();

  const open = view.today.filter((item) => !item.done);
  const openMinutes = open.reduce((sum, item) => sum + (item.minutes || 0), 0);
  const minutesText =
    openMinutes >= 60 ? `${Math.round((openMinutes / 60) * 10) / 10} giờ`.replace(".", ",") : `${openMinutes} phút`;
  const allDone = view.today.length > 0 && open.length === 0;

  const countOf = (kind: TodayItem["kind"]) => open.filter((item) => item.kind === kind).length;
  const todayParts = [
    countOf("lesson") && `${countOf("lesson")} buổi học mới`,
    countOf("retake") && `${countOf("retake")} bài kiểm tra lại`,
    countOf("review") && `${countOf("review")} bài cần ôn`,
    countOf("pick") && `${countOf("pick")} bài chưa chọn ngày ôn`,
  ].filter(Boolean) as string[];

  const percent = view.totalSessions ? Math.round((view.completedSessions / view.totalSessions) * 100) : 0;
  const pilotLines: Record<PilotPerch, string[]> = {
    sign: open.length
      ? [`Hôm nay còn ${open.length} việc nè!`, "Làm bài hôm nay trước rồi chơi nha~"]
      : allDone
        ? ["Xong hết rồi! Nghỉ ngơi thôi~"]
        : ["Hôm nay nhẹ nhàng ghê~"],
    hero:
      view.daysLeft !== null
        ? [`Còn ${view.daysLeft} ngày nữa là thi, mình đi cùng bạn!`, `${percent}% rồi đó, cố lên!`]
        : ["Tạo kế hoạch để mình xếp lịch cho bạn nha!"],
    today: open[0]
      ? [`Làm “${open[0].name}” trước nha ↓`, open[0].minutes ? `Chỉ ${open[0].minutes} phút thôi, mình canh giờ cho!` : "Việc này trước nha ↓"]
      : ["Hôm nay xong hết rồi nè!"],
    read: view.upcoming
      ? [`Mình đọc trước bài ${view.upcoming.phrase} cho bạn…`, "Suỵt, Pilot đang học bài…"]
      : ["Suỵt, Pilot đang học bài…"],
  };

  return (
    <div className="relative mx-auto max-w-7xl space-y-6">
      {/* Lời chào: chỗ đậu đầu tiên của Pilot nằm ngay sau tên */}
      <section className="grid grid-cols-[minmax(0,1fr)_100px] items-center gap-x-3 lg:grid-cols-[auto_130px_minmax(0,1fr)_auto]">
        <p className="sp-accent col-span-full text-[18px] text-[var(--sp-pink)]">{todayLabel}</p>
        <h1 className="mt-1 text-[36px] leading-[1.08] sm:text-[52px]">
          Chào mừng trở lại, <span className="sp-squiggle">{CURRENT_USER.name}</span>
        </h1>
        <div className="h-[120px]" data-pilot-perch="sign" />
        <span className="hidden lg:block" />
        <div className="col-span-full mt-3 flex flex-wrap gap-3 lg:col-span-1 lg:mt-0">
          <button
            type="button"
            onClick={() => setPilotRest(!pilotRest)}
            className="sp-btn sp-btn-secondary h-11 px-4 text-[14px] !text-[var(--sp-peri-dark)]"
          >
            {pilotRest ? "Gọi Pilot về" : "Cho Pilot nghỉ"}
          </button>
          <Link href="/study-plans#create-plan" className="sp-btn sp-btn-primary h-11 whitespace-nowrap px-5 text-[15px]">
            <IconPlus size={17} />
            Tạo kế hoạch mới
          </Link>
        </div>
        <p className="col-span-full mt-2 text-[15px] text-[var(--sp-text-2)]">
          {loading ? (
            "Đang tải lịch học của bạn..."
          ) : !view.plan ? (
            "Tạo kế hoạch ôn thi đầu tiên để AI xếp lịch học cho bạn."
          ) : todayParts.length > 0 ? (
            <>
              Hôm nay có <b className="text-[var(--sp-pink-dark)]">{todayParts.join(", ")}</b>
              {openMinutes > 0 && `, khoảng ${minutesText}`}. Làm xong là Pilot cho bạn nghỉ!
            </>
          ) : allDone ? (
            <>
              Bạn đã <b className="text-[var(--sp-pink-dark)]">xong hết việc hôm nay</b>. Tối nay nghỉ ngơi, mai mình ôn tiếp nhé!
            </>
          ) : (
            "Hôm nay không có lịch học hay lịch ôn. Nghỉ ngơi hoặc xem lại bài cũ nhé."
          )}
        </p>
      </section>

      {error && (
        <p role="alert" className="rounded-2xl border-2 border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)] px-4 py-3 text-sm font-medium text-[var(--sp-pink-dark)]">
          {error}{" "}
          <button type="button" onClick={() => void refreshDashboard()} className="font-bold underline underline-offset-2">
            Thử lại
          </button>
        </p>
      )}

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* ---------- Cột trái ---------- */}
        <div className="min-w-0 space-y-6">
          <PlanHero view={view} percent={percent} loading={loading} />
          <TodayCard view={view} todayKey={todayKey} loading={loading} allDone={allDone} minutesText={minutesText} openCount={open.length} />
        </div>

        {/* ---------- Cột phải ---------- */}
        <div className="min-w-0 space-y-6">
          <WeakCard view={view} loading={loading} />

          <section>
            <p className="sp-accent text-[17px] text-[var(--sp-pink)]">Đi nhanh tới</p>
            <h2 className="text-[22px] text-[var(--sp-ink)]">Truy cập nhanh</h2>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {QUICK_LINKS.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="group flex flex-col rounded-[22px] border-2 border-[var(--sp-line)] bg-white p-4 transition hover:-translate-y-0.5 hover:border-[var(--sp-purple)] hover:shadow-[4px_4px_0_var(--sp-lav-line)]"
                  >
                    <span className={`flex h-11 w-11 items-center justify-center rounded-xl border-2 border-[var(--sp-purple-deep)] ${item.tone}`}>
                      <Icon size={20} />
                    </span>
                    <span className="mt-3 text-[15px] font-bold leading-snug text-[var(--sp-ink)]">{item.title}</span>
                    <span className="mt-1 text-[13px] leading-5 text-[var(--sp-muted)]">{item.text}</span>
                    <span className="mt-3 flex items-center gap-1 text-[13px] font-bold text-[var(--sp-peri-dark)]">
                      Mở
                      <IconArrowRight size={14} className="transition group-hover:translate-x-1" />
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>

          <PilotNook />
        </div>
      </div>

      <HomePilot
        hidden={pilotRest}
        sign={loading ? "…" : open.length ? `${open.length} việc` : allDone ? "Xong!" : "Nghỉ!"}
        lines={pilotLines}
        alert={view.overdue ? `Bài “${view.overdue.name}” quá hạn từ ${dayMonth(view.overdue.dateKey)} rồi… ôn liền nha!` : null}
        celebrate={allDone}
      />
    </div>
  );
}

/* ================= Gom dữ liệu ================= */

type Review = {
  dateKey: string | null;
  /* đến hạn/quá hạn → chưa chọn ngày → đã hẹn → chưa có bài ôn */
  rank: number;
  tone: "red" | "pink" | "amber" | "muted";
  text: string;
  label: string;
  href: string;
  retake: Quiz | null;
};

type Lesson = {
  sessionId: string;
  session: StudySession | undefined;
  name: string;
  title: string;
  chapterKey: string;
  percent: number;
  review: Review;
};

type TodayItem = {
  key: string;
  kind: "lesson" | "retake" | "review" | "pick";
  name: string;
  title: string;
  chip: string;
  note: string;
  minutes: number;
  done: boolean;
  urgent: boolean;
  href: string;
  action: string;
};

type WeakItem = {
  key: string;
  kicker: string;
  title: string;
  percent: number;
  text: string;
  tone: Review["tone"];
  label: string;
  href: string;
};

type WeekDay = { key: string; label: string; learn: number; learnDone: number; reviews: number };

function buildView(data: Dashboard, todayKey: string) {
  const topicById = new Map(data.topics.map((topic) => [topic.id, topic]));
  const subjectName = (plan?: ExamPlan) =>
    data.subjects.find((subject) => subject.id === plan?.subject_id)?.name || plan?.title || "Kế hoạch ôn thi";

  // Kế hoạch đang chạy: ngày thi gần nhất chưa qua
  const upcomingPlans = data.plans
    .filter((plan) => !plan.exam_date || plan.exam_date.slice(0, 10) >= todayKey)
    .sort((a, b) => String(a.exam_date || "9999").localeCompare(String(b.exam_date || "9999")));
  const plan = upcomingPlans[0] || data.plans[0];
  const planTopicIds = new Set(data.topics.filter((topic) => topic.exam_plan_id === plan?.id).map((topic) => topic.id));
  const planSessions = data.sessions
    .filter((session) => planTopicIds.has(String(session.topic_id)))
    .sort((a, b) => String(a.scheduled_start || "").localeCompare(String(b.scheduled_start || "")));
  const completedSessions = planSessions.filter((session) => session.status === "completed").length;
  const examKey = plan?.exam_date?.slice(0, 10) || null;

  const materialsHref = (sessionId?: string | null, mode?: "review" | "revisit") =>
    plan?.subject_id
      ? `/study-materials?subject=${encodeURIComponent(plan.subject_id)}${sessionId ? `&session=${encodeURIComponent(sessionId)}` : ""}${mode ? `&mode=${mode}` : ""}`
      : "/study-materials";

  // Chương theo thứ tự trong giáo trình; từ 2 chương trở lên mới ghi "Chương N ·"
  const chapters: { key: string; no: string; title: string }[] = [];
  for (const session of planSessions) {
    const topic = topicById.get(String(session.topic_id));
    const key = chapterKeyOf(topic);
    if (chapters.some((chapter) => chapter.key === key)) continue;
    const full = String(topic?.hierarchy || "").split(">")[0].trim() || (topic ? getMainTopicTitle(topic.name) : "Nội dung khác");
    const match = full.match(CHAPTER_PREFIX);
    chapters.push({
      key,
      no: match ? match[1].toUpperCase() : String(chapters.length + 1),
      title: full.replace(CHAPTER_PREFIX, "").trim() || full,
    });
  }
  const byChapter = chapters.length >= 2;
  const chapterOf = (key: string) => chapters.find((chapter) => chapter.key === key);
  const nameOf = (session?: StudySession) => getMainTopicTitle(topicById.get(String(session?.topic_id))?.name || "Bài học");
  const titleOf = (session?: StudySession) => {
    const chapter = chapterOf(chapterKeyOf(topicById.get(String(session?.topic_id))));
    return `${byChapter && chapter ? `Chương ${chapter.no} · ` : ""}${nameOf(session)}`;
  };

  // Điểm mới nhất của từng buổi học (bài gốc hoặc kiểm tra lại)
  const quizById = new Map(data.quizzes.map((quiz) => [quiz.id, quiz]));
  const latestBySession = new Map<string, { percent: number; at: string; attemptId?: string }>();
  for (const attempt of data.attempts) {
    const sessionId = quizById.get(attempt.quiz_id)?.study_session_id;
    if (!sessionId) continue;
    const percent = attempt.total_questions
      ? Math.round((attempt.correct_count / attempt.total_questions) * 100)
      : Math.round(Number(attempt.score || 0));
    const at = attempt.submitted_at || "";
    const current = latestBySession.get(sessionId);
    if (!current || at > current.at) latestBySession.set(sessionId, { percent, at, attemptId: attempt.attempt_id });
  }

  // Trạng thái bài ôn: cùng quy tắc với trang Đánh giá năng lực
  const reviewFor = (sessionId: string): Review => {
    const retake =
      [...data.quizzes]
        .reverse()
        .find((quiz) => quiz.is_retake && quiz.study_session_id === sessionId && quiz.review_status !== "completed") || null;
    if (!retake) {
      return { dateKey: null, rank: 3, tone: "muted", text: "Chưa có bài ôn cho bài này", label: "Xem lại bài", href: materialsHref(sessionId, "revisit"), retake };
    }
    if (!retake.review_date) {
      const attemptId = latestBySession.get(sessionId)?.attemptId;
      return {
        dateKey: null,
        rank: 1,
        tone: "pink",
        text: "Chưa chọn ngày ôn",
        label: "Chọn ngày ôn",
        href: attemptId ? `/quiz-results/${attemptId}` : materialsHref(sessionId, "review"),
        retake,
      };
    }
    const dateKey = retake.review_date.slice(0, 10);
    const go = retake.is_unlocked
      ? { label: "Làm bài ôn", href: `/quizzes/${retake.id}` }
      : { label: "Vào ôn", href: materialsHref(sessionId, "review") };
    if (dateKey > todayKey) return { dateKey, rank: 2, tone: "amber", text: `Ôn ${dayPhrase(dateKey, todayKey)}`, ...go, retake };
    return {
      dateKey,
      rank: 0,
      tone: "red",
      text: dateKey === todayKey ? "Ôn hôm nay" : `Quá hạn từ ${dayMonth(dateKey)}`,
      ...go,
      retake,
    };
  };

  const sessionById = new Map(planSessions.map((session) => [session.id, session]));
  const tested: Lesson[] = [];
  for (const [sessionId, latest] of latestBySession) {
    const session = sessionById.get(sessionId);
    if (!session) continue;
    tested.push({
      sessionId,
      session,
      name: nameOf(session),
      title: titleOf(session),
      chapterKey: chapterKeyOf(topicById.get(String(session.topic_id))),
      percent: latest.percent,
      review: reviewFor(sessionId),
    });
  }
  const weakLessons = tested
    .filter((lesson) => lesson.percent < MASTERY_SCORE)
    .sort((a, b) => a.review.rank - b.review.rank || a.percent - b.percent);

  // Cần ôn lại thêm: theo bài học (1 chương) hoặc theo chương
  let weak: WeakItem[];
  let weakCount: string;
  if (byChapter) {
    const groups = chapters
      .map((chapter) => {
        const lessons = tested.filter((lesson) => lesson.chapterKey === chapter.key);
        const weakOnes = lessons.filter((lesson) => lesson.percent < MASTERY_SCORE).sort((a, b) => a.percent - b.percent);
        const total = planSessions.filter((session) => chapterKeyOf(topicById.get(String(session.topic_id))) === chapter.key).length;
        const average = lessons.length ? Math.round(lessons.reduce((sum, lesson) => sum + lesson.percent, 0) / lessons.length) : null;
        return { chapter, weakOnes, total, average };
      })
      .filter((group) => group.average !== null && group.average < MASTERY_SCORE && group.weakOnes.length > 0)
      .sort((a, b) => (a.average as number) - (b.average as number));
    weakCount = `${groups.length} chương`;
    weak = groups.slice(0, 2).map(({ chapter, weakOnes, total, average }, index) => {
      const weakest = weakOnes[0];
      return {
        key: chapter.key,
        kicker: `Chương ${chapter.no} · Ưu tiên ${index + 1}`,
        title: chapter.title,
        percent: average as number,
        text: `${weakOnes.length}/${total} bài dưới ${MASTERY_SCORE}% · yếu nhất: ${weakest.name} (${weakest.percent}%)`,
        tone: weakest.review.tone,
        label: weakest.review.label,
        href: weakest.review.href,
      };
    });
  } else {
    weakCount = `${weakLessons.length} bài`;
    weak = weakLessons.slice(0, 3).map((lesson, index) => ({
      key: lesson.sessionId,
      kicker: `Ưu tiên ${index + 1}`,
      title: lesson.title,
      percent: lesson.percent,
      text: lesson.review.retake?.is_unlocked && lesson.review.rank === 0 ? `${lesson.review.text} · bài kiểm tra lại đã mở` : lesson.review.text,
      tone: lesson.review.tone,
      label: lesson.review.label,
      href: lesson.review.href,
    }));
  }

  // Hôm nay: bài ôn đến hạn/quá hạn, bài chưa chọn ngày ôn, buổi học xếp hôm nay
  const today: TodayItem[] = [];
  for (const lesson of weakLessons) {
    const { review } = lesson;
    if (review.rank === 0) {
      const isRetake = Boolean(review.retake?.is_unlocked);
      const when = review.dateKey === todayKey ? "hẹn hôm nay" : `quá hạn từ ${dayMonth(review.dateKey as string)}`;
      today.push({
        key: `review-${lesson.sessionId}`,
        kind: isRetake ? "retake" : "review",
        name: lesson.name,
        title: lesson.title,
        chip: `${isRetake ? "Kiểm tra lại" : "Ôn lại"} · ${when}`,
        note: isRetake
          ? `Lần trước ${lesson.percent}% · làm đạt ${MASTERY_SCORE}% là xong phần này`
          : `Lần trước ${lesson.percent}% · ôn xong sẽ mở bài kiểm tra lại`,
        minutes: Number((isRetake ? review.retake?.time_limit_minutes : lesson.session?.duration_minutes) || 15),
        done: false,
        urgent: true,
        href: review.href,
        action: isRetake ? "Làm bài" : "Vào ôn",
      });
    } else if (review.rank === 1) {
      today.push({
        key: `pick-${lesson.sessionId}`,
        kind: "pick",
        name: lesson.name,
        title: lesson.title,
        chip: "Chưa chọn ngày ôn",
        note: `Lần trước ${lesson.percent}% · chọn ngày để Pilot xếp lịch ôn`,
        minutes: 0,
        done: false,
        urgent: true,
        href: review.href,
        action: "Chọn ngày",
      });
    }
  }
  for (const session of planSessions) {
    if (!session.scheduled_start || toKey(session.scheduled_start) !== todayKey) continue;
    const done = session.status === "completed";
    today.push({
      key: session.id,
      kind: "lesson",
      name: nameOf(session),
      title: titleOf(session),
      chip: done ? "Đã học" : "Học mới",
      note: done ? "Đã xong buổi học này" : "Đọc tóm tắt, trả lời câu hỏi rồi làm bài kiểm tra",
      minutes: Number(session.duration_minutes || 0),
      done,
      urgent: false,
      href: materialsHref(session.id),
      action: done ? "Xem lại" : "Bắt đầu",
    });
  }

  // Sắp tới: ngày gần nhất sau hôm nay có lịch ôn hoặc buổi học chưa xong
  const futureReviews = weakLessons.filter((lesson) => lesson.review.rank === 2);
  const futureLessons = planSessions.filter(
    (session) => session.status !== "completed" && session.scheduled_start && toKey(session.scheduled_start) > todayKey
  );
  const nextKey = [
    ...futureReviews.map((lesson) => lesson.review.dateKey as string),
    ...futureLessons.map((session) => toKey(session.scheduled_start as string)),
  ].sort()[0];
  const upcoming = nextKey
    ? {
        dateKey: nextKey,
        phrase: dayPhrase(nextKey, todayKey),
        reviews: futureReviews.filter((lesson) => lesson.review.dateKey === nextKey).map((lesson) => lesson.title),
        lessons: futureLessons.filter((session) => toKey(session.scheduled_start as string) === nextKey).map((session) => titleOf(session)),
      }
    : null;

  // Tuần này (Thứ 2 → Chủ nhật): buổi học và buổi ôn đã hẹn
  const weekday = new Date(`${todayKey}T00:00:00Z`).getUTCDay();
  const monday = addDays(todayKey, -((weekday + 6) % 7));
  const week: WeekDay[] = Array.from({ length: 7 }, (_, index) => {
    const key = addDays(monday, index);
    const list = planSessions.filter((session) => session.scheduled_start && toKey(session.scheduled_start) === key);
    return {
      key,
      label: index === 6 ? "CN" : `T${index + 2}`,
      learn: list.length,
      learnDone: list.filter((session) => session.status === "completed").length,
      reviews: weakLessons.filter((lesson) => lesson.review.dateKey === key).length,
    };
  });

  // Ôn gần nhất (kể cả đã quá hạn)
  const dated = weakLessons.filter((lesson) => lesson.review.dateKey).sort((a, b) => String(a.review.dateKey).localeCompare(String(b.review.dateKey)));
  const nearestKey = dated[0]?.review.dateKey || null;
  const overdueLesson = dated.find((lesson) => (lesson.review.dateKey as string) < todayKey);

  return {
    plan,
    planName: subjectName(plan),
    otherPlans: Math.max(0, upcomingPlans.length - 1),
    examKey,
    daysLeft: examKey ? Math.max(0, daysBetween(todayKey, examKey)) : null,
    totalSessions: planSessions.length || Number(plan?.total_sessions || 0),
    completedSessions,
    byChapter,
    weak,
    weakCount,
    weakTotal: byChapter ? weak.length : weakLessons.length,
    reviewCount: weakLessons.length,
    nearest: !nearestKey
      ? null
      : nearestKey < todayKey
        ? { text: "Quá hạn", hot: true }
        : nearestKey === todayKey
          ? { text: "Hôm nay", hot: true }
          : { text: daysBetween(todayKey, nearestKey) === 1 ? "Ngày mai" : dayMonth(nearestKey), hot: false },
    overdue: overdueLesson ? { name: overdueLesson.name, dateKey: overdueLesson.review.dateKey as string } : null,
    today,
    upcoming,
    week,
    materialsHref: materialsHref(),
  };
}

type View = ReturnType<typeof buildView>;

/* ================= Thẻ kế hoạch đang chạy ================= */

function PlanHero({ view, percent, loading }: { view: View; percent: number; loading: boolean }) {
  const { plan } = view;

  return (
    <section className="relative rounded-[28px] border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-purple)] p-6 text-white shadow-[6px_6px_0_var(--sp-pink)] sm:p-8">
      {!plan ? (
        <div className="relative max-w-lg">
          <p className="sp-accent text-[18px] text-[#ffd3e2]">Bắt đầu thôi</p>
          <h2 className="mt-1 text-[28px] font-extrabold leading-tight text-white">
            {loading ? "Đang tải kế hoạch..." : "Bạn chưa có kế hoạch ôn thi"}
          </h2>
          {!loading && (
            <>
              <p className="mt-2 text-[15px] leading-6 text-white/80">
                Tải tài liệu lên, chọn ngày thi. AI sẽ chia bài và xếp lịch học từng ngày cho bạn.
              </p>
              <Link
                href="/study-plans#create-plan"
                className="sp-btn mt-5 border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-yellow)] px-5 py-3 text-[15px] text-[var(--sp-purple-deep)] shadow-[3px_3px_0_var(--sp-pink)]"
              >
                Tạo kế hoạch đầu tiên
                <IconArrowRight size={16} />
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 items-center gap-6 sm:grid-cols-[150px_minmax(0,1fr)] lg:grid-cols-[150px_minmax(0,1fr)_110px] lg:gap-7">
          {/* Vòng tiến độ */}
          <div className="relative h-[150px] w-[150px] justify-self-center">
            <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden="true">
              <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="11" />
              <circle
                cx="60"
                cy="60"
                r="50"
                fill="none"
                stroke="var(--sp-yellow)"
                strokeWidth="11"
                strokeLinecap="round"
                strokeDasharray={`${(percent / 100) * 314.2} 314.2`}
                className="transition-[stroke-dasharray] duration-700"
              />
            </svg>
            <span className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[34px] font-black leading-none">{percent}%</span>
              <span className="mt-1 text-[13px] text-white/75">
                {view.completedSessions}/{view.totalSessions} buổi
              </span>
            </span>
          </div>

          <div className="min-w-0">
            <p className="sp-accent text-[18px] text-[#ffd3e2]">
              Kế hoạch đang chạy
              {view.otherPlans > 0 && <span className="ml-2 text-[14px] text-white/60">· +{view.otherPlans} kế hoạch khác</span>}
            </p>
            <h2 className="truncate text-[30px] font-extrabold leading-tight text-white">{view.planName}</h2>

            <dl className="mt-3 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-[repeat(4,max-content)]">
              <div>
                <dt className="text-[13px] text-white/70">Ngày thi</dt>
                <dd className="text-[20px] font-extrabold">{view.examKey ? formatDay(view.examKey) : "—"}</dd>
              </div>
              <div>
                <dt className="text-[13px] text-white/70">Còn lại</dt>
                <dd className="text-[20px] font-extrabold">{view.daysLeft === null ? "—" : `${view.daysLeft} ngày`}</dd>
              </div>
              <div>
                <dt className="text-[13px] text-white/70">Cần ôn</dt>
                <dd className="text-[20px] font-extrabold">{view.reviewCount} bài</dd>
              </div>
              <div>
                <dt className="text-[13px] text-white/70">Ôn gần nhất</dt>
                <dd className={`text-[20px] font-extrabold ${view.nearest?.hot ? "text-[#ffd76e]" : ""}`}>{view.nearest?.text || "—"}</dd>
              </div>
            </dl>

            <Link
              href={`/study-plans/${plan.id}`}
              className="sp-btn mt-5 border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-yellow)] px-5 py-2.5 text-[15px] text-[var(--sp-purple-deep)] shadow-[3px_3px_0_var(--sp-pink)] hover:brightness-105"
            >
              Xem kế hoạch chi tiết
              <IconArrowRight size={16} />
            </Link>
          </div>

          {/* Chỗ Pilot ngồi trong thẻ */}
          <div className="hidden h-[120px] self-end lg:block" data-pilot-perch="hero" />
        </div>
      )}
    </section>
  );
}

/* ================= Hôm nay học gì ================= */

const KIND_STYLE: Record<TodayItem["kind"], { row: string; chip: string; note: string; icon: ComponentType<{ size?: number }> }> = {
  retake: { row: "border-[var(--sp-red-line)] bg-[var(--sp-red-bg)]", chip: "text-[var(--sp-red-dark)]", note: "text-[var(--sp-red-dark)]", icon: IconRepeat },
  review: { row: "border-[var(--sp-red-line)] bg-[var(--sp-red-bg)]", chip: "text-[var(--sp-red-dark)]", note: "text-[var(--sp-red-dark)]", icon: IconRepeat },
  pick: { row: "border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)]", chip: "text-[var(--sp-pink-dark)]", note: "text-[var(--sp-pink-dark)]", icon: IconCalendar },
  lesson: { row: "border-[var(--sp-line)] bg-white", chip: "text-[var(--sp-peri-dark)]", note: "text-[var(--sp-muted)]", icon: IconBook },
};

function TodayCard({
  view,
  todayKey,
  loading,
  allDone,
  minutesText,
  openCount,
}: {
  view: View;
  todayKey: string;
  loading: boolean;
  allDone: boolean;
  minutesText: string;
  openCount: number;
}) {
  const firstOpen = view.today.findIndex((item) => !item.done);
  const learnTotal = view.week.reduce((sum, day) => sum + day.learn, 0);
  const learnDone = view.week.reduce((sum, day) => sum + day.learnDone, 0);
  const reviewTotal = view.week.reduce((sum, day) => sum + day.reviews, 0);
  const upcoming = view.upcoming;

  return (
    <section className="sp-card relative p-5 sm:p-7">
      {/* Chỗ Pilot ngồi trên mép thẻ, chỉ xuống việc đầu tiên */}
      <div className="absolute -top-[96px] right-[160px] hidden h-[120px] w-[110px] lg:block" data-pilot-perch="today" />

      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="sp-accent text-[17px] text-[var(--sp-pink)]">
            {allDone ? "Xong hết việc hôm nay" : openCount > 0 ? `${openCount} việc · ${minutesText}` : "Lịch hôm nay"}
          </p>
          <h2 className="text-[22px] text-[var(--sp-ink)]">Hôm nay học gì?</h2>
        </div>
        {view.plan && (
          <Link href={`/study-plans/${view.plan.id}`} className="flex items-center gap-1 text-sm font-bold text-[var(--sp-peri-dark)] hover:underline">
            Cả lịch
            <IconArrowRight size={15} />
          </Link>
        )}
      </div>

      {loading ? (
        <LoadingMascot bare className="mt-5" text="Đang xếp lịch hôm nay…" sub="Pilot đang xem hôm nay bạn cần học gì." />
      ) : view.today.length === 0 ? (
        <div className="mt-5 flex flex-col items-center rounded-2xl border-2 border-dashed border-[var(--sp-line)] px-5 py-8 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]">
            <IconCheck size={22} />
          </span>
          <p className="mt-3 font-bold text-[var(--sp-ink)]">Hôm nay là ngày nghỉ</p>
          <p className="mt-1 text-sm text-[var(--sp-muted)]">Không có buổi học hay buổi ôn nào hẹn hôm nay.</p>
          <Link href={view.materialsHref} className="sp-btn sp-btn-secondary mt-4 px-4 py-2 text-sm">
            <IconBook size={15} />
            Mở tài liệu học tập
          </Link>
        </div>
      ) : (
        <ul className="mt-5 space-y-3">
          {view.today.map((item, index) => {
            const style = item.done
              ? { row: "border-emerald-200 bg-emerald-50", chip: "text-emerald-700", note: "text-emerald-700", icon: IconCheck }
              : KIND_STYLE[item.kind];
            const Icon = style.icon;
            const primary = index === firstOpen;
            return (
              <li
                key={item.key}
                className={`grid grid-cols-[52px_minmax(0,1fr)] items-center gap-x-4 gap-y-3 rounded-[20px] border-2 px-4 py-4 sm:grid-cols-[64px_minmax(0,1fr)_132px] sm:px-5 ${style.row}`}
              >
                <div className="border-r-2 border-dashed border-black/10 pr-3 text-center">
                  <p className="text-[24px] font-black leading-none text-[var(--sp-purple)]">{item.minutes || "–"}</p>
                  <p className="mt-0.5 text-[12px] text-[var(--sp-muted)]">phút</p>
                </div>
                <div className="min-w-0">
                  <span className={`sp-chip flex w-fit items-center gap-1 bg-white ${style.chip}`}>
                    <Icon size={13} />
                    {item.chip}
                  </span>
                  <p className="mt-1 line-clamp-2 text-[15px] font-bold leading-snug text-[var(--sp-ink)] sm:text-[16px]">{item.title}</p>
                  <p className={`mt-0.5 text-[13px] font-semibold ${style.note}`}>{item.note}</p>
                </div>
                <Link
                  href={item.href}
                  className={`sp-btn col-span-2 h-[42px] w-full text-sm sm:col-span-1 ${
                    item.done ? "sp-btn-secondary" : primary ? "sp-btn-primary !bg-[var(--sp-pink)]" : "sp-btn-secondary !text-[var(--sp-peri-dark)]"
                  }`}
                >
                  {primary && !item.done && <IconPlay size={14} />}
                  {item.action}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {/* Sắp tới */}
      {!loading && upcoming && (
        <div className="mt-3 grid grid-cols-[52px_minmax(0,1fr)] items-center gap-x-4 gap-y-2 rounded-[20px] border-2 border-dashed border-[var(--sp-line)] px-4 py-3 text-[14px] text-[var(--sp-muted)] sm:grid-cols-[64px_minmax(0,1fr)_132px] sm:px-5">
          <p className="text-center text-[13px] font-extrabold leading-tight text-[var(--sp-pink-dark)]">
            {daysBetween(todayKey, upcoming.dateKey) === 1 ? "Mai" : WEEKDAY[new Date(`${upcoming.dateKey}T00:00:00Z`).getUTCDay()]}
            <br />
            {dayMonth(upcoming.dateKey)}
          </p>
          <p className="min-w-0">
            <b className="text-[var(--sp-ink)]">Sắp tới:</b>{" "}
            {upcoming.reviews.length > 0 && (
              <>
                ôn <b className="text-[var(--sp-ink)]">{upcoming.reviews.slice(0, 2).join(" và ")}</b>
                {upcoming.reviews.length > 2 && ` và ${upcoming.reviews.length - 2} bài khác`}
              </>
            )}
            {upcoming.reviews.length > 0 && upcoming.lessons.length > 0 && "; "}
            {upcoming.lessons.length > 0 && (
              <>
                học <b className="text-[var(--sp-ink)]">{upcoming.lessons.slice(0, 2).join(" và ")}</b>
              </>
            )}
          </p>
          {view.plan && (
            <Link href={`/study-plans/${view.plan.id}`} className="col-span-2 text-sm font-bold text-[var(--sp-peri-dark)] hover:underline sm:col-span-1 sm:text-right">
              Xem lịch ôn →
            </Link>
          )}
        </div>
      )}

      {/* Tuần này */}
      {view.plan && (
        <div className="mt-6 border-t-2 border-dashed border-[var(--sp-line)] pt-5">
          <div className="flex items-center justify-between gap-3">
            <p className="font-bold text-[var(--sp-ink)]">Tuần này</p>
            <p className="text-[13px] text-[var(--sp-muted)]">
              {learnDone}/{learnTotal} buổi học xong · {reviewTotal} buổi ôn
            </p>
          </div>
          <div className="mt-3 grid grid-cols-7 gap-1.5 sm:gap-2.5">
            {view.week.map((day) => {
              const isToday = day.key === todayKey;
              const isPast = day.key < todayKey;
              const learnAllDone = day.learn > 0 && day.learnDone === day.learn;
              const empty = day.learn === 0 && day.reviews === 0;
              const tone = empty
                ? "bg-[repeating-linear-gradient(135deg,var(--sp-surface-2)_0_6px,#f1edf4_6px_12px)] text-[var(--sp-soft)]"
                : isToday
                  ? "border-2 border-[var(--sp-red)] bg-[var(--sp-red-bg)] text-[var(--sp-red-dark)] shadow-[3px_3px_0_var(--sp-red-line)]"
                  : day.reviews > 0
                    ? "border-2 border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]"
                    : learnAllDone
                      ? "bg-[var(--sp-peri)] text-white"
                      : isPast
                        ? "border-2 border-[var(--sp-amber-dark)]/30 bg-[var(--sp-amber-bg)] text-[var(--sp-amber-dark)]"
                        : "bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]";
              return (
                <div key={day.key} className="text-center">
                  <p className={`text-[13px] font-extrabold ${isToday ? "text-[var(--sp-red-dark)]" : "text-[var(--sp-muted)]"}`}>
                    {day.label}
                    {isToday && <span className="hidden sm:inline"> · nay</span>}
                  </p>
                  <div
                    className={`mt-1.5 flex h-[60px] flex-col items-center justify-center gap-0.5 rounded-[14px] text-[12px] font-extrabold leading-tight sm:h-[66px] sm:text-[12.5px] ${tone}`}
                    title={`${day.learn ? `${day.learnDone}/${day.learn} buổi học xong` : "Không có buổi học"}${day.reviews ? ` · ${day.reviews} buổi ôn` : ""}`}
                  >
                    {empty ? (
                      "Nghỉ"
                    ) : (
                      <>
                        {day.learn > 0 &&
                          (learnAllDone ? (
                            <span className="flex items-center gap-1">
                              <IconCheck size={13} />
                              Học
                            </span>
                          ) : (
                            <span>
                              {day.learnDone}/{day.learn} học
                            </span>
                          ))}
                        {day.reviews > 0 && (
                          <span className="flex items-center gap-1">
                            <IconRepeat size={12} />
                            Ôn {day.reviews}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-[var(--sp-muted)]">
            <span className="flex items-center gap-1.5">
              <i className="h-2.5 w-2.5 rounded-[3px] bg-[var(--sp-peri)]" />
              Buổi học
            </span>
            <span className="flex items-center gap-1.5">
              <i className="h-2.5 w-2.5 rounded-[3px] bg-[var(--sp-pink-line)]" />
              Buổi ôn đã hẹn
            </span>
            <span className="flex items-center gap-1.5">
              <i className="h-2.5 w-2.5 rounded-[3px] bg-[var(--sp-red)]" />
              Hôm nay
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

/* ================= Lưu ý điểm yếu ================= */

const TONE_TEXT: Record<Review["tone"], string> = {
  red: "text-[var(--sp-red-dark)]",
  pink: "text-[var(--sp-pink-dark)]",
  amber: "text-[var(--sp-amber-dark)]",
  muted: "text-[var(--sp-muted)]",
};

function WeakCard({ view, loading }: { view: View; loading: boolean }) {
  return (
    <section className="rounded-[24px] border-2 border-[var(--sp-purple-deep)] bg-white p-5 shadow-[5px_5px_0_var(--sp-pink)] sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="sp-accent text-[17px] text-[var(--sp-pink)]">Lưu ý điểm yếu</p>
          <h2 className="text-[22px] text-[var(--sp-ink)]">Cần ôn lại thêm</h2>
        </div>
        {loading ? (
          <IconAlert size={20} className="mt-1 text-[var(--sp-ink)]" />
        ) : (
          <span className="mt-1 text-[13px] font-bold text-[var(--sp-muted)]">{view.weakCount}</span>
        )}
      </div>

      {loading ? (
        <div className="mt-4 h-[84px] animate-pulse rounded-2xl bg-[var(--sp-surface-2)]" />
      ) : view.weak.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-4 text-sm font-semibold text-emerald-800">
          Chưa có phần nào dưới {MASTERY_SCORE}%. Giữ phong độ nhé!
        </p>
      ) : (
        <>
          <ul className="mt-4 space-y-3">
            {view.weak.map((item, index) => (
              <li
                key={item.key}
                className={`grid grid-cols-[56px_minmax(0,1fr)] items-center gap-3 rounded-[18px] border-2 px-4 py-3.5 ${
                  index === 0 ? "border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)]" : "border-[var(--sp-line)] bg-white"
                }`}
              >
                <span className={`text-[23px] font-black ${item.percent < 50 ? "text-[var(--sp-red)]" : "text-[#c98a00]"}`}>{item.percent}%</span>
                <div className="min-w-0">
                  <p className="text-[11.5px] font-extrabold uppercase tracking-wide text-[var(--sp-purple)]">{item.kicker}</p>
                  <p className="text-[14.5px] font-bold leading-snug text-[var(--sp-ink)]">{item.title}</p>
                  <p className={`mt-1 flex items-start gap-1.5 text-[12.5px] font-bold leading-snug ${TONE_TEXT[item.tone]}`}>
                    {item.tone === "red" ? (
                      <IconClock size={14} className="mt-px shrink-0" />
                    ) : (
                      <IconCalendar size={14} className="mt-px shrink-0" />
                    )}
                    {item.text}
                  </p>
                  <Link
                    href={item.href}
                    className={`sp-btn mt-2.5 h-9 w-[120px] text-[13px] ${
                      index === 0 ? "sp-btn-primary !bg-[var(--sp-pink)]" : "sp-btn-secondary !text-[var(--sp-peri-dark)]"
                    }`}
                  >
                    {item.label}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
          <Link href="/weak-areas" className="mt-3.5 block text-center text-[14px] font-bold text-[var(--sp-peri-dark)] hover:underline">
            {view.byChapter
              ? "Xem chi tiết từng chương ở Đánh giá năng lực →"
              : view.weakTotal > view.weak.length
                ? `Xem cả ${view.weakTotal} bài ở Đánh giá năng lực →`
                : "Xem ở Đánh giá năng lực →"}
          </Link>
        </>
      )}
    </section>
  );
}

/* ================= Góc đọc của Pilot ================= */

function PilotNook() {
  return (
    <section className="relative hidden h-[190px] rounded-[24px] border-2 border-dashed border-[var(--sp-lav-line)] bg-gradient-to-b from-white to-[#f5f2fb] lg:block">
      <div className="absolute left-5 top-4">
        <p className="sp-accent text-[15px] text-[var(--sp-pink)]">Góc nhỏ</p>
        <p className="font-bold text-[var(--sp-ink)]">Góc đọc của Pilot</p>
        <p className="text-[12.5px] text-[var(--sp-muted)]">Chạm vào Pilot thử xem!</p>
      </div>
      <svg className="absolute bottom-[18px] left-[22px]" width="96" height="70" viewBox="0 0 96 70" aria-hidden="true">
        <rect x="2" y="48" width="84" height="18" rx="4" fill="#5b7fe3" stroke="#33094a" strokeWidth="2.5" />
        <rect x="8" y="30" width="76" height="18" rx="4" fill="#e0457b" stroke="#33094a" strokeWidth="2.5" />
        <rect x="14" y="12" width="64" height="18" rx="4" fill="#f6c343" stroke="#33094a" strokeWidth="2.5" />
        <path d="M60 12 l6 -10 l6 10" fill="#fff" stroke="#33094a" strokeWidth="2" />
      </svg>
      <span className="absolute bottom-4 right-[42px] h-[26px] w-[130px] rounded-[50%] border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-pink-line)]" />
      <div className="absolute bottom-6 right-[52px] h-[120px] w-[110px]" data-pilot-perch="read" />
    </section>
  );
}

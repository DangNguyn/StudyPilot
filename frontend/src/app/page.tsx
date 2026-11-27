"use client";

import { currentLocale, tx } from "@/lib/i18n";
import { useCallback, useEffect, useMemo, useState, type ComponentType, type SVGProps } from "react";
import Link from "next/link";
import { HomePilot, usePilotRest, type PilotPerch } from "@/components/home-pilot";
import { LoadingMascot } from "@/components/loading-play";
import { getMainTopicTitle } from "@/lib/content-titles";
import { useCurrentUserName } from "@/lib/current-user";
import {
  IconAlert,
  IconArrowRight,
  IconBook,
  IconCalendar,
  IconChart,
  IconCheck,
  IconClock,
  IconFile,
  IconLock,
  IconPen,
  IconPlay,
  IconPlus,
  IconRepeat,
} from "@/components/icons";
import {
  buildLessonStatuses,
  buildTodayTasks,
  lessonLinksFor,
  type LessonStatus,
} from "@/lib/lesson-status";
import { PASS_SCORE, WEAK_BELOW, isPass } from "@/lib/score-rules";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

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
  is_final?: boolean;
  review_plan_id?: string | null;
  needs_attention?: boolean;
  review_done?: boolean;
  final_quiz_id?: string | null;
};

type QuizAttempt = {
  attempt_id: string;
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
  if (diff === 0) return tx("hôm nay");
  if (diff === 1) return tx("ngày mai {0}", [dayMonth(key)]);
  if (diff > 1 && diff < 7) return `${WEEKDAY[new Date(`${key}T00:00:00Z`).getUTCDay()]} ${dayMonth(key)}`;
  return tx("ngày {0}", [dayMonth(key)]);
}

/* Cùng quy ước với trang Đánh giá năng lực */
const CHAPTER_PREFIX = /^(?:chương|chapter|unit|phần|part|bài|lesson)\s*([0-9ivxlc]+)\s*[:.\-–—]?\s*/i;
const chapterKeyOf = (topic: Topic | undefined) => String(topic?.hierarchy || "").split(">")[0].trim() || topic?.id || "other";

async function fetchList<T>(path: string): Promise<T[]> {
  const response = await fetch(`${API_BASE_URL}${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(tx("API {0} trả về lỗi {1}", [path, response.status]));
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
        ? tx("Không kết nối được backend. Hãy kiểm tra backend có đang chạy không.")
        : failed > 0
          ? tx("Một vài dữ liệu chưa tải được, số liệu có thể chưa đầy đủ.")
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
  shadow: string;
}[] = [
  { title: tx("Kế hoạch ôn thi"), text: tx("Lịch học và lịch ôn"), href: "/study-plans", icon: IconCalendar, tone: "bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]", shadow: "var(--sp-lav-line)" },
  { title: tx("Tài liệu học tập"), text: tx("Tóm tắt từng bài học"), href: "/study-materials", icon: IconFile, tone: "bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]", shadow: "var(--sp-pink-line)" },
  { title: tx("Kiểm tra kiến thức"), text: tx("Có giải thích câu sai"), href: "/quizzes", icon: IconPen, tone: "bg-[var(--sp-amber-bg)] text-[var(--sp-amber-dark)]", shadow: "#f3dc9b" },
  { title: tx("Đánh giá năng lực"), text: tx("Tiến độ và điểm yếu"), href: "/weak-areas", icon: IconChart, tone: "bg-[#f1e6f7] text-[var(--sp-purple)]", shadow: "#e3cdf0" },
];

/* ================= Trang ================= */

export default function Home() {
  const userName = useCurrentUserName();
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
    const label = new Date(`${todayKey}T00:00:00`).toLocaleDateString(currentLocale(), {
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
    openMinutes >= 60 ? tx("{0} giờ", [(Math.round((openMinutes / 60) * 10) / 10).toLocaleString(currentLocale())]) : tx("{0} phút", [openMinutes]);
  const allDone = view.today.length > 0 && open.length === 0;

  const countOf = (kind: TodayItem["kind"]) => open.filter((item) => item.kind === kind).length;
  const todayParts = [
    countOf("lesson") && tx("{0} buổi học mới", [countOf("lesson")]),
    countOf("retake") && tx("{0} bài kiểm tra lại", [countOf("retake")]),
    countOf("review") && tx("{0} bài cần ôn", [countOf("review")]),
    countOf("pick") && tx("{0} bài chưa chọn ngày ôn", [countOf("pick")]),
  ].filter(Boolean) as string[];

  const percent = view.totalSessions ? Math.round((view.completedSessions / view.totalSessions) * 100) : 0;
  const pilotLines: Record<PilotPerch, string[]> = {
    sign: open.length
      ? [tx("Hôm nay còn {0} việc nè!", [open.length]), tx("Làm bài hôm nay trước rồi chơi nha~")]
      : allDone
        ? [tx("Xong hết rồi! Nghỉ ngơi thôi~")]
        : [tx("Hôm nay nhẹ nhàng ghê~")],
    hero:
      view.daysLeft !== null
        ? [tx("Còn {0} ngày nữa là thi, mình đi cùng bạn!", [view.daysLeft]), tx("{0}% rồi đó, cố lên!", [percent])]
        : [tx("Tạo kế hoạch để mình xếp lịch cho bạn nha!")],
    today: open[0]
      ? [tx("Làm “{0}” trước nha ↓", [open[0].name]), open[0].minutes ? tx("Chỉ {0} phút thôi, mình canh giờ cho!", [open[0].minutes]) : tx("Việc này trước nha ↓")]
      : [tx("Hôm nay xong hết rồi nè!")],
    read: view.upcoming
      ? [tx("Mình đọc trước bài {0} cho bạn…", [view.upcoming.phrase]), tx("Suỵt, Pilot đang học bài…")]
      : [tx("Suỵt, Pilot đang học bài…")],
  };

  return (
    <div className="relative mx-auto max-w-7xl space-y-6">
      {/* Lời chào: chỗ đậu đầu tiên của Pilot nằm ngay sau tên */}
      <section className="grid grid-cols-[minmax(0,1fr)_100px] items-center gap-x-3 lg:grid-cols-[auto_130px_minmax(0,1fr)_auto]">
        <p className="sp-accent col-span-full text-[18px] text-[var(--sp-pink)]">{todayLabel}</p>
        <h1 className="mt-1 text-[36px] leading-[1.08] sm:text-[52px]">

          {tx("Chào mừng trở lại,")} <span className="sp-squiggle">{userName}</span>
        </h1>
        <div className="h-[120px]" data-pilot-perch="sign" />
        <span className="hidden lg:block" />
        <div className="col-span-full mt-3 flex flex-wrap gap-3 lg:col-span-1 lg:mt-0">
          <button
            type="button"
            onClick={() => setPilotRest(!pilotRest)}
            className="sp-btn sp-btn-secondary h-11 px-4 text-[14px] !text-[var(--sp-peri-dark)]"
          >
            {pilotRest ? tx("Gọi Pilot về") : tx("Cho Pilot nghỉ")}
          </button>
          <Link href="/study-plans#create-plan" className="sp-btn sp-btn-primary h-11 whitespace-nowrap px-5 text-[15px]">
            <IconPlus size={17} />

            {tx("Tạo kế hoạch mới")}
          </Link>
        </div>
        <p className="col-span-full mt-2 text-[15px] text-[var(--sp-text-2)]">
          {loading ? (
            tx("Đang tải lịch học của bạn...")
          ) : !view.plan ? (
            tx("Tạo kế hoạch ôn thi đầu tiên để AI xếp lịch học cho bạn.")
          ) : todayParts.length > 0 ? (
            <>

              {tx("Hôm nay có")} <b className="text-[var(--sp-pink-dark)]">{todayParts.join(", ")}</b>
              {openMinutes > 0 && tx(", khoảng {0}", [minutesText])}{tx(". Làm xong là Pilot cho bạn nghỉ!")}
            </>
          ) : allDone ? (
            <>

              {tx("Bạn đã")} <b className="text-[var(--sp-pink-dark)]">{tx("xong hết việc hôm nay")}</b>{tx(". Tối nay nghỉ ngơi, mai mình ôn tiếp nhé!")}
            </>
          ) : (
            tx("Hôm nay không có lịch học hay lịch ôn. Nghỉ ngơi hoặc xem lại bài cũ nhé.")
          )}
        </p>
      </section>

      {error && (
        <p role="alert" className="rounded-2xl border-2 border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)] px-4 py-3 text-sm font-medium text-[var(--sp-pink-dark)]">
          {error}{" "}
          <button type="button" onClick={() => void refreshDashboard()} className="font-bold underline underline-offset-2">

            {tx("Thử lại")}
          </button>
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* ---------- Cột trái ---------- */}
        <div className="min-w-0 space-y-6">
          <PlanHero view={view} percent={percent} loading={loading} />
          <TodayCard view={view} todayKey={todayKey} loading={loading} allDone={allDone} minutesText={minutesText} openCount={open.length} />
          <QuickLinks />
        </div>

        {/* ---------- Cột phải: góc đọc kéo dài cho hai cột bằng nhau ---------- */}
        <div className="flex min-w-0 flex-col gap-6">
          <WeakCard view={view} loading={loading} />

          <PilotNook />
        </div>
      </div>

      <HomePilot
        hidden={pilotRest}
        sign={loading ? "…" : open.length ? tx("{0} việc", [open.length]) : allDone ? "Xong!" : tx("Nghỉ!")}
        lines={pilotLines}
        alert={view.overdue ? tx("Bài “{0}” quá hạn từ {1} rồi… ôn liền nha!", [view.overdue.name, dayMonth(view.overdue.dateKey)]) : null}
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
};

type Lesson = {
  sessionId: string;
  session: StudySession | undefined;
  name: string;
  title: string;
  chapterKey: string;
  percent: number;
  review: Review;
  status: LessonStatus;
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
  /* Kế hoạch đang khoá chờ bài tổng hợp */
  locked?: boolean;
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
    data.subjects.find((subject) => subject.id === plan?.subject_id)?.name || plan?.title || tx("Kế hoạch ôn thi");

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
    const full = String(topic?.hierarchy || "").split(">")[0].trim() || (topic ? getMainTopicTitle(topic.name) : tx("Nội dung khác"));
    const match = full.match(CHAPTER_PREFIX);
    chapters.push({
      key,
      no: match ? match[1].toUpperCase() : String(chapters.length + 1),
      title: full.replace(CHAPTER_PREFIX, "").trim() || full,
    });
  }
  const byChapter = chapters.length >= 2;
  const chapterOf = (key: string) => chapters.find((chapter) => chapter.key === key);
  const nameOf = (session?: StudySession) => getMainTopicTitle(topicById.get(String(session?.topic_id))?.name || tx("Bài học"));
  const titleOf = (session?: StudySession) => {
    const chapter = chapterOf(chapterKeyOf(topicById.get(String(session?.topic_id))));
    return `${byChapter && chapter ? tx("Chương {0} · ", [chapter.no]) : ""}${nameOf(session)}`;
  };

  // Trạng thái từng buổi: hàm dùng chung với Kế hoạch, Đánh giá năng lực, Kiểm tra kiến thức (L7)
  const planSessionIds = new Set(planSessions.map((session) => session.id));
  const links = lessonLinksFor(plan?.subject_id);
  const statuses = buildLessonStatuses({
    sessions: planSessions.map((session) => ({
      id: session.id,
      topic_id: session.topic_id,
      scheduled_start: session.scheduled_start || "",
      status: session.status || "scheduled",
    })),
    quizzes: data.quizzes.filter((quiz) => quiz.study_session_id && planSessionIds.has(quiz.study_session_id)),
    attempts: data.attempts,
    todayKey,
    links,
  });
  const sessionById = new Map(planSessions.map((session) => [session.id, session]));

  // Việc ôn của một bài, theo nút "việc tiếp theo" dùng chung
  const reviewOf = (status: LessonStatus): Review => {
    const next = status.next;
    const href = next.href || links(status.sessionId).learn;
    const dateKey = status.review?.reviewDate?.slice(0, 10) || null;
    if (next.kind === "final") {
      return { dateKey, rank: 0, tone: "red", text: tx("Cần làm bài tổng hợp 20 câu"), label: next.label, href };
    }
    if (next.kind === "pick_date") {
      return { dateKey: null, rank: 1, tone: "pink", text: tx("Chưa chọn ngày ôn"), label: next.label, href };
    }
    if ((next.kind === "review" || next.kind === "retake") && dateKey) {
      if (dateKey > todayKey) {
        return { dateKey, rank: 2, tone: "amber", text: tx("Ôn {0}", [dayPhrase(dateKey, todayKey)]), label: next.label, href };
      }
      return {
        dateKey,
        rank: 0,
        tone: "red",
        text: dateKey === todayKey ? tx("Ôn hôm nay") : tx("Quá hạn từ {0}", [dayMonth(dateKey)]),
        label: next.label,
        href,
      };
    }
    return {
      dateKey: null,
      rank: 3,
      tone: "muted",
      text: status.level === "attention" ? tx("Đã ôn xong · Cần chú ý") : tx("Chưa có bài ôn cho bài này"),
      label: next.label,
      href,
    };
  };

  const tested: Lesson[] = [];
  for (const status of statuses) {
    const session = sessionById.get(status.sessionId);
    if (!session || status.currentScore === null) continue;
    tested.push({
      sessionId: status.sessionId,
      session,
      name: nameOf(session),
      title: titleOf(session),
      chapterKey: chapterKeyOf(topicById.get(String(session.topic_id))),
      percent: status.currentScore,
      review: reviewOf(status),
      status,
    });
  }
  // Cần ôn thêm: điểm hiện tại chưa đạt, hoặc bài tổng hợp trượt (Cần chú ý)
  const weakLessons = tested
    .filter((lesson) => !isPass(lesson.percent) || lesson.status.level === "attention")
    .sort((a, b) => a.review.rank - b.review.rank || a.percent - b.percent);

  // Cần ôn lại thêm: theo bài học (1 chương) hoặc theo chương
  let weak: WeakItem[];
  let weakCount: string;
  if (byChapter) {
    const groups = chapters
      .map((chapter) => {
        const lessons = tested.filter((lesson) => lesson.chapterKey === chapter.key);
        const weakOnes = weakLessons.filter((lesson) => lesson.chapterKey === chapter.key).sort((a, b) => a.percent - b.percent);
        const total = planSessions.filter((session) => chapterKeyOf(topicById.get(String(session.topic_id))) === chapter.key).length;
        const average = lessons.length ? Math.round(lessons.reduce((sum, lesson) => sum + lesson.percent, 0) / lessons.length) : null;
        return { chapter, weakOnes, total, average };
      })
      .filter((group) => group.average !== null && group.weakOnes.length > 0)
      .sort((a, b) => (a.average as number) - (b.average as number));
    weakCount = tx("{0} chương", [groups.length]);
    weak = groups.slice(0, 2).map(({ chapter, weakOnes, total, average }, index) => {
      const weakest = weakOnes[0];
      return {
        key: chapter.key,
        kicker: tx("Chương {0} · Ưu tiên {1}", [chapter.no, index + 1]),
        title: chapter.title,
        percent: average as number,
        text: tx("{0}/{1} bài dưới {2}% · yếu nhất: {3} ({4}%)", [weakOnes.length, total, PASS_SCORE, weakest.name, weakest.percent]),
        tone: weakest.review.tone,
        label: weakest.review.label,
        href: weakest.review.href,
      };
    });
  } else {
    weakCount = tx("{0} bài", [weakLessons.length]);
    weak = weakLessons.slice(0, 3).map((lesson, index) => ({
      key: lesson.sessionId,
      kicker: tx("Ưu tiên {0} · Buổi {1}", [index + 1, lesson.status.order]),
      title: lesson.title,
      percent: lesson.percent,
      text: `${lesson.status.levelLabel} · ${lesson.review.text}`,
      tone: lesson.review.tone,
      label: lesson.review.label,
      href: lesson.review.href,
    }));
  }

  // Hôm nay: cùng danh sách với trang Kế hoạch (buildTodayTasks), cộng buổi hôm nay đã xong
  const scoreNote = (status: LessonStatus) =>
    status.firstScore !== null && status.currentScore !== null && status.currentScore !== status.firstScore
      ? tx("Lần đầu {0}% · Lần gần nhất {1}%", [status.firstScore, status.currentScore])
      : tx("Lần trước {0}%", [status.currentScore ?? 0]);
  const today: TodayItem[] = [];
  for (const task of buildTodayTasks(statuses, todayKey)) {
    const { status } = task;
    const session = sessionById.get(status.sessionId);
    const next = status.next;
    const href = next.href || links(status.sessionId).learn;
    const base = {
      name: nameOf(session),
      title: titleOf(session),
      done: false,
      href,
      action: next.locked ? tx("Đang khoá") : next.label,
      locked: next.locked,
    };
    if (task.kind === "learn" || task.kind === "quiz") {
      today.push({
        ...base,
        key: task.key,
        kind: "lesson",
        chip: task.overdue
          ? tx("Học bù · trễ từ {0}", [dayMonth(status.dateKey)])
          : task.kind === "quiz"
            ? tx("Buổi {0} · Làm bài kiểm tra", [status.order])
            : tx("Buổi {0} · Học mới", [status.order]),
        note: next.locked
          ? tx("Tạm khoá: làm xong bài tổng hợp 20 câu để mở")
          : task.kind === "quiz"
            ? tx("Đã học xong, còn bài kiểm tra cuối buổi")
            : tx("Đọc tóm tắt, trả lời câu hỏi rồi làm bài kiểm tra"),
        minutes: Number(session?.duration_minutes || 0),
        urgent: task.overdue,
      });
    } else if (task.kind === "final") {
      today.push({
        ...base,
        key: task.key,
        kind: "retake",
        chip: tx("Bài tổng hợp · Buổi {0}", [status.order]),
        note: tx("Kiểm tra lại chưa đạt {0}% · ôn lại rồi làm bài 20 câu để mở khoá kế hoạch", [PASS_SCORE]),
        minutes: 30,
        urgent: true,
      });
    } else if (next.kind === "pick_date") {
      today.push({
        ...base,
        key: task.key,
        kind: "pick",
        chip: tx("Chưa chọn ngày ôn"),
        note: tx("{0} · chọn ngày để Pilot xếp lịch ôn", [scoreNote(status)]),
        minutes: 0,
        urgent: true,
      });
    } else {
      const dateKey = status.review?.reviewDate?.slice(0, 10) || todayKey;
      const when = dateKey === todayKey ? tx("hẹn hôm nay") : tx("quá hạn từ {0}", [dayMonth(dateKey)]);
      const isRetake = next.kind === "retake";
      today.push({
        ...base,
        key: task.key,
        kind: isRetake ? "retake" : "review",
        chip: `${isRetake ? tx("Kiểm tra lại") : tx("Ôn lại")} · ${when}`,
        note: isRetake
          ? tx("{0} · làm đạt {1}% là xong phần này", [scoreNote(status), PASS_SCORE])
          : tx("{0} · ôn xong sẽ mở bài kiểm tra lại", [scoreNote(status)]),
        minutes: Number((isRetake ? 15 : session?.duration_minutes) || 15),
        urgent: true,
      });
    }
  }
  for (const status of statuses) {
    if (status.dateKey !== todayKey || status.sessionStatus !== "completed" || !status.firstAttemptId) continue;
    const session = sessionById.get(status.sessionId);
    today.push({
      key: `done-${status.sessionId}`,
      kind: "lesson",
      name: nameOf(session),
      title: titleOf(session),
      chip: tx("Buổi {0} · Đã học", [status.order]),
      note: tx("Đã xong buổi học này"),
      minutes: Number(session?.duration_minutes || 0),
      done: true,
      urgent: false,
      href: links(status.sessionId).revisit,
      action: tx("Xem lại"),
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
        ? { text: tx("Quá hạn"), hot: true }
        : nearestKey === todayKey
          ? { text: tx("Hôm nay"), hot: true }
          : { text: daysBetween(todayKey, nearestKey) === 1 ? tx("Ngày mai") : dayMonth(nearestKey), hot: false },
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
          <p className="sp-accent text-[18px] text-[#ffd3e2]">{tx("Bắt đầu thôi")}</p>
          <h2 className="mt-1 text-[28px] font-extrabold leading-tight text-white">
            {loading ? tx("Đang tải kế hoạch...") : tx("Bạn chưa có kế hoạch ôn thi")}
          </h2>
          {!loading && (
            <>
              <p className="mt-2 text-[15px] leading-6 text-white/80">

                {tx("Tải tài liệu lên, chọn ngày thi. AI sẽ chia bài và xếp lịch học từng ngày cho bạn.")}
              </p>
              <Link
                href="/study-plans#create-plan"
                className="sp-btn mt-5 border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-yellow)] px-5 py-3 text-[15px] text-[var(--sp-purple-deep)] shadow-[3px_3px_0_var(--sp-pink)]"
              >

                {tx("Tạo kế hoạch đầu tiên")}
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
                {tx("{0}/{1} buổi", [view.completedSessions, view.totalSessions])}</span>
            </span>
          </div>

          <div className="min-w-0">
            <p className="sp-accent text-[18px] text-[#ffd3e2]">

              {tx("Kế hoạch đang chạy")}
              {view.otherPlans > 0 && <span className="ml-2 text-[14px] text-white/60">{tx("· +{0} kế hoạch khác", [view.otherPlans])}</span>}
            </p>
            <h2 className="truncate text-[30px] font-extrabold leading-tight text-white">{view.planName}</h2>

            <dl className="mt-3 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-[repeat(4,max-content)]">
              <div>
                <dt className="text-[13px] text-white/70">{tx("Ngày thi")}</dt>
                <dd className="text-[20px] font-extrabold">{view.examKey ? formatDay(view.examKey) : "—"}</dd>
              </div>
              <div>
                <dt className="text-[13px] text-white/70">{tx("Còn lại")}</dt>
                <dd className="text-[20px] font-extrabold">{view.daysLeft === null ? "—" : tx("{0} ngày", [view.daysLeft])}</dd>
              </div>
              <div>
                <dt className="text-[13px] text-white/70">{tx("Cần ôn")}</dt>
                <dd className="text-[20px] font-extrabold">{tx("{0} bài", [view.reviewCount])}</dd>
              </div>
              <div>
                <dt className="text-[13px] text-white/70">{tx("Ôn gần nhất")}</dt>
                <dd className={`text-[20px] font-extrabold ${view.nearest?.hot ? "text-[#ffd76e]" : ""}`}>{view.nearest?.text || "—"}</dd>
              </div>
            </dl>

            <Link
              href={`/study-plans/${plan.id}`}
              className="sp-btn mt-5 border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-yellow)] px-5 py-2.5 text-[15px] text-[var(--sp-purple-deep)] shadow-[3px_3px_0_var(--sp-pink)] hover:brightness-105"
            >

              {tx("Xem kế hoạch chi tiết")}
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
  const firstOpen = view.today.findIndex((item) => !item.done && !item.locked);
  const learnTotal = view.week.reduce((sum, day) => sum + day.learn, 0);
  const learnDone = view.week.reduce((sum, day) => sum + day.learnDone, 0);
  const reviewTotal = view.week.reduce((sum, day) => sum + day.reviews, 0);
  const upcoming = view.upcoming;

  return (
    <section className="relative rounded-[26px] border-2 border-[var(--sp-purple-deep)] bg-white p-5 shadow-[6px_6px_0_var(--sp-lav-line)] sm:p-7">
      {/* Chỗ Pilot ngồi trên mép thẻ, chỉ xuống việc đầu tiên */}
      <div className="absolute -top-[96px] right-[160px] hidden h-[120px] w-[110px] lg:block" data-pilot-perch="today" />

      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="sp-accent text-[17px] text-[var(--sp-pink)]">
            {allDone ? tx("Xong hết việc hôm nay") : openCount > 0 ? tx("{0} việc · {1}", [openCount, minutesText]) : tx("Lịch hôm nay")}
          </p>
          <h2 className="text-[22px] text-[var(--sp-ink)]">{tx("Hôm nay học gì?")}</h2>
        </div>
        {view.plan && (
          <Link href={`/study-plans/${view.plan.id}`} className="flex items-center gap-1 text-sm font-bold text-[var(--sp-peri-dark)] hover:underline">

            {tx("Cả lịch")}
            <IconArrowRight size={15} />
          </Link>
        )}
      </div>

      {loading ? (
        <LoadingMascot bare className="mt-5" text={tx("Đang xếp lịch hôm nay…")} sub={tx("Pilot đang xem hôm nay bạn cần học gì.")} />
      ) : view.today.length === 0 ? (
        <div className="mt-5 flex flex-col items-center rounded-2xl border-2 border-dashed border-[var(--sp-line)] px-5 py-8 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]">
            <IconCheck size={22} />
          </span>
          <p className="mt-3 font-bold text-[var(--sp-ink)]">{tx("Hôm nay là ngày nghỉ")}</p>
          <p className="mt-1 text-sm text-[var(--sp-muted)]">{tx("Không có buổi học hay buổi ôn nào hẹn hôm nay.")}</p>
          <Link href={view.materialsHref} className="sp-btn sp-btn-secondary mt-4 px-4 py-2 text-sm">
            <IconBook size={15} />

            {tx("Mở tài liệu học tập")}
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
                  <p className="mt-0.5 text-[12px] text-[var(--sp-muted)]">{tx("phút")}</p>
                </div>
                <div className="min-w-0">
                  <span className={`sp-chip flex w-fit items-center gap-1 bg-white ${style.chip}`}>
                    <Icon size={13} />
                    {item.chip}
                  </span>
                  <p className="mt-1 line-clamp-2 text-[15px] font-bold leading-snug text-[var(--sp-ink)] sm:text-[16px]">{item.title}</p>
                  <p className={`mt-0.5 text-[13px] font-semibold ${style.note}`}>{item.note}</p>
                </div>
                {item.locked ? (
                  <span
                    aria-disabled
                    className="sp-btn col-span-2 h-[42px] w-full cursor-not-allowed border-2 border-dashed border-[var(--sp-lav-line)] bg-[var(--sp-surface-2)] text-sm text-[var(--sp-soft)] sm:col-span-1"
                  >
                    <IconLock size={14} />
                    {item.action}
                  </span>
                ) : (
                  <Link
                    href={item.href}
                    className={`sp-btn col-span-2 h-[42px] w-full text-sm sm:col-span-1 ${
                      item.done ? "sp-btn-secondary" : primary ? "sp-btn-primary !bg-[var(--sp-pink)]" : "sp-btn-secondary !text-[var(--sp-peri-dark)]"
                    }`}
                  >
                    {primary && !item.done && <IconPlay size={14} />}
                    {item.action}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Sắp tới */}
      {!loading && upcoming && (
        <div className="mt-3 grid grid-cols-[52px_minmax(0,1fr)] items-center gap-x-4 gap-y-2 rounded-[20px] border-2 border-[var(--sp-lav-line)] bg-[var(--sp-lav)] px-4 py-3 text-[14px] text-[var(--sp-text-2)] sm:grid-cols-[64px_minmax(0,1fr)_132px] sm:px-5">
          <p className="text-center text-[13px] font-extrabold leading-tight text-[var(--sp-pink-dark)]">
            {daysBetween(todayKey, upcoming.dateKey) === 1 ? "Mai" : WEEKDAY[new Date(`${upcoming.dateKey}T00:00:00Z`).getUTCDay()]}
            <br />
            {dayMonth(upcoming.dateKey)}
          </p>
          <p className="min-w-0">
            <b className="text-[var(--sp-ink)]">{tx("Sắp tới:")}</b>{" "}
            {upcoming.reviews.length > 0 && (
              <>

                {tx("ôn")} <b className="text-[var(--sp-ink)]">{upcoming.reviews.slice(0, 2).join(tx(" và "))}</b>
                {upcoming.reviews.length > 2 && tx(" và {0} bài khác", [upcoming.reviews.length - 2])}
              </>
            )}
            {upcoming.reviews.length > 0 && upcoming.lessons.length > 0 && "; "}
            {upcoming.lessons.length > 0 && (
              <>

                {tx("học")} <b className="text-[var(--sp-ink)]">{upcoming.lessons.slice(0, 2).join(tx(" và "))}</b>
              </>
            )}
          </p>
          {view.plan && (
            <Link href={`/study-plans/${view.plan.id}`} className="col-span-2 text-sm font-bold text-[var(--sp-peri-dark)] hover:underline sm:col-span-1 sm:text-right">

              {tx("Xem lịch ôn →")}
            </Link>
          )}
        </div>
      )}

      {/* Tuần này */}
      {view.plan && (
        <div className="mt-6 border-t-2 border-dashed border-[var(--sp-line)] pt-5">
          <div className="flex items-center justify-between gap-3">
            <p className="font-bold text-[var(--sp-ink)]">{tx("Tuần này")}</p>
            <p className="text-[13px] text-[var(--sp-muted)]">
              {tx("{0}/{1} buổi học xong · {2} buổi ôn", [learnDone, learnTotal, reviewTotal])}</p>
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
                    ? "border-2 border-[var(--sp-pink)] bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)] shadow-[2px_2px_0_var(--sp-pink-line)]"
                    : learnAllDone
                      ? "border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-peri)] text-white shadow-[2px_2px_0_var(--sp-purple-deep)]"
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
                    title={`${day.learn ? tx("{0}/{1} buổi học xong", [day.learnDone, day.learn]) : tx("Không có buổi học")}${day.reviews ? tx(" · {0} buổi ôn", [day.reviews]) : ""}`}
                  >
                    {empty ? (
                      tx("Nghỉ")
                    ) : (
                      <>
                        {day.learn > 0 &&
                          (learnAllDone ? (
                            <span className="flex items-center gap-1">
                              <IconCheck size={13} />

                              {tx("Học")}
                            </span>
                          ) : (
                            <span>
                              {tx("{0}/{1} học", [day.learnDone, day.learn])}</span>
                          ))}
                        {day.reviews > 0 && (
                          <span className="flex items-center gap-1">
                            <IconRepeat size={12} />

                            {tx("Ôn")} {day.reviews}
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

              {tx("Buổi học")}
            </span>
            <span className="flex items-center gap-1.5">
              <i className="h-2.5 w-2.5 rounded-[3px] bg-[var(--sp-pink-line)]" />

              {tx("Buổi ôn đã hẹn")}
            </span>
            <span className="flex items-center gap-1.5">
              <i className="h-2.5 w-2.5 rounded-[3px] bg-[var(--sp-red)]" />

              {tx("Hôm nay")}
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
          <p className="sp-accent text-[17px] text-[var(--sp-pink)]">{tx("Lưu ý điểm yếu")}</p>
          <h2 className="text-[22px] text-[var(--sp-ink)]">{tx("Cần ôn lại thêm")}</h2>
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
          {tx("Chưa có phần nào dưới {0}%. Giữ phong độ nhé!", [PASS_SCORE])}</p>
      ) : (
        <>
          <ul className="mt-4 space-y-3">
            {view.weak.map((item, index) => (
              <li
                key={item.key}
                className={`grid grid-cols-[56px_minmax(0,1fr)] items-center gap-3 rounded-[18px] border-2 px-4 py-3.5 ${
                  index === 0 ? "border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)]" : "border-[var(--sp-lav-line)] bg-white"
                }`}
              >
                <span className={`text-[23px] font-black ${item.percent < WEAK_BELOW ? "text-[var(--sp-red)]" : "text-[#c98a00]"}`}>{item.percent}%</span>
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
              ? tx("Xem chi tiết từng chương ở Đánh giá năng lực →")
              : view.weakTotal > view.weak.length
                ? tx("Xem cả {0} bài ở Đánh giá năng lực →", [view.weakTotal])
                : tx("Xem ở Đánh giá năng lực →")}
          </Link>
        </>
      )}
    </section>
  );
}

/* ================= Truy cập nhanh ================= */

function QuickLinks() {
  return (
    <section>
      <p className="sp-accent text-[17px] text-[var(--sp-pink)]">{tx("Đi nhanh tới")}</p>
      <h2 className="text-[22px] text-[var(--sp-ink)]">{tx("Truy cập nhanh")}</h2>
      <div className="mt-3 grid grid-cols-2 gap-3.5 md:grid-cols-4">
        {QUICK_LINKS.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{ "--q": item.shadow } as React.CSSProperties}
              className="group flex flex-col rounded-[20px] border-2 border-[var(--sp-purple-deep)] bg-white p-4 shadow-[4px_4px_0_var(--q)] transition duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_var(--q)]"
            >
              <span className={`flex h-11 w-11 items-center justify-center rounded-xl border-2 border-[var(--sp-purple-deep)] ${item.tone}`}>
                <Icon size={20} />
              </span>
              <span className="mt-3 text-[15px] font-bold leading-snug text-[var(--sp-ink)]">{item.title}</span>
              <span className="mt-1 flex-1 text-[13px] leading-5 text-[var(--sp-muted)]">{item.text}</span>
              <span className="mt-3 flex items-center gap-1 text-[13px] font-bold text-[var(--sp-peri-dark)]">

                {tx("Mở")}
                <IconArrowRight size={14} className="transition group-hover:translate-x-1" />
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/* ================= Góc đọc của Pilot ================= */

const PILOT_TIPS = [
  tx("Ôn lại trong vòng 24 giờ sau khi học giúp bạn nhớ lâu hơn nhiều so với học dồn trước ngày thi."),
  tx("Tự trả lời câu hỏi trước khi xem đáp án giúp nhớ chắc hơn đọc lại nhiều lần."),
  tx("Học 15–25 phút rồi nghỉ 5 phút, não sẽ đỡ mệt hơn."),
  tx("Câu sai là món quà: xem lời giải thích ngay sau khi làm bài."),
];

function PilotNook() {
  const [tip, setTip] = useState(0);
  return (
    <section className="relative hidden min-h-[300px] flex-1 rounded-[24px] border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-lav)] bg-[radial-gradient(#d5ddf8_1.2px,transparent_1.2px)] bg-[length:18px_18px] shadow-[6px_6px_0_var(--sp-yellow)] lg:block">
      <div className="absolute left-5 top-4">
        <p className="sp-accent text-[15px] text-[var(--sp-pink)]">{tx("Góc nhỏ")}</p>
        <p className="font-bold text-[var(--sp-ink)]">{tx("Góc đọc của Pilot")}</p>
        <p className="text-[12.5px] text-[var(--sp-muted)]">{tx("Chạm vào Pilot thử xem!")}</p>
      </div>
      <div className="absolute inset-x-5 top-[92px] rounded-2xl border-2 border-[var(--sp-purple-deep)] bg-white px-3.5 py-3 shadow-[3px_3px_0_var(--sp-pink-line)]">
        <p className="text-[13.5px] font-bold text-[var(--sp-ink)]">{tx("💡 Mẹo của Pilot")}</p>
        <p className="mt-1 text-[13px] leading-[1.45] text-[var(--sp-text-2)]">{PILOT_TIPS[tip]}</p>
        <button
          type="button"
          onClick={() => setTip((value) => (value + 1) % PILOT_TIPS.length)}
          className="mt-2 text-[12.5px] font-extrabold text-[var(--sp-peri-dark)] hover:underline"
        >

          {tx("Mẹo khác →")}
        </button>
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

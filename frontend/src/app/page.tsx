"use client";

import { useCallback, useEffect, useMemo, useState, type ComponentType, type SVGProps } from "react";
import Link from "next/link";
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
  IconFile,
  IconPen,
  IconPlay,
  IconPlus,
  IconRepeat,
  Sparkle,
} from "@/components/icons";

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
  is_unlocked?: boolean;
  time_limit_minutes?: number | null;
};

type QuizAttempt = {
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

function chapterCode(hierarchy?: string | null) {
  const match = String(hierarchy || "").match(/^\s*(?:chương|chapter|unit|phần|part)\s*([0-9]+|[ivxlc]+)/i);
  return match ? `C${match[1].toUpperCase()}` : "";
}

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
  { title: "Lập kế hoạch ôn thi", text: "Đặt ngày thi, AI chia lịch ôn", href: "/study-plans", icon: IconCalendar, tone: "bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]" },
  { title: "Tóm tắt nội dung", text: "Ý chính từng bài học", href: "/study-materials", icon: IconFile, tone: "bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]" },
  { title: "Kiểm tra kiến thức", text: "Có giải thích câu sai", href: "/quizzes", icon: IconPen, tone: "bg-[var(--sp-amber-bg)] text-[var(--sp-amber-dark)]" },
  { title: "Đánh giá năng lực", text: "Tiến độ và điểm yếu", href: "/weak-areas", icon: IconChart, tone: "bg-[#f1e6f7] text-[var(--sp-purple)]" },
];

/* ================= Trang ================= */

export default function Home() {
  const [data, setData] = useState<Dashboard>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  const todayMinutes = view.today.reduce((sum, item) => sum + (item.minutes || 0), 0);
  const hoursText =
    todayMinutes >= 60
      ? `${Math.round((todayMinutes / 60) * 10) / 10} giờ`.replace(".", ",")
      : `${todayMinutes} phút`;
  const lessonCount = view.today.filter((item) => item.kind === "lesson").length;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Lời chào */}
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="sp-accent text-[18px] text-[var(--sp-pink)]">{todayLabel}</p>
          <h1 className="mt-1 text-[40px] leading-tight sm:text-[52px]">
            Chào mừng trở lại,{" "}
            <span className="whitespace-nowrap">
              <span className="sp-squiggle">{CURRENT_USER.name}</span>
              <Sparkle size={24} className="sp-twinkle ml-2 inline-block align-top text-[var(--sp-yellow)]" />
            </span>
          </h1>
          <p className="mt-2 text-[15px] text-[var(--sp-muted)]">
            {loading
              ? "Đang tải lịch học của bạn..."
              : lessonCount > 0
                ? `Hôm nay bạn có ${lessonCount} buổi học, tổng ${hoursText}.`
                : view.plan
                  ? "Hôm nay không có buổi học mới. Tranh thủ ôn lại phần còn yếu nhé."
                  : "Tạo kế hoạch ôn thi đầu tiên để AI xếp lịch học cho bạn."}
          </p>
        </div>
        <Link href="/study-plans#create-plan" className="sp-btn sp-btn-primary w-fit shrink-0 whitespace-nowrap px-5 py-3 text-[15px]">
          <IconPlus size={17} />
          Tạo kế hoạch mới
        </Link>
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
          <PlanHero view={view} todayKey={todayKey} loading={loading} />
          <TodayCard view={view} todayKey={todayKey} hoursText={hoursText} loading={loading} />
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
        </div>
      </div>
    </div>
  );
}

/* ================= Gom dữ liệu ================= */

type TodayItem = {
  key: string;
  kind: "lesson" | "retake";
  title: string;
  minutes: number;
  done: boolean;
  href: string;
  chip: string;
};

type WeakItem = {
  sessionId: string;
  percent: number;
  title: string;
  code: string;
  note: string;
  href: string;
  linkLabel: string;
};

type WeekDay = { key: string; label: string; total: number; done: number };

function buildView(data: Dashboard, todayKey: string) {
  const topicById = new Map(data.topics.map((topic) => [topic.id, topic]));
  const subjectName = (plan?: ExamPlan) =>
    data.subjects.find((subject) => subject.id === plan?.subject_id)?.name || plan?.title || "Kế hoạch ôn thi";

  // Kế hoạch đang chạy: ngày thi gần nhất chưa qua
  const upcoming = data.plans
    .filter((plan) => !plan.exam_date || plan.exam_date.slice(0, 10) >= todayKey)
    .sort((a, b) => String(a.exam_date || "9999").localeCompare(String(b.exam_date || "9999")));
  const plan = upcoming[0] || data.plans[0];
  const planTopics = plan ? data.topics.filter((topic) => topic.exam_plan_id === plan.id) : [];
  const planTopicIds = new Set(planTopics.map((topic) => topic.id));
  const planSessions = data.sessions.filter((session) => planTopicIds.has(String(session.topic_id)));
  const completedSessions = planSessions.filter((session) => session.status === "completed").length;
  const learnedTopics = planTopics.filter((topic) => {
    const list = planSessions.filter((session) => session.topic_id === topic.id);
    return list.length > 0 && list.every((session) => session.status === "completed");
  }).length;
  const materialsHref = (sessionId?: string | null) =>
    plan?.subject_id
      ? `/study-materials?subject=${encodeURIComponent(plan.subject_id)}${sessionId ? `&session=${encodeURIComponent(sessionId)}` : ""}`
      : "/study-materials";

  // Điểm mới nhất của từng buổi học (bài gốc hoặc kiểm tra lại)
  const quizById = new Map(data.quizzes.map((quiz) => [quiz.id, quiz]));
  const latestBySession = new Map<string, { percent: number; at: string }>();
  for (const attempt of data.attempts) {
    const quiz = quizById.get(attempt.quiz_id);
    const sessionId = quiz?.study_session_id;
    if (!sessionId) continue;
    const percent = attempt.total_questions
      ? Math.round((attempt.correct_count / attempt.total_questions) * 100)
      : Math.round(Number(attempt.score || 0));
    const at = attempt.submitted_at || "";
    const current = latestBySession.get(sessionId);
    if (!current || at > current.at) latestBySession.set(sessionId, { percent, at });
  }

  const sessionById = new Map(data.sessions.map((session) => [session.id, session]));
  const weak: WeakItem[] = [];
  for (const [sessionId, latest] of latestBySession) {
    if (latest.percent >= 80) continue;
    const session = sessionById.get(sessionId);
    const topic = topicById.get(String(session?.topic_id));
    if (plan && topic?.exam_plan_id && topic.exam_plan_id !== plan.id) continue;
    const retake = data.quizzes.find(
      (quiz) => quiz.is_retake && quiz.study_session_id === sessionId && quiz.review_status !== "completed"
    );
    const open = Boolean(retake?.is_unlocked);
    weak.push({
      sessionId,
      percent: latest.percent,
      title: getMainTopicTitle(topic?.name || retake?.topic_name || "Bài học"),
      code: chapterCode(topic?.hierarchy),
      note: open ? "Bài kiểm tra lại đã mở" : "Ôn lại để mở bài kiểm tra lại",
      href: open && retake ? `/quizzes/${retake.id}` : materialsHref(sessionId),
      linkLabel: open ? "Làm lại" : "Ôn ngay",
    });
  }
  weak.sort((a, b) => a.percent - b.percent);

  // Hôm nay
  const today: TodayItem[] = [];
  for (const item of weak) {
    const retake = data.quizzes.find(
      (quiz) => quiz.is_retake && quiz.study_session_id === item.sessionId && quiz.is_unlocked && quiz.review_status !== "completed"
    );
    if (retake) {
      today.push({
        key: `retake-${retake.id}`,
        kind: "retake",
        title: `${item.code ? `${item.code} · ` : ""}${item.title}`,
        minutes: Number(retake.time_limit_minutes || 15),
        done: false,
        href: `/quizzes/${retake.id}`,
        chip: "Kiểm tra lại",
      });
    }
  }
  for (const session of planSessions) {
    if (!session.scheduled_start || toKey(session.scheduled_start) !== todayKey) continue;
    const topic = topicById.get(String(session.topic_id));
    const code = chapterCode(topic?.hierarchy);
    today.push({
      key: session.id,
      kind: "lesson",
      title: `${code ? `${code} · ` : ""}${getMainTopicTitle(topic?.name || "Buổi học")}`,
      minutes: Number(session.duration_minutes || 0),
      done: session.status === "completed",
      href: materialsHref(session.id),
      chip: session.status === "completed" ? "Đã học" : "Học mới",
    });
  }

  // Tuần này (Thứ 2 → Chủ nhật)
  const weekday = new Date(`${todayKey}T00:00:00Z`).getUTCDay();
  const monday = addDays(todayKey, -((weekday + 6) % 7));
  const week: WeekDay[] = Array.from({ length: 7 }, (_, index) => {
    const key = addDays(monday, index);
    const list = planSessions.filter((session) => session.scheduled_start && toKey(session.scheduled_start) === key);
    return {
      key,
      label: index === 6 ? "CN" : `T${index + 2}`,
      total: list.length,
      done: list.filter((session) => session.status === "completed").length,
    };
  });

  return {
    plan,
    planName: subjectName(plan),
    otherPlans: Math.max(0, upcoming.length - 1),
    totalSessions: planSessions.length || Number(plan?.total_sessions || 0),
    completedSessions,
    learnedTopics,
    topicCount: planTopics.length,
    weak: weak.slice(0, 3),
    today,
    week,
    materialsHref: materialsHref(),
  };
}

type View = ReturnType<typeof buildView>;

/* ================= Thẻ kế hoạch đang chạy ================= */

function PlanHero({ view, todayKey, loading }: { view: View; todayKey: string; loading: boolean }) {
  const { plan } = view;
  const percent = view.totalSessions ? Math.round((view.completedSessions / view.totalSessions) * 100) : 0;
  const examKey = plan?.exam_date?.slice(0, 10);
  const daysLeft = examKey ? Math.max(0, daysBetween(todayKey, examKey)) : null;

  return (
    <section className="relative overflow-hidden rounded-[28px] border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-purple)] p-6 text-white shadow-[6px_6px_0_var(--sp-pink)] sm:p-8">
      <Sparkle size={30} className="sp-twinkle absolute right-8 top-6 text-[var(--sp-pink)]" />
      <Sparkle size={16} className="sp-twinkle absolute right-20 top-16 text-[var(--sp-yellow)]" />

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
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center">
          {/* Vòng tiến độ */}
          <div className="relative h-[150px] w-[150px] shrink-0 self-center">
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

            <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
              <div>
                <dt className="text-[13px] text-white/70">Ngày thi</dt>
                <dd className="text-[20px] font-extrabold">{examKey ? formatDay(examKey) : "—"}</dd>
              </div>
              <div>
                <dt className="text-[13px] text-white/70">Còn lại</dt>
                <dd className="text-[20px] font-extrabold">{daysLeft === null ? "—" : `${daysLeft} ngày`}</dd>
              </div>
              <div>
                <dt className="text-[13px] text-white/70">Chủ đề</dt>
                <dd className="text-[20px] font-extrabold">
                  {view.learnedTopics}/{view.topicCount} đã học
                </dd>
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
        </div>
      )}
    </section>
  );
}

/* ================= Hôm nay học gì ================= */

function TodayCard({
  view,
  todayKey,
  hoursText,
  loading,
}: {
  view: View;
  todayKey: string;
  hoursText: string;
  loading: boolean;
}) {
  const firstOpen = view.today.findIndex((item) => !item.done);
  const weekDone = view.week.reduce((sum, day) => sum + day.done, 0);
  const weekTotal = view.week.reduce((sum, day) => sum + day.total, 0);

  return (
    <section className="sp-card p-5 sm:p-7">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="sp-accent text-[17px] text-[var(--sp-pink)]">
            {view.today.length > 0 ? `${view.today.length} việc · tổng ${hoursText}` : "Lịch hôm nay"}
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
          <p className="mt-1 text-sm text-[var(--sp-muted)]">Bạn có thể ôn lại bài cũ hoặc lật vài flashcard.</p>
          <Link href={view.materialsHref} className="sp-btn sp-btn-secondary mt-4 px-4 py-2 text-sm">
            <IconBook size={15} />
            Mở tài liệu học tập
          </Link>
        </div>
      ) : (
        <ul className="mt-5 space-y-3">
          {view.today.map((item, index) => {
            const highlight = index === firstOpen;
            return (
              <li
                key={item.key}
                className={`flex items-center gap-4 rounded-2xl border-2 px-4 py-3.5 transition sm:px-5 ${
                  highlight
                    ? "border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)]"
                    : "border-[var(--sp-line)] bg-white"
                }`}
              >
                <div className="w-12 shrink-0 border-r-2 border-dashed border-[var(--sp-line)] pr-3 text-center">
                  <p className="text-[24px] font-black leading-none text-[var(--sp-purple)]">{item.minutes || "–"}</p>
                  <p className="mt-0.5 text-[12px] text-[var(--sp-muted)]">phút</p>
                </div>
                <div className="min-w-0 flex-1">
                  <span
                    className={`sp-chip flex w-fit items-center gap-1 ${
                      item.kind === "retake"
                        ? "bg-white text-[var(--sp-pink-dark)]"
                        : item.done
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]"
                    }`}
                  >
                    {item.kind === "retake" ? <IconRepeat size={13} /> : item.done ? <IconCheck size={13} /> : <IconBook size={13} />}
                    {item.chip}
                  </span>
                  <p className="mt-1 line-clamp-2 text-[15px] font-bold leading-snug text-[var(--sp-ink)] sm:text-[16px]">{item.title}</p>
                </div>
                <Link
                  href={item.href}
                  className={`sp-btn shrink-0 px-3 py-2 text-sm sm:px-4 ${highlight ? "sp-btn-primary" : "sp-btn-secondary"}`}
                >
                  {item.done ? (
                    "Xem lại"
                  ) : (
                    <>
                      {highlight && <IconPlay size={14} className="hidden sm:block" />}
                      {item.kind === "retake" ? "Làm bài" : "Bắt đầu"}
                    </>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {/* Tuần này */}
      {view.plan && (
        <div className="mt-6 border-t-2 border-dashed border-[var(--sp-line)] pt-5">
          <div className="flex items-center justify-between">
            <p className="font-bold text-[var(--sp-ink)]">Tuần này</p>
            <p className="text-[13px] text-[var(--sp-muted)]">
              {weekDone}/{weekTotal} buổi xong
            </p>
          </div>
          <div className="mt-3 grid grid-cols-7 gap-1.5 sm:gap-2">
            {view.week.map((day) => {
              const isToday = day.key === todayKey;
              const isPast = day.key < todayKey;
              const allDone = day.total > 0 && day.done === day.total;
              return (
                <div key={day.key} className="text-center">
                  <p className={`text-[13px] font-semibold ${isToday ? "text-[var(--sp-purple)]" : "text-[var(--sp-muted)]"}`}>{day.label}</p>
                  <div
                    className={`mt-1.5 flex h-11 items-center justify-center rounded-xl text-[13px] font-bold ${
                      day.total === 0
                        ? "bg-[repeating-linear-gradient(135deg,var(--sp-surface-2)_0_6px,#f1edf4_6px_12px)] text-[var(--sp-soft)]"
                        : allDone
                          ? "bg-[var(--sp-peri)] text-white"
                          : isToday
                            ? "border-2 border-[var(--sp-purple)] bg-white text-[var(--sp-purple)] shadow-[2px_2px_0_var(--sp-purple-deep)]"
                            : isPast
                              ? "border-2 border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]"
                              : "bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]"
                    }`}
                    title={day.total ? `${day.done}/${day.total} buổi xong` : "Không có buổi học"}
                  >
                    {day.total === 0 ? "Nghỉ" : allDone ? <IconCheck size={17} /> : isToday || isPast ? `${day.done}/${day.total}` : (
                          <span>
                            {day.total}
                            <span className="hidden sm:inline"> buổi</span>
                          </span>
                        )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

/* ================= Lưu ý điểm yếu ================= */

function WeakCard({ view, loading }: { view: View; loading: boolean }) {
  return (
    <section className="rounded-[24px] border-2 border-[var(--sp-purple-deep)] bg-white p-5 shadow-[5px_5px_0_var(--sp-pink)] sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="sp-accent text-[17px] text-[var(--sp-pink)]">Lưu ý điểm yếu</p>
          <h2 className="text-[22px] text-[var(--sp-ink)]">Cần ôn lại thêm</h2>
        </div>
        <IconAlert size={20} className="mt-1 text-[var(--sp-ink)]" />
      </div>

      {loading ? (
        <div className="mt-4 h-[84px] animate-pulse rounded-2xl bg-[var(--sp-surface-2)]" />
      ) : view.weak.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-4 text-sm font-semibold text-emerald-800">
          Chưa có phần nào dưới 80%. Giữ phong độ nhé!
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {view.weak.map((item, index) => (
            <li key={item.sessionId}>
              <Link
                href={item.href}
                className={`group flex items-center gap-4 rounded-2xl border-2 px-4 py-3.5 transition ${
                  index === 0
                    ? "border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)] hover:border-[var(--sp-pink)]"
                    : "border-[var(--sp-line)] bg-white hover:border-[var(--sp-lav-line)]"
                }`}
              >
                <span
                  className={`w-[52px] shrink-0 text-[22px] font-black ${
                    item.percent < 50 ? "text-[var(--sp-pink-dark)]" : "text-[#c98a00]"
                  }`}
                >
                  {item.percent}%
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 block text-[15px] font-bold leading-snug text-[var(--sp-ink)]">
                    {item.code ? `${item.code} · ` : ""}
                    {item.title}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-[12px] leading-4 text-[var(--sp-muted)]">{item.note}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-[13px] font-bold text-[var(--sp-peri-dark)]">
                  {item.linkLabel}
                  <IconArrowRight size={14} className="transition group-hover:translate-x-0.5" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

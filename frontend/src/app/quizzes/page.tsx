"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getMainTopicTitle } from "@/lib/content-titles";
import {
  IconArrowLeft,
  IconArrowRight,
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconClock,
  IconLock,
  IconPen,
  IconRepeat,
  Sparkle,
} from "@/components/icons";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

interface Quiz {
  id: string;
  title: string;
  description: string | null;
  time_limit_minutes: number | null;
  created_at: string;
  exam_plan_id: string | null;
  subject_name?: string | null;
  plan_title?: string | null;
  is_retake?: boolean;
  review_plan_id?: string | null;
  review_status?: string | null;
  review_study_seconds?: number;
  study_session_id?: string | null;
  study_day?: number | null;
  study_week?: number | null;
  study_day_in_week?: number | null;
  scheduled_start?: string | null;
  topic_name?: string | null;
  session_status?: string | null;
  actual_study_seconds?: number;
  is_unlocked?: boolean;
  lock_reason?: string | null;
}

interface QuizAttempt {
  attempt_id: string;
  quiz_id: string;
  quiz_title: string;
  score: number;
  correct_count: number;
  total_questions: number;
  total_points: number;
  started_at: string;
  submitted_at: string;
  status: string;
}

type SubjectGroup = {
  planId: string;
  name: string;
  planTitle: string;
  quizzes: Quiz[];
  attempts: QuizAttempt[];
  unlocked: number;
  doneQuizIds: Set<string>;
  pending: Quiz[];
  average: number | null;
};

const PALETTE = [
  "bg-[var(--sp-purple)] text-white",
  "bg-[var(--sp-pink)] text-white",
  "bg-[var(--sp-peri)] text-white",
  "bg-[var(--sp-yellow)] text-[var(--sp-purple-deep)]",
];

/* ================= Tiện ích ================= */

function formatDate(value?: string | null) {
  if (!value) return "Chưa xác định";
  return new Date(value).toLocaleDateString("vi-VN");
}

function formatDuration(seconds = 0, requiredSeconds = 300) {
  const remaining = Math.max(0, requiredSeconds - seconds);
  const minutes = Math.ceil(remaining / 60);
  return minutes > 0 ? `${minutes} phút` : "Đã đủ thời gian học";
}

// Chỉ cho phép bắt đầu Quiz khi backend xác nhận đã mở khóa
function canStartQuiz(quiz: Quiz) {
  return quiz.is_unlocked === true;
}

// Hiển thị lý do khóa do backend trả về
function getLockMessage(quiz: Quiz) {
  if (quiz.lock_reason) return quiz.lock_reason;

  if (quiz.is_retake) {
    if (quiz.review_status === "completed") return "Đã hoàn thành bài kiểm tra lại";
    return `Cần ôn lại tài liệu thêm ${formatDuration(quiz.review_study_seconds, 900)}`;
  }

  if (quiz.session_status !== "completed") return "Cần hoàn thành buổi học trước";

  return "Quiz đã sẵn sàng để làm.";
}

function getAttemptPercent(attempt: QuizAttempt) {
  if (attempt.total_questions > 0) {
    return Math.round((attempt.correct_count / attempt.total_questions) * 100);
  }
  return Math.round(Number(attempt.score || 0));
}

function scoreStyle(percent: number) {
  if (percent >= 80) return { text: "text-emerald-700", bar: "bg-emerald-500" };
  if (percent >= 50) return { text: "text-[var(--sp-amber-dark)]", bar: "bg-[#E6A23C]" };
  return { text: "text-[var(--sp-pink-dark)]", bar: "bg-[var(--sp-pink)]" };
}

function initials(name: string) {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.slice(0, 2).map((word) => word[0]) : [name.slice(0, 2)])
    .join("")
    .toUpperCase();
}

function quizTitle(quiz: Quiz) {
  // Bài kiểm tra lại mới có sẵn tên "Kiểm tra lại ngày N: ..."
  if (quiz.is_retake && /^kiểm tra lại/i.test(quiz.title || "")) {
    return quiz.title.replace(/^Kiểm tra lại ngày (\d+)/i, "Kiểm tra lại ngày học $1");
  }
  const title = getMainTopicTitle(quiz.topic_name || quiz.title);
  return quiz.is_retake ? `Kiểm tra lại: ${title}` : title;
}

/* ================= Trang ================= */

export default function QuizzesPage() {
  return (
    <Suspense
      fallback={
        <div className="sp-card mx-auto max-w-6xl p-10 text-center text-[var(--sp-muted)]">
          Đang tải bài kiểm tra...
        </div>
      }
    >
      <QuizzesContent />
    </Suspense>
  );
}

function QuizzesContent() {
  const searchParams = useSearchParams();
  const planParam = searchParams.get("plan");

  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [attempts, setAttempts] = useState<QuizAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`${API_URL}/api/quizzes`);
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.detail || "Không thể tải danh sách bài kiểm tra.");
        }
        setQuizzes(result.data || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Đã xảy ra lỗi khi tải bài kiểm tra.");
      }

      try {
        const response = await fetch(`${API_URL}/api/quiz-attempts`);
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.detail || "Không thể tải lịch sử làm bài.");
        }
        setAttempts(result.data || []);
      } catch (err) {
        setHistoryError(err instanceof Error ? err.message : "Đã xảy ra lỗi khi tải lịch sử.");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  /* Gom bài kiểm tra theo môn (kế hoạch) */
  const subjects = useMemo<SubjectGroup[]>(() => {
    const groups = new Map<string, Quiz[]>();
    for (const quiz of quizzes) {
      const key = quiz.exam_plan_id || "unassigned";
      groups.set(key, [...(groups.get(key) || []), quiz]);
    }

    return Array.from(groups.entries()).map(([planId, planQuizzes]) => {
      const ids = new Set(planQuizzes.map((quiz) => quiz.id));
      const planAttempts = attempts.filter((attempt) => ids.has(attempt.quiz_id));
      const doneQuizIds = new Set(planAttempts.map((attempt) => attempt.quiz_id));
      const percents = planAttempts.map(getAttemptPercent);
      const pending = planQuizzes
        .filter((quiz) => canStartQuiz(quiz) && (quiz.is_retake || !doneQuizIds.has(quiz.id)))
        .sort(
          (a, b) =>
            new Date(a.scheduled_start || a.created_at).getTime() -
            new Date(b.scheduled_start || b.created_at).getTime()
        );

      return {
        planId,
        name:
          planQuizzes[0]?.subject_name ||
          planQuizzes[0]?.plan_title ||
          (planId === "unassigned" ? "Chưa liên kết môn học" : "Môn học"),
        planTitle: planQuizzes[0]?.plan_title || "Kế hoạch ôn tập",
        quizzes: planQuizzes,
        attempts: planAttempts,
        unlocked: planQuizzes.filter(canStartQuiz).length,
        doneQuizIds,
        pending,
        average: percents.length
          ? Math.round(percents.reduce((sum, value) => sum + value, 0) / percents.length)
          : null,
      };
    });
  }, [quizzes, attempts]);

  const subject = planParam ? subjects.find((item) => item.planId === planParam) : undefined;

  if (loading) {
    return (
      <div className="sp-card mx-auto max-w-6xl p-10 text-center text-[var(--sp-muted)]">
        <Sparkle size={22} className="sp-twinkle mx-auto mb-3 text-[var(--sp-pink)]" />
        Đang tải bài kiểm tra...
      </div>
    );
  }

  if (error) {
    return (
      <div className="sp-card mx-auto max-w-3xl p-6 text-sm text-[var(--sp-pink-dark)]">{error}</div>
    );
  }

  if (planParam && subject) {
    return (
      <SubjectQuizzes
        subject={subject}
        colorIndex={subjects.indexOf(subject)}
        historyError={historyError}
      />
    );
  }

  return <SubjectPicker subjects={subjects} attemptsCount={attempts.length} missingPlan={Boolean(planParam)} />;
}

/* ================= Màn hình 1: chọn môn ================= */

function SubjectPicker({
  subjects,
  attemptsCount,
  missingPlan,
}: {
  subjects: SubjectGroup[];
  attemptsCount: number;
  missingPlan: boolean;
}) {
  const totalPending = subjects.reduce((sum, item) => sum + item.pending.length, 0);
  const totalQuizzes = subjects.reduce((sum, item) => sum + item.quizzes.length, 0);

  return (
    <div className="mx-auto max-w-6xl space-y-7">
      <section>
        <p className="text-sm font-medium text-[var(--sp-muted)]">KIỂM TRA KIẾN THỨC</p>
        <h1 className="mt-2 flex items-end gap-3 text-[44px] sm:text-[52px]">
          <span>
            Chọn môn để <span className="sp-squiggle">kiểm tra</span>
          </span>
          <Sparkle size={24} className="sp-twinkle mb-3 text-[var(--sp-yellow)]" />
        </h1>
        <p className="mt-2 text-[15px] text-[var(--sp-muted)]">
          {totalQuizzes > 0
            ? `${subjects.length} môn · ${totalQuizzes} bài kiểm tra · ${attemptsCount} lượt đã làm${
                totalPending > 0 ? ` · ${totalPending} bài đang chờ bạn` : ""
              }`
            : "Hoàn thành buổi học để mở khóa bài kiểm tra."}
        </p>
      </section>

      {missingPlan && (
        <p className="rounded-2xl bg-[var(--sp-amber-bg)] px-4 py-3 text-sm font-medium text-[var(--sp-amber-dark)]">
          Không tìm thấy bài kiểm tra của môn này. Hãy chọn một môn bên dưới.
        </p>
      )}

      {subjects.length === 0 ? (
        <div className="sp-card flex flex-col items-center px-6 py-12 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]">
            <IconPen size={26} />
          </span>
          <h3 className="mt-4 font-bold text-[var(--sp-ink)]">Chưa có bài kiểm tra nào</h3>
          <p className="mt-1 text-sm text-[var(--sp-muted)]">
            Tạo kế hoạch ôn thi và hoàn thành buổi học đầu tiên để có bài kiểm tra.
          </p>
          <Link href="/study-plans" className="sp-btn sp-btn-primary mt-5 px-5 py-2.5 text-sm">
            Đến kế hoạch ôn thi
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {subjects.map((item, index) => {
            const next = item.pending[0];
            const doneCount = item.doneQuizIds.size;
            const percent = item.quizzes.length
              ? Math.round((doneCount / item.quizzes.length) * 100)
              : 0;

            return (
              <article
                key={item.planId}
                className="group flex flex-col rounded-[22px] border-2 border-[var(--sp-line)] bg-white p-5 transition duration-200 hover:-translate-y-1 hover:border-[var(--sp-purple)] hover:shadow-[6px_6px_0_var(--sp-lav-line)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={`flex h-12 w-12 items-center justify-center rounded-2xl text-base font-extrabold ${
                      PALETTE[index % PALETTE.length]
                    }`}
                  >
                    {initials(item.name)}
                  </span>
                  {item.pending.length > 0 ? (
                    <span className="sp-chip bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]">
                      {item.pending.length} bài đang chờ
                    </span>
                  ) : (
                    <span className="sp-chip bg-[var(--sp-surface-2)] text-[var(--sp-muted)]">
                      Không có bài mới
                    </span>
                  )}
                </div>

                <h2 className="mt-3 line-clamp-2 text-[19px] leading-snug text-[var(--sp-ink)]">
                  {item.name}
                </h2>
                <p className="mt-0.5 truncate text-[13px] text-[var(--sp-muted)]">{item.planTitle}</p>

                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <MiniStat value={item.quizzes.length} label="bài" />
                  <MiniStat value={`${doneCount}/${item.quizzes.length}`} label="đã làm" />
                  <MiniStat
                    value={item.average === null ? "–" : `${item.average}%`}
                    label="điểm TB"
                    tone={item.average === null ? undefined : scoreStyle(item.average).text}
                  />
                </div>

                <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--sp-surface-2)]">
                  <div
                    className="h-full rounded-full bg-[var(--sp-peri)] transition-all duration-700"
                    style={{ width: `${percent}%` }}
                  />
                </div>

                <div className="mt-4 flex-1 rounded-2xl bg-[var(--sp-surface-2)] px-4 py-3 text-sm">
                  {next ? (
                    <>
                      <p className="text-xs font-bold uppercase tracking-wide text-[var(--sp-muted)]">
                        Bài nên làm tiếp
                      </p>
                      <p className="mt-1 line-clamp-2 font-semibold text-[var(--sp-ink)]">
                        {quizTitle(next)}
                      </p>
                    </>
                  ) : (
                    <p className="flex items-center gap-2 font-semibold text-[var(--sp-muted)]">
                      <IconLock size={15} />
                      {item.unlocked > 0
                        ? "Đã làm hết các bài đang mở"
                        : "Học xong buổi tiếp theo để mở bài mới"}
                    </p>
                  )}
                </div>

                <Link
                  href={`/quizzes?plan=${encodeURIComponent(item.planId)}`}
                  className="sp-btn sp-btn-primary mt-4 w-full justify-center py-2.5 text-sm"
                >
                  Làm kiểm tra
                  <IconArrowRight size={16} className="transition group-hover:translate-x-1" />
                </Link>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MiniStat({
  value,
  label,
  tone,
}: {
  value: React.ReactNode;
  label: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--sp-line)] px-2 py-2">
      <p className={`font-extrabold ${tone || "text-[var(--sp-ink)]"}`}>{value}</p>
      <p className="text-[11px] text-[var(--sp-muted)]">{label}</p>
    </div>
  );
}

/* ================= Màn hình 2: bài kiểm tra của một môn ================= */

function SubjectQuizzes({
  subject,
  colorIndex,
  historyError,
}: {
  subject: SubjectGroup;
  colorIndex: number;
  historyError: string;
}) {
  const [filter, setFilter] = useState<"all" | "open" | "done">("all");
  /* Mặc định thu gọn tất cả tuần; bấm vào tuần để mở */
  const [collapsedWeeks, setCollapsedWeeks] = useState<Record<string, boolean>>({});
  /* Nhóm "Kiểm tra lại" trong mỗi tuần mặc định thu gọn */
  const [openRetakes, setOpenRetakes] = useState<Record<string, boolean>>({});

  const latestByQuiz = new Map<string, QuizAttempt>();
  for (const attempt of [...subject.attempts].sort(
    (a, b) => new Date(a.submitted_at || 0).getTime() - new Date(b.submitted_at || 0).getTime()
  )) {
    latestByQuiz.set(attempt.quiz_id, attempt);
  }

  const visible = subject.quizzes.filter((quiz) => {
    if (filter === "open") return subject.pending.includes(quiz);
    if (filter === "done") return subject.doneQuizIds.has(quiz.id);
    return true;
  });

  /* Gom theo tuần → ngày học */
  const weeks = new Map<string, Map<string, Quiz[]>>();
  for (const quiz of visible) {
    const week = String(quiz.study_week ?? "unknown");
    const day = String(quiz.study_day ?? quiz.study_day_in_week ?? "unknown");
    const days = weeks.get(week) || new Map<string, Quiz[]>();
    days.set(day, [...(days.get(day) || []), quiz]);
    weeks.set(week, days);
  }
  const byNumber = ([a]: [string, unknown], [b]: [string, unknown]) => {
    const numberA = Number(a);
    const numberB = Number(b);
    if (Number.isNaN(numberA)) return 1;
    if (Number.isNaN(numberB)) return -1;
    return numberA - numberB;
  };
  const sortedWeeks = Array.from(weeks.entries()).sort(byNumber);

  const quizById = new Map(subject.quizzes.map((quiz) => [quiz.id, quiz]));
  const history = [...subject.attempts].sort(
    (a, b) => new Date(b.submitted_at || 0).getTime() - new Date(a.submitted_at || 0).getTime()
  );
  const filters = [
    ["all", `Tất cả (${subject.quizzes.length})`],
    ["open", `Đang chờ làm (${subject.pending.length})`],
    ["done", `Đã làm (${subject.doneQuizIds.size})`],
  ] as const;

  return (
    <div className="mx-auto max-w-6xl space-y-7">
      <section>
        <nav className="mb-3 flex items-center gap-1.5 text-sm font-medium text-[var(--sp-muted)]">
          <Link href="/quizzes" className="hover:text-[var(--sp-peri-dark)]">
            Kiểm tra kiến thức
          </Link>
          <IconChevronRight size={14} />
          <span className="truncate text-[var(--sp-text-2)]">{subject.name}</span>
        </nav>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-center gap-4">
            <span
              className={`hidden h-16 w-16 shrink-0 items-center justify-center rounded-[20px] text-xl font-extrabold sm:flex ${
                PALETTE[colorIndex % PALETTE.length]
              }`}
            >
              {initials(subject.name)}
            </span>
            <div className="min-w-0">
              <h1 className="text-[40px] leading-tight sm:text-[48px]">{subject.name}</h1>
              <p className="mt-1 text-[15px] text-[var(--sp-muted)]">{subject.planTitle}</p>
            </div>
          </div>
          <Link href="/quizzes" className="sp-btn sp-btn-secondary w-fit px-4 py-2.5 text-sm">
            <IconArrowLeft size={16} />
            Đổi môn
          </Link>
        </div>
      </section>

      {/* Tổng quan môn */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <OverviewStat label="Bài kiểm tra" value={subject.quizzes.length} />
        <OverviewStat label="Đang chờ làm" value={subject.pending.length} accent="text-[var(--sp-pink-dark)]" />
        <OverviewStat label="Đã làm" value={`${subject.doneQuizIds.size}/${subject.quizzes.length}`} />
        <OverviewStat
          label="Điểm trung bình"
          value={subject.average === null ? "–" : `${subject.average}%`}
          accent={subject.average === null ? undefined : scoreStyle(subject.average).text}
        />
      </section>

      {/* Danh sách bài */}
      <section className="sp-card p-5 sm:p-7">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="sp-accent text-[17px] text-[var(--sp-pink)]">Sắp xếp theo tuần và ngày học</p>
            <h2 className="text-[22px] text-[var(--sp-ink)]">Bài kiểm tra của môn</h2>
          </div>
          <div className="flex flex-wrap rounded-xl bg-[var(--sp-surface-2)] p-1">
            {filters.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={`rounded-lg px-3.5 py-1.5 text-sm font-bold transition ${
                  filter === value
                    ? "bg-white text-[var(--sp-peri-dark)] shadow-sm"
                    : "text-[var(--sp-muted)] hover:text-[var(--sp-ink)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {sortedWeeks.length === 0 ? (
          <p className="rounded-2xl bg-[var(--sp-surface-2)] p-6 text-center text-sm text-[var(--sp-muted)]">
            {filter === "open"
              ? "Không có bài nào đang chờ. Học tiếp buổi sau để mở bài mới."
              : "Chưa có bài nào trong mục này."}
          </p>
        ) : (
          <div className="space-y-4">
            {sortedWeeks.map(([week, days]) => {
              const count = Array.from(days.values()).reduce((sum, list) => sum + list.length, 0);
              const collapsed = collapsedWeeks[week] ?? true;
              const weekQuizzes = Array.from(days.values()).flat();
              const mainCount = weekQuizzes.filter((quiz) => !quiz.is_retake).length;
              const retakeCount = weekQuizzes.length - mainCount;
              return (
                <div key={week} className="overflow-hidden rounded-2xl border border-[var(--sp-line)]">
                  <button
                    type="button"
                    aria-expanded={!collapsed}
                    onClick={() => setCollapsedWeeks((state) => ({ ...state, [week]: !collapsed }))}
                    className="flex w-full items-center justify-between bg-[var(--sp-surface-2)] px-5 py-3.5 text-left"
                  >
                    <span className="font-bold text-[var(--sp-ink)]">
                      {week === "unknown" ? "Chưa phân tuần" : `Tuần ${week}`}
                    </span>
                    <span className="flex items-center gap-2 text-sm text-[var(--sp-muted)]">
                      <span className="hidden sm:inline">
                        {mainCount} bài kiểm tra
                        {retakeCount > 0 && (
                          <span className="text-[var(--sp-pink-dark)]"> · {retakeCount} kiểm tra lại</span>
                        )}
                      </span>
                      <span className="sm:hidden">{count} bài</span>
                      <IconChevronDown size={16} className={`transition ${collapsed ? "-rotate-90" : ""}`} />
                    </span>
                  </button>

                  {!collapsed && (() => {
                    const ordered = Array.from(days.entries())
                      .sort(byNumber)
                      .flatMap(([day, dayQuizzes]) =>
                        dayQuizzes.map((quiz) => ({
                          quiz,
                          dayLabel: day === "unknown" ? "" : `Ngày học ${day}`,
                        }))
                      );
                    const groups = [
                      {
                        key: "main",
                        title: "Kiểm tra kiến thức",
                        hint: "Mỗi bài chỉ làm 1 lần",
                        items: ordered.filter((item) => !item.quiz.is_retake),
                      },
                      {
                        key: "retake",
                        title: "Kiểm tra lại",
                        hint: "Mở sau khi ôn và trả lời Tự kiểm tra nhanh",
                        items: ordered.filter((item) => item.quiz.is_retake),
                      },
                    ].filter((group) => group.items.length > 0);

                    return (
                      <div className="divide-y-2 divide-[var(--sp-line)]">
                        {groups.map((group) => {
                          const isRetake = group.key === "retake";
                          const groupOpen = !isRetake || (openRetakes[week] ?? false);
                          return (
                          <div key={group.key} className="p-4 sm:p-5">
                            <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${groupOpen ? "mb-3" : ""}`}>
                              <span
                                className={`flex h-7 w-7 items-center justify-center rounded-lg ${
                                  group.key === "retake"
                                    ? "bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]"
                                    : "bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]"
                                }`}
                              >
                                {group.key === "retake" ? <IconRepeat size={15} /> : <IconPen size={15} />}
                              </span>
                              <h3 className="text-[16px] text-[var(--sp-ink)]">{group.title}</h3>
                              <span className="text-xs text-[var(--sp-muted)]">
                                {group.items.length} bài · {group.hint}
                              </span>
                              {isRetake && (
                                <button
                                  type="button"
                                  aria-expanded={groupOpen}
                                  onClick={() =>
                                    setOpenRetakes((state) => ({ ...state, [week]: !groupOpen }))
                                  }
                                  className="ml-auto flex items-center gap-1 rounded-lg px-2.5 py-1 text-[13px] font-bold text-[var(--sp-pink-dark)] transition hover:bg-[var(--sp-pink-bg)]"
                                >
                                  {groupOpen ? "Thu gọn" : "Xem chi tiết"}
                                  <IconChevronDown size={15} className={`transition ${groupOpen ? "rotate-180" : ""}`} />
                                </button>
                              )}
                            </div>
                            {groupOpen && (
                            <div className="sp-task-expand grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                              {group.items.map(({ quiz, dayLabel }) => (
                                <QuizCard
                                  key={quiz.id}
                                  quiz={quiz}
                                  dayLabel={dayLabel}
                                  latest={latestByQuiz.get(quiz.id)}
                                />
                              ))}
                            </div>
                            )}
                          </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Lịch sử của môn */}
      <section className="sp-card p-5 sm:p-7">
        <p className="sp-accent text-[17px] text-[var(--sp-pink)]">Kết quả được lưu sau mỗi lần làm</p>
        <h2 className="text-[22px] text-[var(--sp-ink)]">Lịch sử làm bài</h2>

        {historyError ? (
          <p className="mt-4 text-sm text-[var(--sp-pink-dark)]">{historyError}</p>
        ) : history.length === 0 ? (
          <p className="mt-4 rounded-2xl bg-[var(--sp-surface-2)] p-6 text-center text-sm text-[var(--sp-muted)]">
            Kết quả sẽ xuất hiện tại đây sau khi bạn làm bài kiểm tra đầu tiên của môn này.
          </p>
        ) : (
          <ul className="mt-4 space-y-2.5">
            {history.map((attempt) => {
              const percent = getAttemptPercent(attempt);
              const style = scoreStyle(percent);
              return (
                <li
                  key={attempt.attempt_id}
                  className="flex flex-col gap-3 rounded-2xl border-2 border-[var(--sp-line)] px-4 py-3.5 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-[var(--sp-ink)]">
                      {quizById.get(attempt.quiz_id)
                        ? quizTitle(quizById.get(attempt.quiz_id)!)
                        : getMainTopicTitle(attempt.quiz_title)}
                    </p>
                    <p className="text-xs text-[var(--sp-muted)]">
                      {attempt.submitted_at
                        ? new Date(attempt.submitted_at).toLocaleString("vi-VN")
                        : "Chưa nộp"}{" "}
                      · đúng {attempt.correct_count}/{attempt.total_questions} câu
                    </p>
                  </div>
                  <div className="flex items-center gap-3 sm:w-[220px]">
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--sp-surface-2)]">
                      <div className={`h-full rounded-full ${style.bar}`} style={{ width: `${Math.max(3, percent)}%` }} />
                    </div>
                    <span className={`w-12 text-right text-lg font-extrabold ${style.text}`}>{percent}%</span>
                  </div>
                  <Link
                    href={`/quiz-results/${attempt.attempt_id}`}
                    className="sp-btn sp-btn-secondary shrink-0 px-4 py-2 text-sm"
                  >
                    Xem kết quả
                    <IconArrowRight size={15} />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function OverviewStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="sp-card p-4 sm:p-5">
      <p className="text-sm font-semibold text-[var(--sp-text-2)]">{label}</p>
      <p className={`mt-1 text-[28px] font-extrabold leading-tight ${accent || "text-[var(--sp-ink)]"}`}>
        {value}
      </p>
    </div>
  );
}

function QuizCard({
  quiz,
  dayLabel,
  latest,
}: {
  quiz: Quiz;
  dayLabel: string;
  latest: QuizAttempt | undefined;
}) {
  const unlocked = canStartQuiz(quiz);
  const finishedRetake = quiz.is_retake && quiz.review_status === "completed";
  const percent = latest ? getAttemptPercent(latest) : null;

  const status = latest
    ? { label: `Đã làm · ${percent}%`, style: `bg-[var(--sp-surface-2)] ${scoreStyle(percent!).text}` }
    : unlocked
      ? { label: "Đã mở", style: "bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]" }
      : finishedRetake
        ? { label: "Đã hoàn thành", style: "bg-[var(--sp-surface-2)] text-[var(--sp-muted)]" }
        : { label: "Đang khóa", style: "bg-[var(--sp-amber-bg)] text-[var(--sp-amber-dark)]" };

  return (
    <div
      className={`flex h-full flex-col rounded-2xl border-2 p-4 transition ${
        unlocked && !latest
          ? "border-[var(--sp-lav-line)] bg-white hover:border-[var(--sp-peri)]"
          : "border-[var(--sp-line)] bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={`flex h-10 w-10 items-center justify-center rounded-xl ${
            quiz.is_retake
              ? "bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]"
              : "bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]"
          }`}
        >
          {quiz.is_retake ? <IconRepeat size={18} /> : <IconPen size={18} />}
        </span>
        <span className={`sp-chip ${status.style}`}>{status.label}</span>
      </div>

      {dayLabel && (
        <p className="mt-3 text-xs font-bold uppercase tracking-wide text-[var(--sp-purple)]">
          {dayLabel}
        </p>
      )}
      <h3 className={`${dayLabel ? "mt-0.5" : "mt-3"} line-clamp-2 font-bold text-[var(--sp-ink)]`}>
        {quizTitle(quiz)}
      </h3>
      <p className="mt-0.5 text-[13px] text-[var(--sp-muted)]">
        {quiz.is_retake
          ? "30% trắc nghiệm · 70% điền vào chỗ trống · làm lại không giới hạn"
          : "Kiểm tra kiến thức của bài học · chỉ làm 1 lần"}
      </p>

      <div className="mt-3 flex flex-wrap gap-3 text-xs text-[var(--sp-muted)]">
        <span className="flex items-center gap-1">
          <IconClock size={13} />
          {quiz.time_limit_minutes ? `${quiz.time_limit_minutes} phút` : "Không giới hạn"}
        </span>
        <span className="flex items-center gap-1">
          <IconCalendar size={13} />
          {formatDate(quiz.scheduled_start || quiz.created_at)}
        </span>
      </div>

      <div className="mt-auto pt-4">
        {!quiz.is_retake && latest ? (
          /* Bài kiểm tra kiến thức chính chỉ làm 1 lần: chỉ xem kết quả */
          <Link
            href={`/quiz-results/${latest.attempt_id}`}
            className="sp-btn sp-btn-secondary w-full justify-center py-2.5 text-sm"
          >
            Xem kết quả
            <IconArrowRight size={15} />
          </Link>
        ) : unlocked ? (
          <div className="flex gap-2">
            <Link
              href={`/quizzes/${quiz.id}`}
              className="sp-btn sp-btn-primary flex-1 justify-center py-2.5 text-sm"
            >
              {latest || quiz.is_retake ? "Làm lại" : "Bắt đầu làm bài"}
              <IconArrowRight size={15} />
            </Link>
            {latest && (
              <Link
                href={`/quiz-results/${latest.attempt_id}`}
                className="sp-btn sp-btn-secondary px-3 py-2.5 text-sm"
                aria-label="Xem kết quả gần nhất"
                title="Xem kết quả gần nhất"
              >
                <IconCheck size={15} />
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="flex items-start gap-2 rounded-xl bg-[var(--sp-surface-2)] px-3 py-2.5 text-[13px] text-[var(--sp-muted)]">
              <IconLock size={14} className="mt-0.5 shrink-0" />
              {getLockMessage(quiz)}
            </p>
            {latest && (
              <Link
                href={`/quiz-results/${latest.attempt_id}`}
                className="sp-btn sp-btn-secondary w-full justify-center py-2 text-sm"
              >
                Xem kết quả lần gần nhất
                <IconArrowRight size={15} />
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

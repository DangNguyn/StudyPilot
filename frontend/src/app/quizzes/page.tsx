"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getMainTopicTitle } from "@/lib/content-titles";
import {
  IconArrowRight,
  IconBolt,
  IconBook,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconClock,
  IconFile,
  IconInfo,
  IconList,
  IconLock,
  IconPen,
  IconPlay,
  IconRepeat,
  IconTarget,
  IconTrendUp,
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
  question_count?: number;
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

  if (quiz.session_status !== "in_progress" && quiz.session_status !== "completed") {
    return "Cần bắt đầu buổi học trước";
  }

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
        key={subject.planId}
        subject={subject}
        subjects={subjects}
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

type QuizOverview = {
  quiz_id: string;
  is_retake: boolean;
  question_count: number;
  choice_count: number;
  fill_count: number;
  time_limit_minutes: number | null;
  attempt_round: number;
  previous: {
    attempt_id: string;
    score: number;
    correct_count: number;
    total_questions: number | null;
    submitted_at: string | null;
    is_original: boolean;
  } | null;
  segments: { kind: "weak" | "rest" | "page"; count: number; label: string; detail: string }[];
  context: {
    topic_name: string | null;
    chapter: string | null;
    scheduled_date: string | null;
    day_number: number | null;
    subject_id: string | null;
    study_session_id: string | null;
  };
};

type QuizState = "open" | "done" | "locked";

const WEEKDAYS = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];

function vnDateKey(value?: string | null) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(value));
}

function shortDate(value?: string | null) {
  const key = vnDateKey(value);
  if (!key) return "";
  const [, month, day] = key.split("-");
  return `${day}/${month}`;
}

function weekdayDate(value?: string | null) {
  const key = vnDateKey(value);
  if (!key) return "";
  const date = new Date(`${key}T00:00:00`);
  return `${WEEKDAYS[date.getDay()]} ${shortDate(key)}`;
}

/** "Chương 2: Độ co giãn" → "Chương 2" ; mã ngắn "C2" */
function chapterCode(chapter?: string | null) {
  const match = (chapter || "").match(/^\s*(chương|chapter|unit|phần|part|bài)\s*([0-9]+|[IVXLC]+)/i);
  if (!match) return null;
  const word = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
  return { label: `${word} ${match[2]}`, code: `C${match[2]}` };
}

function quizState(quiz: Quiz, latest: QuizAttempt | undefined): QuizState {
  if (!quiz.is_retake && latest) return "done";
  if (quiz.is_retake && quiz.review_status === "completed") return "done";
  return canStartQuiz(quiz) ? "open" : "locked";
}

function SubjectQuizzes({
  subject,
  subjects,
  historyError,
}: {
  subject: SubjectGroup;
  subjects: SubjectGroup[];
  historyError: string;
}) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const today = vnDateKey(new Date().toISOString());

  const latestByQuiz = useMemo(() => {
    const map = new Map<string, QuizAttempt>();
    for (const attempt of [...subject.attempts].sort(
      (a, b) => new Date(a.submitted_at || 0).getTime() - new Date(b.submitted_at || 0).getTime()
    )) {
      map.set(attempt.quiz_id, attempt);
    }
    return map;
  }, [subject.attempts]);

  /* Thứ tự: bài đang mở → bài đã làm (mới nhất trước) → bài đang khóa (theo lịch) */
  const ordered = useMemo(() => {
    const time = (quiz: Quiz) => new Date(quiz.scheduled_start || quiz.created_at).getTime();
    const items = subject.quizzes.map((quiz) => {
      const latest = latestByQuiz.get(quiz.id);
      return { quiz, latest, state: quizState(quiz, latest) };
    });
    const rank = { open: 0, done: 1, locked: 2 } as const;
    return items.sort((a, b) => {
      if (a.state !== b.state) return rank[a.state] - rank[b.state];
      if (a.state === "done") {
        return new Date(b.latest?.submitted_at || 0).getTime() - new Date(a.latest?.submitted_at || 0).getTime();
      }
      return time(a.quiz) - time(b.quiz);
    });
  }, [subject.quizzes, latestByQuiz]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = ordered.find((item) => item.quiz.id === selectedId) || ordered[0];

  const totals = subject.attempts.reduce(
    (sum, attempt) => ({
      questions: sum.questions + (attempt.total_questions || 0),
      correct: sum.correct + (attempt.correct_count || 0),
    }),
    { questions: 0, correct: 0 }
  );

  function select(id: string) {
    setSelectedId(id);
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      window.setTimeout(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Đầu trang */}
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <nav className="flex items-center gap-1.5 text-sm font-medium text-[var(--sp-muted)]">
            <Link href="/quizzes" className="hover:text-[var(--sp-peri-dark)]">
              Kiểm tra kiến thức
            </Link>
            <IconChevronRight size={14} />
            <span className="truncate text-[var(--sp-text-2)]">{subject.name}</span>
          </nav>
          <h1 className="mt-2 flex items-end gap-3 text-[40px] leading-tight sm:text-[52px]">
            <span>
              Kiểm tra <span className="sp-squiggle">kiến thức</span>
            </span>
            <Sparkle size={24} className="sp-twinkle mb-3 text-[var(--sp-yellow)]" />
          </h1>
          <p className="mt-1 text-[15px] text-[var(--sp-muted)]">
            Chỉ hỏi những phần bạn đã học. Câu hỏi được tạo từ tài liệu bạn tải lên.
          </p>
        </div>

        <label className="relative flex w-full items-center gap-2 rounded-2xl border-2 border-[var(--sp-line)] bg-white px-4 py-2.5 transition focus-within:border-[var(--sp-peri)] sm:w-auto sm:min-w-[240px]">
          <IconBook size={18} className="shrink-0 text-[var(--sp-ink)]" />
          <span className="sr-only">Chọn môn</span>
          <select
            value={subject.planId}
            onChange={(event) => router.push(`/quizzes?plan=${encodeURIComponent(event.target.value)}`)}
            className="w-full cursor-pointer appearance-none bg-transparent pr-6 text-[15px] font-bold text-[var(--sp-ink)] outline-none"
          >
            {subjects.map((item) => (
              <option key={item.planId} value={item.planId}>
                {item.name}
              </option>
            ))}
          </select>
          <IconChevronDown size={16} className="pointer-events-none absolute right-4 text-[var(--sp-ink)]" />
        </label>
      </section>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        {/* ---------- Danh sách bài ---------- */}
        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="sp-accent text-[17px] text-[var(--sp-pink)]">Theo lịch ôn của bạn</p>
              <h2 className="text-[22px] text-[var(--sp-ink)]">Bài kiểm tra</h2>
            </div>
            <span className="sp-chip bg-[var(--sp-surface-2)] text-[var(--sp-text-2)]">
              {subject.quizzes.length} bài
            </span>
          </div>

          {ordered.length === 0 ? (
            <p className="sp-card p-6 text-center text-sm text-[var(--sp-muted)]">
              Chưa có bài kiểm tra nào. Học xong buổi đầu tiên để mở bài.
            </p>
          ) : (
            <ul className="space-y-3">
              {ordered.map(({ quiz, latest, state }) => (
                <li key={quiz.id}>
                  <QuizListCard
                    quiz={quiz}
                    latest={latest}
                    state={state}
                    today={today}
                    active={selected?.quiz.id === quiz.id}
                    onSelect={() => select(quiz.id)}
                  />
                </li>
              ))}
            </ul>
          )}

          <p className="flex items-start gap-2.5 rounded-2xl bg-[var(--sp-lav)] px-4 py-3.5 text-sm text-[var(--sp-text-2)]">
            <IconInfo size={17} className="mt-0.5 shrink-0" />
            {historyError ? (
              historyError
            ) : subject.attempts.length === 0 ? (
              "Bạn chưa làm bài nào của môn này."
            ) : (
              <span>
                Đã làm <b className="text-[var(--sp-ink)]">{totals.questions} câu</b> qua{" "}
                {subject.attempts.length} lượt, đúng{" "}
                <b className="text-[var(--sp-ink)]">
                  {totals.correct} câu ({totals.questions ? Math.round((totals.correct / totals.questions) * 100) : 0}%)
                </b>
                .
              </span>
            )}
          </p>
        </section>

        {/* ---------- Tổng quan trước khi làm ---------- */}
        <div ref={panelRef} className="scroll-mt-24 lg:sticky lg:top-6">
          {selected ? (
            <QuizOverviewPanel
              key={selected.quiz.id}
              quiz={selected.quiz}
              latest={selected.latest}
              state={selected.state}
              today={today}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function QuizListCard({
  quiz,
  latest,
  state,
  today,
  active,
  onSelect,
}: {
  quiz: Quiz;
  latest: QuizAttempt | undefined;
  state: QuizState;
  today: string;
  active: boolean;
  onSelect: () => void;
}) {
  const percent = latest ? getAttemptPercent(latest) : null;
  const dateKey = vnDateKey(quiz.scheduled_start || quiz.created_at);
  const isToday = dateKey === today;

  const chip =
    state === "done"
      ? { text: `Đã làm · ${shortDate(latest?.submitted_at || dateKey)}`, style: "bg-emerald-50 text-emerald-700" }
      : state === "open"
        ? {
            text: quiz.is_retake
              ? `Kiểm tra lại${quiz.study_day ? ` · ngày học ${quiz.study_day}` : ""}`
              : isToday
                ? `Hôm nay${quiz.study_day ? ` · ngày học ${quiz.study_day}` : ""}`
                : `Đang mở · ${shortDate(dateKey)}`,
            style: "bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]",
          }
        : { text: weekdayDate(dateKey) || "Đang khóa", style: "bg-[var(--sp-surface-2)] text-[var(--sp-text-2)]" };

  const icon =
    state === "done" ? (
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
        <IconCheck size={22} />
      </span>
    ) : state === "open" ? (
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-pink)] text-white">
        {quiz.is_retake ? <IconRepeat size={21} /> : <IconBolt size={21} />}
      </span>
    ) : (
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--sp-surface-2)] text-[var(--sp-muted)]">
        <IconLock size={20} />
      </span>
    );

  const style = percent !== null ? scoreStyle(percent) : null;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={`group relative flex cursor-pointer gap-4 rounded-[22px] border-2 p-4 text-left transition sm:p-5 ${
        active
          ? "border-[var(--sp-purple)] bg-[#fff6fa] shadow-[5px_5px_0_var(--sp-pink)]"
          : state === "locked"
            ? "border-dashed border-[var(--sp-line)] bg-[var(--sp-surface-2)]/50 hover:border-[var(--sp-lav-line)]"
            : "border-[var(--sp-line)] bg-white hover:border-[var(--sp-lav-line)]"
      }`}
    >
      {icon}
      <div className="min-w-0 flex-1">
        <span className={`sp-chip ${chip.style}`}>{chip.text}</span>
        <h3 className={`mt-2 line-clamp-2 text-[17px] font-bold ${state === "locked" ? "text-[var(--sp-text-2)]" : "text-[var(--sp-ink)]"}`}>
          {quizTitle(quiz)}
        </h3>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-[var(--sp-muted)]">
          {!!quiz.question_count && (
            <span className="flex items-center gap-1.5">
              <IconList size={14} />
              {quiz.question_count} câu
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <IconClock size={14} />
            {quiz.time_limit_minutes ? `${quiz.time_limit_minutes} phút` : "Không giới hạn"}
          </span>
          {quiz.is_retake && state !== "locked" && (
            <span className="flex items-center gap-1.5">
              <IconTarget size={14} />
              Ưu tiên phần yếu
            </span>
          )}
        </p>

        {state === "done" && latest && style && (
          <div className="mt-3 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--sp-surface-2)]">
              <div className={`h-full rounded-full ${style.bar}`} style={{ width: `${Math.max(3, percent!)}%` }} />
            </div>
            <span className="text-[15px] font-extrabold text-[var(--sp-ink)]">
              {latest.correct_count}/{latest.total_questions}
            </span>
            <Link
              href={`/quiz-results/${latest.attempt_id}`}
              onClick={(event) => event.stopPropagation()}
              className="sp-btn sp-btn-secondary shrink-0 px-3.5 py-1.5 text-[13px]"
            >
              Xem lại bài
            </Link>
          </div>
        )}

        {state === "locked" && (
          <p className="mt-2 flex items-start gap-1.5 text-[13px] text-[var(--sp-muted)]">
            <IconInfo size={14} className="mt-0.5 shrink-0" />
            {getLockMessage(quiz)}
          </p>
        )}
      </div>
      {active && <IconChevronRight size={18} className="absolute right-4 top-5 text-[var(--sp-ink)]" />}
    </div>
  );
}

function QuizOverviewPanel({
  quiz,
  latest,
  state,
  today,
}: {
  quiz: Quiz;
  latest: QuizAttempt | undefined;
  state: QuizState;
  today: string;
}) {
  const [overview, setOverview] = useState<QuizOverview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/quizzes/${quiz.id}/overview`)
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.detail || "Không tải được tổng quan bài kiểm tra.");
        if (!cancelled) setOverview(result.data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Không tải được tổng quan bài kiểm tra.");
      });
    return () => {
      cancelled = true;
    };
  }, [quiz.id]);

  const context = overview?.context;
  const dateKey = vnDateKey(quiz.scheduled_start || context?.scheduled_date || quiz.created_at);
  const chapter = chapterCode(context?.chapter);
  const questionCount = overview?.question_count ?? quiz.question_count ?? 0;
  const previous = overview?.previous;
  const summaryHref =
    context?.subject_id && context?.study_session_id
      ? `/study-materials?subject=${encodeURIComponent(context.subject_id)}&session=${encodeURIComponent(context.study_session_id)}`
      : "/study-materials";

  const eyebrow = `${quiz.is_retake ? "Kiểm tra lại" : "Kiểm tra kiến thức"} · ${
    dateKey === today ? `hôm nay, ${weekdayDate(dateKey)}` : weekdayDate(dateKey)
  }`;

  const badge = quiz.is_retake
    ? state === "done"
      ? "Đã hoàn thành"
      : `Lần làm thứ ${overview?.attempt_round ?? 1}`
    : state === "done"
      ? "Đã làm · chỉ 1 lần"
      : "Chỉ làm 1 lần";

  const typeLabel =
    overview && overview.fill_count > 0
      ? `${overview.choice_count} trắc nghiệm · ${overview.fill_count} điền khuyết`
      : "Trắc nghiệm";

  const segmentColors = ["bg-[var(--sp-peri)]", "bg-[var(--sp-purple)]", "bg-[#8aa3ee]", "bg-[var(--sp-pink)]"];
  const segmentStyle = (kind: string, index: number) =>
    kind === "weak" ? "bg-[var(--sp-pink)]" : kind === "rest" ? "bg-[var(--sp-peri)]" : segmentColors[index % segmentColors.length];
  const segments = overview?.segments || [];
  const segmentTotal = segments.reduce((sum, item) => sum + item.count, 0) || 1;

  return (
    <article className="relative rounded-[28px] border-2 border-[var(--sp-purple-deep)] bg-white px-5 pb-5 pt-9 shadow-[6px_6px_0_var(--sp-peri)] sm:px-8 sm:pb-7">
      <span className="absolute -top-4 left-6 -rotate-2 rounded-xl border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-yellow)] px-3.5 py-1.5 text-sm font-extrabold text-[var(--sp-purple-deep)] shadow-[3px_3px_0_var(--sp-pink)]">
        Tổng quan trước khi làm
      </span>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="sp-accent text-[18px] text-[var(--sp-pink)]">{eyebrow}</p>
          <h2 className="mt-0.5 text-[26px] leading-tight text-[var(--sp-ink)] sm:text-[30px]">{quizTitle(quiz)}</h2>
        </div>
        <span className="sp-chip flex items-center gap-1.5 bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]">
          {quiz.is_retake ? <IconRepeat size={14} /> : <IconPen size={14} />}
          {badge}
        </span>
      </div>

      {/* 4 ô thông tin */}
      <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <InfoTile
          icon={<IconBook size={15} />}
          label="Phạm vi"
          value={chapter?.label || (context?.day_number ? `Ngày học ${context.day_number}` : "Bài học")}
          sub={dateKey ? `Học ngày ${shortDate(context?.scheduled_date || dateKey)}` : "—"}
          title={context?.chapter || undefined}
        />
        <InfoTile icon={<IconList size={15} />} label="Số câu" value={questionCount ? `${questionCount} câu` : "—"} sub={typeLabel} />
        <InfoTile
          icon={<IconClock size={15} />}
          label="Thời gian"
          value={quiz.time_limit_minutes ? `${quiz.time_limit_minutes} phút` : "Tự do"}
          sub={quiz.time_limit_minutes ? "Tính từ lúc bắt đầu" : "Không giới hạn"}
        />
        <InfoTile
          icon={<IconTrendUp size={15} />}
          label="Lần trước"
          highlight
          value={
            previous
              ? `${previous.total_questions ? `${previous.correct_count}/${previous.total_questions} · ` : ""}${previous.score}%`
              : latest
                ? `${getAttemptPercent(latest)}%`
                : "Chưa làm"
          }
          sub={
            previous
              ? `${previous.is_original && quiz.is_retake ? "Bài gốc" : "Ngày"} ${shortDate(previous.submitted_at)}`
              : "Đây là lần đầu"
          }
        />
      </div>

      {/* Câu hỏi được chọn thế nào */}
      <h3 className="mt-7 text-[16px] font-bold text-[var(--sp-ink)]">Câu hỏi được chọn thế nào?</h3>
      {error ? (
        <p className="mt-2 text-sm text-[var(--sp-pink-dark)]">{error}</p>
      ) : !overview ? (
        <div className="mt-3 h-11 animate-pulse rounded-xl bg-[var(--sp-surface-2)]" />
      ) : segments.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--sp-muted)]">Câu hỏi lấy từ nội dung của buổi học này.</p>
      ) : (
        <>
          <div className="mt-3 flex min-h-11 overflow-hidden rounded-xl border-2 border-[var(--sp-purple-deep)]">
            {segments.map((segment, index) => (
              <div
                key={`${segment.label}-${index}`}
                className={`flex min-w-0 items-center gap-1.5 px-3 py-2 text-[13px] font-bold text-white ${segmentStyle(segment.kind, index)} ${
                  index > 0 ? "border-l-2 border-white/60" : ""
                }`}
                style={{ flexGrow: segment.count, flexBasis: 0 }}
                title={`${segment.count} câu · ${segment.label}`}
              >
                {segment.kind === "weak" && <IconTarget size={15} className="shrink-0" />}
                <span className="truncate">
                  {segment.count} câu · {segment.label}
                </span>
              </div>
            ))}
          </div>
          <ul className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-[var(--sp-text-2)]">
            {segments.map((segment, index) => (
              <li key={`${segment.label}-legend-${index}`} className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${segmentStyle(segment.kind, index)}`} />
                {segment.kind === "page"
                  ? `${segment.detail}: ${Math.round((segment.count / segmentTotal) * 100)}% số câu`
                  : segment.detail}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Sau khi nộp bài */}
      <h3 className="mt-7 text-[16px] font-bold text-[var(--sp-ink)]">Sau khi nộp bài</h3>
      <ol className="mt-3 grid gap-3 sm:grid-cols-3">
        {[
          <>Xem <b className="text-[var(--sp-ink)]">điểm từng câu</b> và danh sách câu sai.</>,
          <>Mỗi câu sai có <b className="text-[var(--sp-ink)]">giải thích</b> và <b className="text-[var(--sp-ink)]">nguồn</b> trong tài liệu gốc.</>,
          quiz.is_retake ? (
            <>Đạt từ 80% là <b className="text-[var(--sp-ink)]">hoàn thành</b>; chưa đạt thì ôn và làm lại.</>
          ) : (
            <>Kết quả cập nhật vào <b className="text-[var(--sp-ink)]">Đánh giá năng lực</b>; dưới 80% có bài kiểm tra lại.</>
          ),
        ].map((text, index) => (
          <li key={index} className="flex gap-3 rounded-2xl bg-[var(--sp-lav)]/70 px-4 py-3.5 text-[13.5px] leading-5 text-[var(--sp-text-2)]">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 border-[var(--sp-purple-deep)] bg-white text-sm font-extrabold text-[var(--sp-purple-deep)]">
              {index + 1}
            </span>
            <span>{text}</span>
          </li>
        ))}
      </ol>

      {/* Hành động */}
      <div className="mt-7 flex flex-col gap-3 border-t-2 border-dashed border-[var(--sp-line)] pt-5 sm:flex-row sm:flex-wrap sm:items-center">
        {state === "open" ? (
          <Link href={`/quizzes/${quiz.id}`} className="sp-btn sp-btn-primary justify-center whitespace-nowrap px-6 py-3 text-[16px]">
            <IconPlay size={17} />
            {quiz.is_retake ? "Làm lại" : "Bắt đầu làm bài"}
          </Link>
        ) : state === "done" && latest ? (
          <Link href={`/quiz-results/${latest.attempt_id}`} className="sp-btn sp-btn-primary justify-center whitespace-nowrap px-6 py-3 text-[16px]">
            <IconCheck size={17} />
            Xem kết quả
          </Link>
        ) : (
          <span className="sp-btn cursor-not-allowed justify-center bg-[var(--sp-surface-2)] px-6 py-3 text-[15px] text-[var(--sp-muted)]">
            <IconLock size={16} />
            Chưa mở khóa
          </span>
        )}
        <Link href={summaryHref} className="sp-btn sp-btn-secondary justify-center whitespace-nowrap px-5 py-3 text-[15px]">
          <IconFile size={16} />
          {state === "locked" ? "Đến bài học để mở khóa" : `Xem lại bài học${chapter ? ` ${chapter.code}` : ""}`}
        </Link>
        <p className="text-[13px] text-[var(--sp-muted)] sm:min-w-[180px] sm:flex-1 sm:text-right">
          {state === "open"
            ? "Chưa sẵn sàng? Bài vẫn giữ trong lịch, bạn làm lúc khác cũng được."
            : state === "locked"
              ? getLockMessage(quiz)
              : quiz.is_retake
                ? "Bạn đã đạt bài kiểm tra lại."
                : "Bài kiểm tra kiến thức chỉ làm 1 lần."}
        </p>
      </div>
    </article>
  );
}

function InfoTile({
  icon,
  label,
  value,
  sub,
  highlight,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  highlight?: boolean;
  title?: string;
}) {
  return (
    <div
      title={title}
      className={`min-w-0 rounded-2xl border-2 px-3 py-3 ${
        highlight ? "border-[#f3dca0] bg-[var(--sp-amber-bg)]" : "border-[var(--sp-line)] bg-white"
      }`}
    >
      <p
        className={`flex items-center gap-1 whitespace-nowrap text-[11px] font-bold uppercase tracking-wide ${
          highlight ? "text-[var(--sp-amber-dark)]" : "text-[var(--sp-muted)]"
        }`}
      >
        {icon}
        {label}
      </p>
      <p
        className={`mt-1.5 truncate text-[19px] font-extrabold leading-tight ${
          highlight ? "text-[#c98a00]" : "text-[var(--sp-ink)]"
        }`}
      >
        {value}
      </p>
      <p className={`mt-0.5 truncate text-[12px] ${highlight ? "text-[var(--sp-amber-dark)]" : "text-[var(--sp-muted)]"}`}>
        {sub}
      </p>
    </div>
  );
}

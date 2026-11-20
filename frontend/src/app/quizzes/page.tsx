"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
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
  review_date?: string | null;
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

type QuizGroup = "done" | "todo" | "review";

/* Phân loại: đã hoàn thành (xem câu sai) · chưa làm/đang khoá (bài cuối buổi) · ôn tập (bài kiểm tra lại) */
function quizGroup(quiz: Quiz, state: QuizState): QuizGroup {
  if (state === "done") return "done";
  return quiz.is_retake ? "review" : "todo";
}

const GROUPS: Record<QuizGroup, { name: string; desc: string; icon: React.ReactNode; tone: string }> = {
  done: {
    name: "Đã hoàn thành",
    desc: "Bấm để xem lại câu sai kèm giải thích và nguồn trong tài liệu.",
    icon: <IconCheck size={22} />,
    tone: "bg-emerald-600",
  },
  todo: {
    name: "Chưa làm · Đang khoá",
    desc: "Bài kiểm tra trắc nghiệm cuối mỗi buổi. Học xong buổi thì bài mở.",
    icon: <IconBolt size={22} />,
    tone: "bg-[var(--sp-peri)]",
  },
  review: {
    name: "Ôn tập",
    desc: "Đề dựng theo điểm lần trước: ưu tiên câu sai, dưới 50% có thêm điền khuyết.",
    icon: <IconRepeat size={22} />,
    tone: "bg-[var(--sp-pink)]",
  },
};
const GROUP_ORDER: QuizGroup[] = ["done", "todo", "review"];

function scoreTone(percent: number) {
  if (percent >= 80) return { box: "border-emerald-200 bg-emerald-50", text: "text-emerald-700", fill: "bg-emerald-600", label: "Đạt" };
  if (percent >= 50) return { box: "border-[#f0d98a] bg-[var(--sp-amber-bg)]", text: "text-[var(--sp-amber-dark)]", fill: "bg-[#d99a1c]", label: "Cần củng cố" };
  return { box: "border-[var(--sp-red-line)] bg-[var(--sp-red-bg)]", text: "text-[var(--sp-red-dark)]", fill: "bg-[var(--sp-red)]", label: "Cần ôn cấp tốc" };
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
  const today = vnDateKey(new Date().toISOString());
  const [filter, setFilter] = useState<QuizGroup | "all">("all");

  const latestByQuiz = useMemo(() => {
    const map = new Map<string, QuizAttempt>();
    for (const attempt of [...subject.attempts].sort(
      (a, b) => new Date(a.submitted_at || 0).getTime() - new Date(b.submitted_at || 0).getTime()
    )) {
      map.set(attempt.quiz_id, attempt);
    }
    return map;
  }, [subject.attempts]);

  /* Trong mỗi nhóm: đã làm mới nhất trước; chưa làm/ôn tập: bài đang mở trước, rồi theo ngày */
  const grouped = useMemo(() => {
    const result: Record<QuizGroup, { quiz: Quiz; latest: QuizAttempt | undefined; state: QuizState }[]> = {
      done: [],
      todo: [],
      review: [],
    };
    for (const quiz of subject.quizzes) {
      const latest = latestByQuiz.get(quiz.id);
      const state = quizState(quiz, latest);
      result[quizGroup(quiz, state)].push({ quiz, latest, state });
    }
    const when = (quiz: Quiz) => vnDateKey(quiz.review_date || quiz.scheduled_start || quiz.created_at);
    result.done.sort((a, b) => String(b.latest?.submitted_at || "").localeCompare(String(a.latest?.submitted_at || "")));
    for (const key of ["todo", "review"] as const) {
      result[key].sort((a, b) =>
        a.state !== b.state ? (a.state === "open" ? -1 : 1) : when(a.quiz).localeCompare(when(b.quiz))
      );
    }
    return result;
  }, [subject.quizzes, latestByQuiz]);

  const totals = subject.attempts.reduce(
    (sum, attempt) => ({
      questions: sum.questions + (attempt.total_questions || 0),
      correct: sum.correct + (attempt.correct_count || 0),
    }),
    { questions: 0, correct: 0 }
  );

  const tabs: { key: QuizGroup | "all"; name: string; icon: React.ReactNode; tone: string; count: number }[] = [
    { key: "all", name: "Tất cả", icon: <IconList size={16} />, tone: "bg-[var(--sp-purple-deep)]", count: subject.quizzes.length },
    ...GROUP_ORDER.map((key) => ({ key, name: GROUPS[key].name, icon: GROUPS[key].icon, tone: GROUPS[key].tone, count: grouped[key].length })),
  ];

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

      {/* Lọc theo loại */}
      <div className="flex flex-wrap gap-3" role="group" aria-label="Lọc bài kiểm tra">
        {tabs.map((tab) => {
          const active = filter === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(tab.key)}
              className={`flex items-center gap-2.5 rounded-full border-2 py-2 pl-2 pr-4 text-sm font-bold transition ${
                active
                  ? "border-[var(--sp-purple-deep)] bg-[var(--sp-purple-deep)] text-white shadow-[3px_3px_0_var(--sp-lav-line)]"
                  : "border-[var(--sp-line)] bg-white text-[var(--sp-text-2)] hover:border-[var(--sp-lav-line)]"
              }`}
            >
              <span className={`flex h-7 w-7 items-center justify-center rounded-[10px] border-2 border-[var(--sp-purple-deep)] text-white ${tab.tone} [&_svg]:h-4 [&_svg]:w-4`}>
                {tab.icon}
              </span>
              {tab.name}
              <span
                className={`flex h-[22px] min-w-[26px] items-center justify-center rounded-full px-1.5 text-xs ${
                  active ? "bg-[var(--sp-yellow)] text-[var(--sp-purple-deep)]" : "bg-[var(--sp-surface-2)] text-[var(--sp-muted)]"
                }`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {subject.quizzes.length === 0 ? (
        <p className="sp-card p-6 text-center text-sm text-[var(--sp-muted)]">
          Chưa có bài kiểm tra nào. Học xong buổi đầu tiên để mở bài.
        </p>
      ) : (
        GROUP_ORDER.filter((key) => filter === "all" || filter === key).map((key) => (
          <section key={key} className="space-y-4 pt-2">
            <div className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3.5">
              <span className={`flex h-[52px] w-[52px] items-center justify-center rounded-2xl border-2 border-[var(--sp-purple-deep)] text-white shadow-[3px_3px_0_var(--sp-purple-deep)] ${GROUPS[key].tone}`}>
                {GROUPS[key].icon}
              </span>
              <div className="min-w-0">
                <h2 className="text-[24px] text-[var(--sp-ink)]">{GROUPS[key].name}</h2>
                <p className="text-sm text-[var(--sp-muted)]">{GROUPS[key].desc}</p>
              </div>
              <span className="sp-chip border-2 border-[var(--sp-line)] bg-white text-[var(--sp-muted)]">
                {grouped[key].length} bài
              </span>
            </div>
            {grouped[key].length === 0 ? (
              <p className="rounded-2xl border-2 border-dashed border-[var(--sp-line)] px-5 py-4 text-sm text-[var(--sp-muted)]">
                {key === "review" ? "Chưa có bài ôn tập. Bài dưới 80% sẽ có bài ôn ở đây." : "Chưa có bài nào."}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {grouped[key].map(({ quiz, latest, state }) => (
                  <QuizCard key={quiz.id} quiz={quiz} latest={latest} state={state} group={key} today={today} />
                ))}
              </div>
            )}
          </section>
        ))
      )}

      <p className="flex items-start gap-2.5 rounded-2xl bg-[var(--sp-lav)] px-4 py-3.5 text-sm text-[var(--sp-text-2)]">
        <IconInfo size={17} className="mt-0.5 shrink-0" />
        {historyError ? (
          historyError
        ) : subject.attempts.length === 0 ? (
          "Bạn chưa làm bài nào của môn này."
        ) : (
          <span>
            Đã làm <b className="text-[var(--sp-ink)]">{totals.questions} câu</b> qua {subject.attempts.length} lượt, đúng{" "}
            <b className="text-[var(--sp-ink)]">
              {totals.correct} câu ({totals.questions ? Math.round((totals.correct / totals.questions) * 100) : 0}%)
            </b>
            .
          </span>
        )}
      </p>
    </div>
  );
}

/* Thẻ bài kiểm tra: icon theo loại + 4 ô thông tin + cách chọn câu hỏi + hành động */
function QuizCard({
  quiz,
  latest,
  state,
  group,
  today,
}: {
  quiz: Quiz;
  latest: QuizAttempt | undefined;
  state: QuizState;
  group: QuizGroup;
  today: string;
}) {
  const [overview, setOverview] = useState<QuizOverview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/quizzes/${quiz.id}/overview`)
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.detail || "Không tải được thông tin bài.");
        if (!cancelled) setOverview(result.data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Không tải được thông tin bài.");
      });
    return () => {
      cancelled = true;
    };
  }, [quiz.id]);

  const locked = state === "locked";
  const context = overview?.context;
  const studyKey = vnDateKey(context?.scheduled_date || quiz.scheduled_start || quiz.created_at);
  const chapter = chapterCode(context?.chapter);
  const questionCount = overview?.question_count ?? quiz.question_count ?? 0;
  const typeLabel =
    overview && overview.fill_count > 0 ? `${overview.choice_count} trắc nghiệm · ${overview.fill_count} điền` : "Trắc nghiệm";
  const mode = group === "done" ? "revisit" : group === "review" ? "review" : "learn";
  const lessonHref =
    context?.subject_id && context?.study_session_id
      ? `/materials?subject=${encodeURIComponent(context.subject_id)}&session=${encodeURIComponent(context.study_session_id)}&mode=${mode}`
      : "/study-materials";

  /* Điểm: bài đã làm → lần làm gần nhất; ôn tập → lần trước */
  const scoreSource =
    group === "done" && latest
      ? { correct: latest.correct_count, total: latest.total_questions, percent: getAttemptPercent(latest), date: latest.submitted_at }
      : overview?.previous
        ? {
            correct: overview.previous.correct_count,
            total: overview.previous.total_questions || 0,
            percent: Math.round(overview.previous.score),
            date: overview.previous.submitted_at,
          }
        : null;
  const tone = scoreSource ? scoreTone(scoreSource.percent) : null;

  const reviewKey = vnDateKey(quiz.review_date);
  const kicker =
    group === "review"
      ? `Ôn tập · ${weekdayDate(reviewKey || studyKey)}`
      : `Bài kiểm tra · ${weekdayDate(studyKey)}`;

  const chips: { text: string; style: string; icon: React.ReactNode }[] = [];
  if (group === "done") {
    chips.push({ text: `Đã nộp ${shortDate(latest?.submitted_at || studyKey)}`, style: "bg-emerald-50 text-emerald-700", icon: <IconCheck size={13} /> });
    if (quiz.is_retake) chips.push({ text: "Bài ôn tập", style: "bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]", icon: <IconRepeat size={13} /> });
  } else if (group === "todo") {
    chips.push(
      locked
        ? { text: "Đang khoá", style: "bg-[var(--sp-surface-2)] text-[var(--sp-muted)]", icon: <IconLock size={13} /> }
        : { text: studyKey === today ? "Hôm nay" : "Đang mở", style: "bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]", icon: <IconBolt size={13} /> }
    );
  } else {
    chips.push({ text: `Lần làm thứ ${overview?.attempt_round ?? 1}`, style: "bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]", icon: <IconRepeat size={13} /> });
    if (reviewKey) {
      chips.push(
        reviewKey < today
          ? { text: `Quá hạn ôn ${shortDate(reviewKey)}`, style: "bg-[var(--sp-red-bg)] text-[var(--sp-red-dark)]", icon: <IconClock size={13} /> }
          : reviewKey === today
            ? { text: "Hạn ôn hôm nay", style: "bg-[var(--sp-red-bg)] text-[var(--sp-red-dark)]", icon: <IconClock size={13} /> }
            : { text: `Hạn ôn ${shortDate(reviewKey)}`, style: "bg-[var(--sp-amber-bg)] text-[var(--sp-amber-dark)]", icon: <IconClock size={13} /> }
      );
    }
  }

  const icon = locked ? (
    <IconLock size={24} />
  ) : group === "done" ? (
    <IconCheck size={26} />
  ) : group === "review" ? (
    <IconRepeat size={24} />
  ) : (
    <IconBolt size={24} />
  );

  // Bài cuối buổi: một thanh gộp (chia theo trang thì vụn); ôn tập: giữ phần yếu / phần còn lại
  const pageNames = (overview?.segments || []).filter((segment) => segment.kind === "page").map((segment) => segment.label);
  const segments =
    group === "todo" ? [] : (overview?.segments || []).filter((segment) => segment.kind !== "page");
  const segmentStyle = (kind: string) => (kind === "weak" ? "bg-[var(--sp-pink)]" : kind === "rest" ? "bg-[var(--sp-peri)]" : "bg-[var(--sp-purple)]");

  return (
    <article
      className={`flex flex-col rounded-[22px] border-2 bg-white px-5 pb-5 pt-5 sm:px-6 ${
        locked
          ? "border-[var(--sp-line)] bg-[#fdfcfe]"
          : group === "done"
            ? "border-[var(--sp-purple-deep)] shadow-[6px_6px_0_#a7e3c4]"
            : group === "review"
              ? "border-[var(--sp-purple-deep)] shadow-[6px_6px_0_var(--sp-pink)]"
              : "border-[var(--sp-purple-deep)] shadow-[6px_6px_0_var(--sp-peri)]"
      }`}
    >
      <div className="grid grid-cols-[56px_minmax(0,1fr)] items-center gap-4">
        <span
          className={`flex h-14 w-14 items-center justify-center rounded-2xl border-2 ${
            locked
              ? "border-[var(--sp-line)] bg-[var(--sp-surface-2)] text-[var(--sp-soft)]"
              : `border-[var(--sp-purple-deep)] text-white shadow-[3px_3px_0_var(--sp-purple-deep)] ${GROUPS[group].tone}`
          }`}
        >
          {icon}
        </span>
        <div className="min-w-0">
          <p
            className={`sp-accent text-[17px] leading-tight ${
              locked
                ? "text-[var(--sp-soft)]"
                : group === "done"
                  ? "text-emerald-700"
                  : group === "review"
                    ? "text-[var(--sp-pink)]"
                    : "text-[var(--sp-peri-dark)]"
            }`}
          >
            {kicker}
          </p>
          <h3 className={`mt-1 text-[18px] font-extrabold leading-snug ${locked ? "text-[var(--sp-muted)]" : "text-[var(--sp-ink)]"}`}>
            {quizTitle(quiz)}
          </h3>
        </div>
      </div>

      <div className="mt-3.5 flex flex-wrap gap-2">
        {chips.map((chip) => (
          <span key={chip.text} className={`sp-chip flex items-center gap-1.5 ${chip.style}`}>
            {chip.icon}
            {chip.text}
          </span>
        ))}
      </div>

      {/* 4 ô thông tin */}
      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Tile icon={<IconBook size={13} />} label="Phạm vi" value={chapter?.label || (context?.day_number ? `Ngày ${context.day_number}` : "Bài học")} sub={studyKey ? `Ngày học ${shortDate(studyKey)}` : "—"} />
        <Tile icon={<IconList size={13} />} label="Số câu" value={questionCount ? `${questionCount} câu` : "—"} sub={typeLabel} />
        <Tile
          icon={<IconClock size={13} />}
          label="Thời gian"
          value={quiz.time_limit_minutes ? `${quiz.time_limit_minutes} phút` : "Tự do"}
          sub={quiz.time_limit_minutes ? "Tính từ lúc bắt đầu" : "Không giới hạn"}
        />
        {scoreSource && tone ? (
          <div className={`min-w-0 rounded-[14px] border-2 px-2.5 py-2.5 ${tone.box}`}>
            <p className={`flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wide ${tone.text}`}>
              <IconTrendUp size={13} />
              {group === "done" ? "Kết quả" : "Lần trước"}
            </p>
            <p className={`mt-1 truncate text-[16px] font-extrabold leading-tight ${tone.text}`}>
              {scoreSource.total ? `${scoreSource.correct}/${scoreSource.total} câu` : `${scoreSource.percent}%`}
            </p>
            <p className={`mt-0.5 text-[12px] leading-snug ${tone.text}`}>
              {scoreSource.percent}% · {group === "done" ? tone.label : `Bài gốc ${shortDate(scoreSource.date)}`}
            </p>
          </div>
        ) : locked ? (
          <Tile icon={<IconLock size={13} />} label="Điều kiện" value="Học xong" sub="Buổi học của bài" />
        ) : (
          <Tile icon={<IconPlay size={13} />} label="Mở từ" value={shortDate(studyKey) || "—"} sub="Sau câu hỏi lồng" />
        )}
      </div>

      {/* Nội dung bài */}
      <h4 className="mt-5 text-[14px] font-extrabold text-[var(--sp-ink)]">
        {group === "done" ? "Câu sai cần xem lại" : locked ? "Để mở bài này" : "Câu hỏi được chọn thế nào?"}
      </h4>
      {group === "done" && latest && tone ? (
        <>
          <p className={`mt-2 flex items-center gap-2 rounded-xl border-2 border-[var(--sp-purple-deep)] px-3 py-2 text-[13.5px] font-bold text-white ${tone.fill}`}>
            <IconTarget size={15} />
            {Math.max(0, latest.total_questions - latest.correct_count)} câu sai · đã có giải thích
          </p>
          <BulletList
            dot={tone.fill}
            items={["Mỗi câu sai có giải thích và nguồn trong tài liệu gốc", "Câu sai được ưu tiên trong bài ôn tập"]}
          />
        </>
      ) : locked ? (
        <>
          <p className="mt-2 flex items-center gap-2 rounded-xl border-2 border-[var(--sp-line)] bg-[var(--sp-soft)] px-3 py-2 text-[13.5px] font-bold text-white">
            <IconLock size={15} />
            {getLockMessage(quiz)}
          </p>
          <BulletList
            dot="bg-[var(--sp-soft)]"
            items={
              group === "review"
                ? ["Vào ôn, đọc lại tóm tắt", "Trả lời câu hỏi lồng để mở bài ôn"]
                : ["Vào học, đọc tóm tắt của buổi", "Trả lời câu hỏi lồng để mở bài"]
            }
          />
        </>
      ) : error ? (
        <p className="mt-2 text-sm text-[var(--sp-pink-dark)]">{error}</p>
      ) : !overview ? (
        <div className="mt-2 h-10 animate-pulse rounded-xl bg-[var(--sp-surface-2)]" />
      ) : (
        <>
          <div className="mt-2 flex min-h-10 overflow-hidden rounded-xl border-2 border-[var(--sp-purple-deep)]">
            {(segments.length ? segments : [{ kind: "rest", count: questionCount || 1, label: "phần đã học trong buổi", detail: "" }]).map(
              (segment, index) => (
                <div
                  key={`${segment.label}-${index}`}
                  className={`flex min-w-0 items-center gap-1.5 px-3 py-2 text-[13px] font-bold text-white ${segmentStyle(segment.kind)} ${
                    index > 0 ? "border-l-2 border-white/60" : ""
                  }`}
                  style={{ flexGrow: segment.count, flexBasis: 0 }}
                  title={`${segment.count} câu · ${segment.label}`}
                >
                  <IconTarget size={15} className="shrink-0" />
                  <span className="truncate">
                    {segment.count} câu · {segment.label}
                  </span>
                </div>
              )
            )}
          </div>
          <BulletList
            dot={group === "review" ? "bg-[var(--sp-pink)]" : "bg-[var(--sp-peri)]"}
            items={[
              ...(group === "todo"
                ? pageNames.length
                  ? [`Lấy từ ${pageNames.join(", ")} của tài liệu`]
                  : []
                : segments.filter((segment) => segment.detail).map((segment) => segment.detail).slice(0, 1)),
              group === "review"
                ? overview.fill_count > 0
                  ? "Dưới 50%: trắc nghiệm kết hợp điền khuyết, cần đạt từ 80%"
                  : "50–79%: trắc nghiệm, cần đạt từ 80%"
                : "Chỉ làm 1 lần; dưới 80% sẽ có bài ôn tập",
            ]}
          />
        </>
      )}

      <div className="min-h-2 flex-1" />

      {/* Hành động */}
      <div className="mt-4 grid grid-cols-1 items-center gap-3 border-t-2 border-dashed border-[var(--sp-line)] pt-4 sm:grid-cols-[170px_170px_minmax(0,1fr)]">
        {group === "done" && latest ? (
          <Link href={`/quiz-results/${latest.attempt_id}`} className="sp-btn sp-btn-primary h-11 justify-center !bg-emerald-600 text-[14px]">
            <IconCheck size={16} />
            Xem câu sai
          </Link>
        ) : !locked ? (
          <Link
            href={`/quizzes/${quiz.id}`}
            className={`sp-btn sp-btn-primary h-11 justify-center text-[14px] ${group === "review" ? "!bg-[var(--sp-pink)]" : ""}`}
          >
            <IconPlay size={16} />
            {group === "review" ? "Làm bài ôn" : "Làm bài"}
          </Link>
        ) : group === "review" ? (
          <Link href={lessonHref} className="sp-btn sp-btn-primary h-11 justify-center !bg-[var(--sp-pink)] text-[14px]">
            <IconRepeat size={16} />
            Vào ôn
          </Link>
        ) : (
          <span className="sp-btn h-11 cursor-not-allowed justify-center border-2 border-dashed border-[var(--sp-lav-line)] bg-[var(--sp-surface-2)] text-[14px] text-[var(--sp-soft)]">
            <IconLock size={15} />
            Chưa mở
          </span>
        )}
        <Link href={lessonHref} className="sp-btn sp-btn-secondary h-11 justify-center text-[14px]">
          {locked && group === "todo" ? <IconBook size={16} /> : <IconFile size={16} />}
          {locked && group === "todo" ? "Vào học" : "Xem lại bài học"}
        </Link>
        <p className="text-[12.5px] leading-5 text-[var(--sp-muted)]">
          {group === "done"
            ? quiz.is_retake
              ? "Đã đạt bài ôn tập."
              : scoreSource && scoreSource.percent < 80
                ? "Bài ôn tập của buổi này ở mục Ôn tập."
                : "Đạt từ 80%: buổi này đã hoàn thành."
            : locked
              ? group === "review"
                ? "Trả lời câu hỏi lồng trước để mở bài ôn."
                : "Bài tự mở khi bạn học xong buổi."
              : group === "review"
                ? "Cần đạt từ 80% để hoàn thành phần ôn."
                : "Chưa sẵn sàng? Bạn làm lúc khác cũng được."}
        </p>
      </div>
    </article>
  );
}

function Tile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="min-w-0 rounded-[14px] border-2 border-[var(--sp-line)] bg-white px-2.5 py-2.5">
      <p className="flex items-center gap-1 whitespace-nowrap text-[10.5px] font-bold uppercase tracking-wide text-[var(--sp-muted)]">
        {icon}
        {label}
      </p>
      <p className="mt-1 truncate text-[16px] font-extrabold leading-tight text-[var(--sp-ink)]">{value}</p>
      <p className="mt-0.5 text-[12px] leading-snug text-[var(--sp-muted)]">{sub}</p>
    </div>
  );
}

function BulletList({ items, dot }: { items: string[]; dot: string }) {
  return (
    <ul className="mt-2.5 space-y-1.5">
      {items.map((item) => (
        <li key={item} className="grid grid-cols-[8px_minmax(0,1fr)] items-center gap-2.5 text-[13.5px] text-[var(--sp-text-2)]">
          <span className={`h-2 w-2 rounded-full ${dot}`} />
          {item}
        </li>
      ))}
    </ul>
  );
}

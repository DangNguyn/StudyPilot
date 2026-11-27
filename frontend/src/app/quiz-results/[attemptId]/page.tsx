"use client";

import { currentLocale, tx } from "@/lib/i18n";
import { isPass, scoreLevel } from "@/lib/score-rules";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { PilotMascot, SmartLoading } from "@/components/loading-play";
import LessonPeek, { type LessonPeekRequest } from "@/components/lesson-peek";
import Link from "next/link";
import { getMainTopicTitle, stripOutlineNumbers } from "@/lib/content-titles";
import WrongAnswerReview, { type Mistake } from "@/components/wrong-answer-review";
import {
  IconAlert,
  IconArrowLeft,
  IconArrowRight,
  IconBook,
  IconBulb,
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconFile,
  IconLock,
  IconRepeat,
  IconTarget,
  IconX,
  Sparkle,
} from "@/components/icons";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

/* ================= Kiểu dữ liệu ================= */

type Option = { key: string; text: string };

interface QuestionResult {
  question_id: string;
  question_text: string;
  question_type?: string | null;
  options?: Option[];
  selected_answer: string | string[] | null;
  correct_answer: string | string[];
  is_correct: boolean;
  earned_points: number;
  explanation: string | null;
  source_location?: {
    page_number: number | null;
    chunk_index: number | null;
    material_id: string | null;
    file_name?: string | null;
    content?: string | null;
  } | null;
}

interface WeakArea {
  topic_name?: string;
  hierarchy?: string;
  chapter?: string | null;
  description?: string;
  recommendation?: string;
  source_page?: number | null;
  pages?: number[];
  material_name?: string | null;
  question_numbers?: number[];
  wrong_count?: number;
}

interface StudyPlan {
  kind: "study_plan";
  tier?: string;
  minutes_per_day: number;
  days: number;
  advice?: string;
}

interface AIAssessment {
  id?: string;
  mastery_level?: string;
  summary?: string;
  verdict?: string;
  ai_model?: string;
  strengths?: (WeakArea | string)[] | null;
  weak_areas?: (WeakArea | string)[] | null;
  recommendations?: (string | StudyPlan)[] | null;
}

interface WeekDay {
  date: string;
  weekday: string;
  has_study: boolean;
  is_past: boolean;
  after_exam: boolean;
}

interface ReviewContext {
  study_session_id: string;
  topic_name?: string | null;
  chapter?: string | null;
  exam_plan_id?: string | null;
  subject_id?: string | null;
  exam_date?: string | null;
  scheduled_date?: string | null;
  day_number?: number | null;
  today: string;
  week: WeekDay[];
  is_retake?: boolean;
  /* "original" | "retake" | "final" (bài tổng hợp 20 câu) */
  attempt_kind?: "original" | "retake" | "final";
  review_level?: "intensive" | "relaxed" | "none";
  retake?: {
    review_plan_id: string;
    quiz_id: string;
    title: string;
    /* pending | in_progress | final_required | completed */
    status?: string | null;
    review_date?: string | null;
    final_quiz_id?: string | null;
    needs_attention?: boolean;
  } | null;
}

interface QuizResult {
  attempt_id: string;
  quiz_id: string;
  title: string;
  started_at?: string | null;
  submitted_at?: string | null;
  score: number;
  correct_count: number;
  total_questions: number;
  results: QuestionResult[];
  ai_assessment: AIAssessment | null;
  review_plan: { id: string } | null;
  review_context?: ReviewContext | null;
}

/* ================= Tiện ích ================= */

function dayMonth(dateKey?: string | null) {
  if (!dateKey) return "";
  const [, month, day] = dateKey.split("-");
  return `${day}/${month}`;
}

function weekdayLong(dateKey: string) {
  const label = new Date(`${dateKey}T00:00:00`).toLocaleDateString(currentLocale(), { weekday: "long" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/* "Kiểm tra lại ngày 2: ..." → "Kiểm tra lại ngày học 2: ..." */
function retakeLabel(title?: string | null) {
  return String(title || "").replace(/^Kiểm tra lại ngày (\d+)/i, tx("Kiểm tra lại ngày học $1"));
}

const LEVELS = {
  none: {
    label: tx("Nắm vững"),
    title: tx("Làm tốt lắm!"),
    text: tx("Bạn đã nắm vững bài này, không cần ôn lại. Cứ tiếp tục học theo lịch nhé."),
    ring: "border-emerald-300 bg-emerald-50",
    chip: "bg-emerald-600 text-white",
    score: "text-emerald-700",
  },
  relaxed: {
    label: tx("Cần ôn lại"),
    title: tx("Khá ổn, ôn thêm chút nữa"),
    text: tx("Bạn đã hiểu phần lớn bài học. Chọn một ngày trống trong tuần để ôn lại phần còn yếu rồi làm bài kiểm tra lại."),
    ring: "border-[#f3dc9a] bg-[var(--sp-amber-bg)]",
    chip: "bg-[var(--sp-yellow)] text-[var(--sp-purple-deep)]",
    score: "text-[var(--sp-amber-dark)]",
  },
  intensive: {
    label: tx("Ôn cấp tốc"),
    title: tx("Cần tập trung ôn lại ngay"),
    text: tx("Kết quả dưới 50% cho thấy bài này chưa vững. Hãy ôn cấp tốc trong tuần này trước khi học tiếp các bài sau."),
    ring: "border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)]",
    chip: "bg-[var(--sp-pink)] text-white",
    score: "text-[var(--sp-pink-dark)]",
  },
} as const;

/* ================= Trang ================= */

export default function QuizResultPage() {
  const params = useParams();
  const attemptId = params.attemptId as string;

  const [result, setResult] = useState<QuizResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [holdLoading, setHoldLoading] = useState(false);
  const [error, setError] = useState("");
  const [showWeak, setShowWeak] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reviewDate, setReviewDate] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [peek, setPeek] = useState<LessonPeekRequest | null>(null);
  const [jump, setJump] = useState<{ number: number; at: number } | null>(null);
  /* Đánh giá của Claude theo mức điểm (tạo một lần rồi lưu lại) */
  const [aiAssessment, setAiAssessment] = useState<AIAssessment | null>(null);
  const [assessState, setAssessState] = useState<{ state: "idle" | "loading" | "error"; message?: string }>({
    state: "idle",
  });
  const [retakeState, setRetakeState] = useState<{ state: "idle" | "creating" | "done" | "error"; message?: string }>({
    state: "idle",
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const response = await fetch(`${API_URL}/api/quiz-attempts/${attemptId}/result`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.detail || tx("Không thể tải kết quả bài kiểm tra."));
        if (!cancelled) {
          setResult(data);
          setReviewDate(data?.review_context?.retake?.review_date || null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : tx("Không thể tải kết quả."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attemptId, reloadKey]);

  /* Chưa có đánh giá của Claude → nhờ AI đánh giá theo mức điểm */
  useEffect(() => {
    if (!result) return;
    // Nhận xét thật của AI (Claude, hoặc Groq khi Claude lỗi); "Fallback" là câu mẫu → nhờ AI đánh giá
    if (["Claude", "Groq"].includes(String(result.ai_assessment?.ai_model || ""))) {
      setAiAssessment(result.ai_assessment);
      return;
    }
    if (assessState.state !== "idle" || aiAssessment) return;
    setAssessState({ state: "loading" });
    fetch(`${API_URL}/api/quiz-attempts/${attemptId}/assessment`, { method: "POST" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.detail || tx("AI chưa đánh giá được bài làm."));
        setAiAssessment(data?.data || null);
        setAssessState({ state: "idle" });
      })
      .catch((assessError) =>
        setAssessState({
          state: "error",
          message: assessError instanceof Error ? assessError.message : tx("AI chưa đánh giá được bài làm."),
        })
      );
  }, [result, attemptId, assessState.state, aiAssessment]);

  /* Lượt làm dưới 80% mà chưa có bài kiểm tra lại → tạo bù một lần */
  useEffect(() => {
    const context = result?.review_context;
    if (!result || !context || context.retake || context.attempt_kind === "final" || retakeState.state !== "idle") return;
    const score = result.total_questions
      ? (result.correct_count / result.total_questions) * 100
      : Number(result.score || 0);
    if (isPass(score)) return;

    setRetakeState({ state: "creating" });
    fetch(`${API_URL}/api/quiz-attempts/${attemptId}/ensure-retake`, { method: "POST" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.detail || tx("Chưa tạo được bài kiểm tra lại."));
        // "done": không tự gọi lại nữa, tránh vòng lặp nếu vẫn chưa đọc được bài
        setRetakeState({ state: "done" });
        setReloadKey((value) => value + 1);
      })
      .catch((createError) =>
        setRetakeState({
          state: "error",
          message: createError instanceof Error ? createError.message : tx("Chưa tạo được bài kiểm tra lại."),
        })
      );
  }, [result, attemptId, retakeState.state]);

  /* Làm bài xong → đồng hồ học của ngày đó về 0 (chỉ một lần cho mỗi lượt làm) */
  useEffect(() => {
    const context = result?.review_context;
    if (!context?.exam_plan_id || !context.scheduled_date) return;
    try {
      const flag = `sp-timer-reset:${attemptId}`;
      if (window.localStorage.getItem(flag)) return;
      window.localStorage.removeItem(`sp-study-time:${context.exam_plan_id}:${context.scheduled_date}`);
      window.localStorage.setItem(flag, "1");
    } catch {
      /* trình duyệt chặn lưu trữ: bỏ qua */
    }
  }, [result, attemptId]);

  const percent = useMemo(() => {
    if (!result) return 0;
    return result.total_questions
      ? Math.round((result.correct_count / result.total_questions) * 100)
      : Math.round(Number(result.score || 0));
  }, [result]);

  if ((loading && !result) || holdLoading) {
    return (
      <SmartLoading
        text={tx("Đang chấm và tổng hợp kết quả…")}
        sub={tx("Pilot đang chấm từng câu và tìm phần bạn còn yếu.")}
        stages={[tx("Nhận bài làm"), tx("Chấm từng câu"), tx("AI nhận xét"), tx("Tổng hợp")]}
        continueLabel={tx("Xem kết quả")}
        done={!(loading && !result)}
        onHoldChange={setHoldLoading}
      />
    );
  }

  if (error || !result) {
    return (
      <div className="sp-card mx-auto max-w-3xl p-8">
        <p className="text-sm font-medium text-[var(--sp-pink-dark)]">{error || tx("Không tìm thấy kết quả.")}</p>
        <Link href="/quizzes" className="sp-btn sp-btn-primary mt-5 px-5 py-2.5 text-sm">

          {tx("Về Kiểm tra kiến thức")}
        </Link>
      </div>
    );
  }

  const context = result.review_context || null;
  const levelKey = ({ pass: "none", mid: "relaxed", weak: "intensive" } as const)[scoreLevel(percent)];
  const isFinal = context?.attempt_kind === "final";
  const level = LEVELS[levelKey];
  const wrong = result.results.filter((item) => !item.is_correct);
  const assessment = aiAssessment || result.ai_assessment;
  const studyPlan = (assessment?.recommendations || []).find(
    (item): item is StudyPlan => typeof item === "object" && item?.kind === "study_plan"
  );
  const advices = (assessment?.recommendations || []).filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0
  );
  const strengths = (assessment?.strengths || [])
    .map((item) => (typeof item === "string" ? item : item.topic_name || item.description || ""))
    .filter(Boolean);
  const weakAreas = (assessment?.weak_areas || [])
    .map((item) => (typeof item === "string" ? { topic_name: item } : item))
    .filter((item) => item.topic_name || item.description);
  const retake = context?.retake || null;
  const reviewDatePassed = Boolean(reviewDate && context?.today && reviewDate < context.today);
  /* Chưa đạt 80% thì bắt buộc có ngày ôn sắp tới (quyết định 20/11/2026) */
  /* Bài ôn đã trượt → kế hoạch khoá, phải ôn lại + làm bài tổng hợp 20 câu (không chọn ngày) */
  const finalRequired = retake?.status === "final_required";
  const needsReviewDate =
    !isFinal &&
    levelKey !== "none" &&
    Boolean(retake) &&
    !["completed", "final_required"].includes(String(retake?.status)) &&
    (!reviewDate || reviewDatePassed);
  const materialsHref = context?.subject_id
    ? `/study-materials?subject=${encodeURIComponent(context.subject_id)}&session=${encodeURIComponent(context.study_session_id)}`
    : "/study-materials";
  const reviewModeHref = context?.subject_id ? `${materialsHref}&mode=review` : materialsHref;
  const dayLabel = context?.day_number ? tx("ngày {0}", [context.day_number]) : tx("bài học");
  const mistakes: Mistake[] =
    (assessment?.recommendations || [])
      .map((item) => item as unknown as { kind?: string; items?: Mistake[] })
      .find((item) => typeof item === "object" && item?.kind === "mistakes")?.items || [];
  const weakNumbers = new Set<number>(weakAreas.flatMap((item) => item.question_numbers || []));
  const minutesSpent =
    result.started_at && result.submitted_at
      ? Math.max(1, Math.round((new Date(result.submitted_at).getTime() - new Date(result.started_at).getTime()) / 60000))
      : null;
  const doneDate = result.submitted_at
    ? new Date(result.submitted_at).toLocaleDateString(currentLocale(), {
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "Asia/Ho_Chi_Minh",
      })
    : null;
  const subtitle = [
    context?.is_retake ? retakeLabel(result.title) : getMainTopicTitle(context?.topic_name || result.title),
    doneDate ? tx("làm {0}", [doneDate]) : null,
    tx("{0} câu{1}", [result.total_questions, minutesSpent ? tx(" trong {0} phút", [minutesSpent]) : ""]),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Đầu trang */}
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <nav className="flex items-center gap-1.5 text-sm font-medium text-[var(--sp-muted)]">
            <Link href="/quizzes" className="hover:text-[var(--sp-peri-dark)]">

              {tx("Kiểm tra kiến thức")}
            </Link>
            <IconChevronRight size={14} />
            <span className="text-[var(--sp-text-2)]">{tx("Kết quả")}</span>
          </nav>
          <h1 className="mt-2 flex items-end gap-3 text-[40px] leading-tight sm:text-[50px]">
            <span>
              {wrong.length > 0 ? (
                <>

                  {tx("Xem lại")} <span className="sp-squiggle">{tx("câu sai")}</span>
                </>
              ) : (
                <>

                  {tx("Kết quả")} <span className="sp-squiggle">{tx("bài làm")}</span>
                </>
              )}
            </span>
            <Sparkle size={24} className="sp-twinkle mb-3 text-[var(--sp-yellow)]" />
          </h1>
          <p className="mt-1 text-[15px] text-[var(--sp-muted)]">{subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => {
              setShowWeak(true);
              window.setTimeout(
                () => document.getElementById("weak-areas")?.scrollIntoView({ behavior: "smooth", block: "start" }),
                60
              );
            }}
            className="sp-btn sp-btn-secondary px-4 py-2.5 text-sm"
          >
            <IconTarget size={16} />

            {tx("Xem đánh giá điểm yếu")}
          </button>
          {finalRequired ? (
            <Link href={reviewModeHref} className="sp-btn sp-btn-primary px-4 py-2.5 text-sm">
              <IconRepeat size={16} />

              {tx("Ôn lại và làm bài tổng hợp 20 câu")}
            </Link>
          ) : !isFinal && retake && retake.status === "in_progress" ? (
            <Link href={`/quizzes/${retake.quiz_id}`} className="sp-btn sp-btn-primary px-4 py-2.5 text-sm">
              <IconRepeat size={16} />

              {tx("Làm lại câu sai")}
            </Link>
          ) : !isFinal && retake && retake.status !== "completed" ? (
            <Link href={materialsHref} className="sp-btn sp-btn-primary px-4 py-2.5 text-sm" title={tx("Trả lời Tự kiểm tra nhanh để mở bài kiểm tra lại")}>
              <IconRepeat size={16} />

              {tx("Ôn để làm lại câu sai")}
            </Link>
          ) : (
            <Link href="/quizzes" className="sp-btn sp-btn-primary px-4 py-2.5 text-sm">
              <IconArrowLeft size={16} />

              {tx("Danh sách bài kiểm tra")}
            </Link>
          )}
        </div>
      </section>

      {/* Bài kiểm tra lại chưa đạt: kế hoạch tạm khoá tới khi làm bài tổng hợp */}
      {finalRequired && !isFinal && (
        <section
          role="alert"
          className="rounded-[24px] border-2 border-[var(--sp-red)] bg-[var(--sp-red-bg)] px-5 py-4 shadow-[4px_4px_0_var(--sp-red-line)]"
        >
          <p className="flex items-center gap-2 font-bold text-[var(--sp-red-dark)]">
            <IconLock size={18} />
            {tx("Kế hoạch đang tạm khoá: bài kiểm tra lại chưa đạt 80%")}
          </p>
          <p className="mt-1 text-sm text-[var(--sp-text-2)]">
            {tx("Hãy ôn lại bài này ngay (trả lời các câu hỏi nhanh), rồi làm bài tổng hợp 20 câu gồm câu của bài gốc và bài kiểm tra lại. Làm xong, kế hoạch mở khoá.")}
          </p>
          <Link href={reviewModeHref} className="sp-btn sp-btn-primary mt-3 px-4 py-2.5 text-sm">
            {tx("Ôn lại ngay")}
            <IconArrowRight size={16} />
          </Link>
        </section>
      )}

      {/* Dưới 80%: bắt buộc chọn ngày ôn lại; không chặn việc học bài tiếp theo */}
      {needsReviewDate && (
        <section
          role="alert"
          className="rounded-[24px] border-2 border-[var(--sp-red)] bg-[var(--sp-red-bg)] px-5 py-4 shadow-[4px_4px_0_var(--sp-red-line)]"
        >
          <p className="flex items-center gap-2 font-bold text-[var(--sp-red-dark)]">
            <IconAlert size={18} />
            {reviewDatePassed
              ? tx("Ngày ôn đã qua mà bài này vẫn chưa đạt 80%: hãy chọn ngày ôn mới")
              : tx("Bạn chưa đạt 80% ở bài này: hãy chọn ngày ôn lại")}
          </p>
          <p className="mt-1 text-sm text-[var(--sp-text-2)]">

            {tx("Bắt buộc chọn một ngày để ôn lại phần còn yếu. Ngày này sẽ hiện trên lịch học và StudyPilot nhắc bạn vào hôm đó.")}
          </p>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="sp-btn sp-btn-primary mt-3 px-4 py-2.5 text-sm"
          >

            {tx("Chọn ngày ôn lại")}
          </button>
        </section>
      )}

      <WrongAnswerReview
        results={result.results}
        correct={result.correct_count}
        total={result.total_questions}
        percent={percent}
        levelLabel={level.label}
        levelChip={level.chip}
        chapter={context?.chapter}
        weakNumbers={weakNumbers}
        mistakes={mistakes}
        weakHints={weakAreas}
        onPeekLesson={setPeek}
        jump={jump}
      />

      {/* Đánh giá điểm yếu */}
      <section id="weak-areas" className="scroll-mt-6 overflow-hidden rounded-[24px] border-2 border-[var(--sp-purple-deep)] bg-white shadow-[6px_6px_0_var(--sp-lav-line)]">
        <button
          type="button"
          onClick={() => setShowWeak((value) => !value)}
          aria-expanded={showWeak}
          className={`grid w-full grid-cols-[56px_minmax(0,1fr)_40px] items-center gap-4 px-5 py-4 text-left sm:px-7 ${showWeak ? "border-b-2 border-dashed border-[var(--sp-line)]" : ""}`}
        >
          <PilotMascot size={56} happy={levelKey === "none"} />
          <span className="min-w-0">
            <span className="sp-accent block text-[16px] text-[var(--sp-pink)]">{tx("AI phân tích bài làm")}</span>
            <span className="block font-display text-[28px] leading-tight text-[var(--sp-purple)]">
              {levelKey === "none" ? tx("Nhận xét bài làm") : tx("Đánh giá điểm yếu")}
            </span>
          </span>
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border-2 border-[var(--sp-purple-deep)] bg-white text-[var(--sp-purple-deep)] shadow-[2px_2px_0_var(--sp-purple-deep)]">
            <IconChevronDown size={18} className={`transition ${showWeak ? "rotate-180" : ""}`} />
          </span>
        </button>

        {showWeak && (
          <div className="sp-task-expand grid gap-6 px-5 pb-7 pt-6 sm:px-7">
            {assessState.state === "loading" && !aiAssessment ? (
              <div className="flex items-center gap-3 rounded-2xl bg-[var(--sp-surface-2)] px-4 py-4 text-sm text-[var(--sp-muted)]">
                <Sparkle size={18} className="sp-twinkle shrink-0 text-[var(--sp-pink)]" />

                {tx("AI đang đọc từng câu bạn làm để nhận xét, mất khoảng 10–20 giây...")}
              </div>
            ) : (
              <>
                {assessState.state === "error" && !aiAssessment && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-[var(--sp-pink-line)] px-4 py-3">
                    <p className="text-sm text-[var(--sp-pink-dark)]">{assessState.message}</p>
                    <button
                      type="button"
                      onClick={() => setAssessState({ state: "idle" })}
                      className="sp-btn sp-btn-secondary px-3 py-1.5 text-[13px]"
                    >
                      <IconRepeat size={14} />

                      {tx("Thử lại")}
                    </button>
                  </div>
                )}

                {/* Nhận định chung: note vàng có băng dính */}
                {(assessment?.verdict || assessment?.summary) && (
                  <div className="relative grid grid-cols-[44px_minmax(0,1fr)] gap-3.5 rounded-[18px] border-2 border-[var(--sp-amber-line)] bg-[var(--sp-amber-bg)] px-4 py-4 sm:px-5">
                    <span aria-hidden className="absolute -top-2 left-1/2 h-4 w-[70px] -translate-x-1/2 -rotate-2 rounded-[3px] bg-[rgba(246,195,67,.55)]" />
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-yellow)] text-[var(--sp-purple-deep)]">
                      {levelKey === "none" ? <Sparkle size={18} /> : <IconBulb size={20} />}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[16px] font-bold text-[var(--sp-amber-dark)]">{assessment?.verdict || level.title}</p>
                      {assessment?.summary && (
                        <p className="mt-0.5 text-[14.5px] leading-relaxed text-[var(--sp-text-2)]">
                          {assessment.verdict ? assessment.summary.replace(assessment.verdict, "").trim() : assessment.summary}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Phần sai nhiều nhất */}
                {levelKey !== "none" && weakAreas.length > 0 && (
                  <div>
                    <h3 className="mb-3 flex items-center gap-2.5 text-[17px] text-[var(--sp-ink)]">
                      {tx("Bạn cần tập trung vào")}
                      <span aria-hidden className="h-0.5 flex-1 bg-[var(--sp-line)]" />
                    </h3>
                    <div className="grid gap-4 md:grid-cols-2">
                      {weakAreas.slice(0, 4).map((area, index) => {
                        const pages = area.pages?.length ? area.pages : area.source_page ? [area.source_page] : [];
                        const top = index === 0;
                        const numbers = area.question_numbers || [];
                        return (
                          <article
                            key={index}
                            className={`flex flex-col overflow-hidden rounded-[20px] border-2 border-[var(--sp-purple-deep)] bg-white ${
                              top ? "shadow-[4px_4px_0_var(--sp-pink-line)]" : "shadow-[4px_4px_0_var(--sp-lav-line)]"
                            }`}
                          >
                            <div
                              className={`grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-2.5 border-b-2 border-[var(--sp-purple-deep)] px-4 py-3 ${
                                top ? "bg-[var(--sp-pink-bg)]" : "bg-[var(--sp-lav)]"
                              }`}
                            >
                              <span
                                className={`flex h-[34px] w-[34px] items-center justify-center rounded-[10px] border-2 border-[var(--sp-purple-deep)] font-extrabold ${
                                  top ? "bg-[var(--sp-pink)] text-white" : "bg-[var(--sp-yellow)] text-[var(--sp-purple-deep)]"
                                }`}
                              >
                                {index + 1}
                              </span>
                              <div className="min-w-0">
                                <p className={`text-[11px] font-extrabold uppercase tracking-[0.14em] ${top ? "text-[var(--sp-pink-dark)]" : "text-[var(--sp-peri-dark)]"}`}>
                                  {top ? tx("Sai nhiều nhất") : tx("Cần củng cố")}
                                </p>
                                <h4 className="text-[15.5px] font-bold leading-snug text-[var(--sp-ink)]">
                                  {stripOutlineNumbers(area.topic_name || tx("Kiến thức cần củng cố"))}
                                </h4>
                              </div>
                              {numbers.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setJump({ number: numbers[0], at: Date.now() });
                                    document.getElementById("wrong-answers")?.scrollIntoView({ behavior: "smooth", block: "start" });
                                  }}
                                  title={tx("Xem câu sai này")}
                                  className="shrink-0 rounded-full border-2 border-[var(--sp-purple-deep)] bg-white px-2.5 py-0.5 text-[12px] font-extrabold text-[var(--sp-ink)] hover:bg-[var(--sp-yellow)]"
                                >
                                  {tx("Câu {0}", [numbers.join(", ")])} →
                                </button>
                              )}
                            </div>
                            <div className="grid flex-1 content-start gap-3 px-4 pb-4 pt-3.5">
                              {area.description && (
                                <p className="text-sm leading-relaxed text-[var(--sp-text-2)]">{area.description}</p>
                              )}
                              {area.recommendation && (
                                <p className="grid grid-cols-[22px_minmax(0,1fr)] gap-2 rounded-xl bg-[var(--sp-surface-2)] px-3 py-2.5 text-sm font-semibold leading-relaxed text-[var(--sp-purple)]">
                                  <span className="mt-px flex h-[22px] w-[22px] items-center justify-center rounded-[7px] bg-[var(--sp-peri)] text-white">
                                    <IconCheck size={12} />
                                  </span>
                                  {area.recommendation}
                                </p>
                              )}
                              {context?.study_session_id && (pages.length > 0 || area.topic_name) && (
                                <button
                                  type="button"
                                  aria-haspopup="dialog"
                                  onClick={(event) =>
                                    setPeek({
                                      query: [area.topic_name, area.description, area.recommendation].filter(Boolean).join("\n"),
                                      page: pages[0] ?? null,
                                      anchor: event.currentTarget,
                                    })
                                  }
                                  className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-xl border-2 border-dashed border-[var(--sp-lav-line)] bg-white px-2.5 py-2 text-left text-[12.5px] text-[var(--sp-muted)] hover:border-[var(--sp-peri)]"
                                >
                                  <span className="rounded-lg bg-[var(--sp-pink-bg)] px-2 py-0.5 text-[12px] font-extrabold text-[var(--sp-pink-dark)]">
                                    {pages.length ? `tr.${pages.join(", ")}` : <IconFile size={13} />}
                                  </span>
                                  <span className="truncate">{area.chapter || area.hierarchy || area.material_name || tx("Bài tóm tắt")}</span>
                                  <span className="font-extrabold text-[var(--sp-peri-dark)]">{tx("Xem tóm tắt")} ↗</span>
                                </button>
                              )}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                )}

                {(studyPlan || advices.length > 0) && (
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                    {/* Thời gian học đề xuất */}
                    {studyPlan && (
                      <div className="rounded-[20px] border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-lav)] px-5 py-[18px] shadow-[4px_4px_0_var(--sp-lav-line)]">
                        <p className="flex items-center gap-2 text-[11.5px] font-extrabold uppercase tracking-[0.14em] text-[var(--sp-peri-dark)]">
                          <IconCalendar size={14} />
                          {tx("Thời gian học đề xuất")}
                        </p>
                        <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
                          <b className="font-display text-[52px] font-normal leading-none text-[var(--sp-purple)]">{studyPlan.minutes_per_day}</b>
                          <span className="font-extrabold text-[var(--sp-purple)]">{tx("phút/ngày")}</span>
                          <span className="text-sm font-bold text-[var(--sp-text-2)]">{tx("× {0} ngày", [studyPlan.days])}</span>
                        </p>
                        {studyPlan.days > 0 && studyPlan.days <= 14 && (
                          <span aria-hidden className="my-3 flex gap-1.5">
                            {Array.from({ length: studyPlan.days }, (_, day) => (
                              <i key={day} className="h-2.5 flex-1 rounded-full border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-peri)]" />
                            ))}
                          </span>
                        )}
                        {studyPlan.advice && <p className="text-[13.5px] leading-relaxed text-[var(--sp-text-2)]">{studyPlan.advice}</p>}
                      </div>
                    )}

                    {/* Lời khuyên */}
                    {advices.length > 0 && (
                      <div className="rounded-[20px] border-2 border-[var(--sp-purple-deep)] bg-white px-5 py-[18px] shadow-[4px_4px_0_var(--sp-pink-line)]">
                        <p className="flex items-center gap-2 text-[11.5px] font-extrabold uppercase tracking-[0.14em] text-[var(--sp-pink-dark)]">
                          <Sparkle size={13} />
                          {levelKey === "none" ? tx("Để giữ phong độ") : tx("Lời khuyên")}
                        </p>
                        <ol className="mt-2.5 grid gap-2">
                          {advices.map((advice, index) => (
                            <li key={advice} className="grid grid-cols-[26px_minmax(0,1fr)] gap-2.5 text-sm leading-relaxed text-[var(--sp-text-2)]">
                              <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 border-[var(--sp-amber-line)] bg-[var(--sp-amber-bg)] text-[12px] font-extrabold text-[var(--sp-amber-dark)]">
                                {index + 1}
                              </span>
                              {advice}
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                  </div>
                )}

                {strengths.length > 0 && (
                  <div className="rounded-[18px] border-2 border-[#a7e3c4] bg-emerald-50 px-4 py-3.5 sm:px-5">
                    <p className="text-[11.5px] font-extrabold uppercase tracking-[0.14em] text-emerald-700">✓ {tx("Bạn đã làm tốt")}</p>
                    <ul className="mt-2 grid gap-2.5 md:grid-cols-3">
                      {strengths.map((item) => (
                        <li key={item} className="grid grid-cols-[22px_minmax(0,1fr)] gap-2 rounded-xl bg-white px-3 py-2.5 text-[13.5px] leading-normal text-emerald-800">
                          <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-emerald-500 text-white">
                            <IconCheck size={12} />
                          </span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </section>

      {/* Bài tổng hợp: buổi ôn hoàn thành ở mọi mức điểm, dưới 80% gắn cờ "cần chú ý" */}
      {isFinal && (
        <section
          className={`flex flex-col items-center rounded-[24px] border-2 px-6 py-7 text-center ${
            isPass(percent) ? "border-emerald-200 bg-emerald-50" : "border-[#fbbf77] bg-[#fff4e5]"
          }`}
        >
          <p className={`text-lg font-bold ${isPass(percent) ? "text-emerald-800" : "text-[#b45309]"}`}>
            {isPass(percent) ? tx("Buổi ôn đã hoàn thành") : tx("Buổi ôn hoàn thành · Cần chú ý")}
          </p>
          <p className="mt-1 max-w-xl text-sm text-[var(--sp-text-2)]">
            {isPass(percent)
              ? tx("Bạn đã nắm lại được phần này. Kế hoạch đã mở khoá, học tiếp bài theo lịch nhé.")
              : tx("Phần này vẫn chưa vững nên được đánh dấu cần chú ý trong Đánh giá năng lực. Kế hoạch đã mở khoá; hãy xem lại các câu sai và ôn thêm trước ngày thi.")}
          </p>
          <Link href={materialsHref} className="sp-btn sp-btn-primary mt-4 px-5 py-2.5 text-sm">
            {tx("Học bài tiếp theo")}
            <IconArrowRight size={16} />
          </Link>
        </section>
      )}

      {/* Lộ trình ôn lại */}
      {!isFinal && !finalRequired && levelKey !== "none" && context && (
        <RoadmapSection
          levelKey={levelKey}
          context={context}
          weakAreas={weakAreas}
          retake={retake}
          materialsHref={materialsHref}
          dayLabel={dayLabel}
          reviewDate={reviewDate}
          onPickDate={() => setPickerOpen(true)}
          retakeState={retakeState}
          onRetryRetake={() => setRetakeState({ state: "idle" })}
        />
      )}

      {!isFinal && levelKey === "none" && (
        <section className="flex flex-col items-center rounded-[24px] bg-[var(--sp-purple)] px-6 py-7 text-center text-white">
          <Sparkle size={24} className="sp-twinkle text-[var(--sp-yellow)]" />
          <p className="mt-2 text-lg font-bold">{tx("Không cần ôn lại bài này")}</p>
          <p className="mt-1 text-sm text-white/75">{tx("Giữ phong độ và tiếp tục với bài học tiếp theo trong kế hoạch.")}</p>
          <Link href={materialsHref} className="sp-btn mt-4 border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-yellow)] px-5 py-2.5 text-sm text-[var(--sp-purple-deep)]">

            {tx("Học bài tiếp theo")}
            <IconArrowRight size={16} />
          </Link>
        </section>
      )}

      {peek && context?.study_session_id && (
        <LessonPeek
          sessionId={context.study_session_id}
          dayLabel={context.day_number ? tx("Ngày {0}", [context.day_number]) : tx("Bài học")}
          lessonHref={materialsHref}
          request={peek}
          onClose={() => setPeek(null)}
        />
      )}

      {(pickerOpen || needsReviewDate) && context && retake && (
        <ReviewDayPicker
          context={context}
          reviewPlanId={retake.review_plan_id}
          initial={reviewDatePassed ? null : reviewDate}
          required={needsReviewDate}
          onClose={() => setPickerOpen(false)}
          onSaved={(value) => {
            setReviewDate(value);
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}

/* ================= Lộ trình ================= */

function RoadmapSection({
  levelKey,
  context,
  weakAreas,
  retake,
  materialsHref,
  dayLabel,
  reviewDate,
  onPickDate,
  retakeState,
  onRetryRetake,
}: {
  retakeState: { state: "idle" | "creating" | "done" | "error"; message?: string };
  onRetryRetake: () => void;
  levelKey: "intensive" | "relaxed";
  context: ReviewContext;
  weakAreas: WeakArea[];
  retake: ReviewContext["retake"];
  materialsHref: string;
  dayLabel: string;
  reviewDate: string | null;
  onPickDate: () => void;
}) {
  const intensive = levelKey === "intensive";
  const focus = weakAreas
    .slice(0, 2)
    .map((area) => stripOutlineNumbers(area.topic_name || ""))
    .filter(Boolean);
  const retakeOpen = retake?.status === "in_progress";
  const retakeDone = retake?.status === "completed";

  // Đọc lại và tự kiểm tra không lưu riêng: bài kiểm tra lại đã mở nghĩa là đã xong cả hai
  const steps = [
    {
      title: reviewDate
        ? tx("Ôn vào {0}, {1}", [weekdayLong(reviewDate), dayMonth(reviewDate)])
        : intensive
          ? tx("Chọn ngày ôn sớm nhất trong tuần")
          : tx("Chọn một ngày trống trong tuần để ôn"),
      text: intensive
        ? tx("Ôn cấp tốc: nên ôn ngay trong 1–2 ngày tới, trước khi học bài mới.")
        : tx("Ôn thư thả: chọn ngày còn trống trong tuần, không cần dồn gấp."),
      done: Boolean(reviewDate),
    },
    {
      title: tx("Đọc lại tóm tắt {0}", [dayLabel]),
      text: focus.length
        ? tx("Tập trung vào: {0}.", [focus.join(" · ")])
        : tx("Đọc lại các ý chính và công thức của bài."),
      done: retakeOpen || retakeDone,
    },
    {
      title: tx("Trả lời Tự kiểm tra nhanh"),
      text: tx("Trả lời xong các câu ôn nhanh cạnh nội dung bài để mở bài kiểm tra lại."),
      done: retakeOpen || retakeDone,
    },
    {
      title: retakeLabel(retake?.title) || retakeLabel(tx("Kiểm tra lại {0}", [dayLabel])),
      text: tx("{0} Cần đạt từ 80%, làm lại bao nhiêu lần cũng được.", [intensive
          ? tx("30% trắc nghiệm, 70% điền vào chỗ trống.")
          : tx("Toàn bộ trắc nghiệm.")]),
      done: retakeDone,
    },
  ];
  const current = steps.findIndex((step) => !step.done);
  const progress = current === -1 ? steps.length - 1 : current;
  const accentShadow = intensive ? "var(--sp-pink-line)" : "var(--sp-amber-line)";

  return (
    <section className="overflow-hidden rounded-[24px] border-2 border-[var(--sp-purple-deep)] bg-white shadow-[6px_6px_0_var(--sp-lav-line)]">
      <div className="grid gap-3 px-5 pb-1 pt-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-7">
        <div>
          <span
            className={`inline-flex rounded-full border-2 px-2.5 py-0.5 text-[12px] font-extrabold ${
              intensive
                ? "border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]"
                : "border-[var(--sp-amber-line)] bg-[var(--sp-amber-bg)] text-[var(--sp-amber-dark)]"
            }`}
          >
            {intensive ? tx("Dưới 50% · cần tập trung") : tx("50–79% · ôn nhẹ nhàng")}
          </span>
          <h2 className="mt-2 text-[28px] leading-tight text-[var(--sp-purple)]">
            <span className="font-display font-normal">{intensive ? tx("Lộ trình ôn cấp tốc") : tx("Lộ trình ôn thư thả")}</span>
          </h2>
        </div>
        <button
          type="button"
          onClick={onPickDate}
          disabled={!retake}
          className="sp-btn sp-btn-primary w-fit px-4 py-2.5 text-sm disabled:opacity-50"
        >
          <IconCalendar size={16} />
          {!retake
            ? tx("Chờ tạo bài kiểm tra lại…")
            : reviewDate
              ? tx("Đổi ngày ôn ({0})", [dayMonth(reviewDate)])
              : tx("Chọn ngày ôn lại")}
        </button>
      </div>

      {/* Đường đi 4 chặng, giống dải đường bay dưới đáy trang */}
      <ol className="relative grid gap-4 px-5 pb-5 pt-8 sm:grid-cols-4 sm:px-7">
        <span aria-hidden className="absolute left-[calc(1.75rem+12.5%-8px)] right-[calc(1.75rem+12.5%-8px)] top-[52px] hidden border-t-[3px] border-dashed border-[var(--sp-lav-line)] sm:block" />
        <span
          aria-hidden
          className="absolute left-[calc(1.75rem+12.5%-8px)] top-[51px] hidden h-[5px] rounded-full bg-emerald-500 sm:block"
          style={{ width: `calc((100% - 3.5rem) * ${progress / 4})` }}
        />
        {steps.map((step, index) => {
          const state = step.done ? "done" : index === current ? "now" : "later";
          return (
            <li key={index} className="relative grid justify-items-center gap-2.5 text-center max-sm:grid-cols-[44px_minmax(0,1fr)] max-sm:items-start max-sm:text-left">
              {state === "now" && (
                <span className="absolute -top-6 whitespace-nowrap text-[11px] font-extrabold text-[var(--sp-pink)] max-sm:hidden">
                  {tx("Bạn ở đây")} ▾
                </span>
              )}
              <span
                className={`relative z-[1] flex h-11 w-11 items-center justify-center rounded-[14px] border-2 text-base font-extrabold ${
                  state === "done"
                    ? "border-[var(--sp-purple-deep)] bg-emerald-500 text-white"
                    : state === "now"
                      ? "border-[var(--sp-purple-deep)] bg-[var(--sp-yellow)] text-[var(--sp-purple-deep)] shadow-[3px_3px_0_var(--sp-purple-deep)]"
                      : "border-[var(--sp-soft)] bg-[var(--sp-surface-2)] text-[var(--sp-soft)]"
                }`}
              >
                {state === "done" ? <IconCheck size={18} /> : index + 1}
              </span>
              <div
                className={`h-full w-full rounded-2xl border-2 px-3.5 py-3 text-left sm:min-h-[118px] ${
                  state === "done"
                    ? "border-[#a7e3c4] bg-emerald-50"
                    : state === "now"
                      ? "border-[var(--sp-purple-deep)] bg-white"
                      : "border-[var(--sp-line)] bg-white"
                }`}
                style={state === "now" ? { boxShadow: `4px 4px 0 ${accentShadow}` } : undefined}
              >
                <p className="text-[14.5px] font-bold leading-snug text-[var(--sp-ink)]">{step.title}</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--sp-muted)]">{step.text}</p>
              </div>
            </li>
          );
        })}
      </ol>

      {/* Vé bài kiểm tra lại */}
      <div
        className={`mx-5 mb-6 grid gap-4 rounded-[18px] border-2 px-4 py-3.5 sm:mx-7 sm:grid-cols-[52px_minmax(0,1fr)_auto] sm:items-center ${
          retakeOpen ? "border-[var(--sp-purple-deep)] bg-emerald-50" : "border-dashed border-[var(--sp-soft)] bg-[var(--sp-surface-2)]"
        }`}
      >
        <span
          className={`flex h-[52px] w-[52px] items-center justify-center rounded-[14px] border-2 bg-white ${
            retakeOpen ? "border-[var(--sp-purple-deep)] text-emerald-600" : "border-[var(--sp-soft)] text-[var(--sp-muted)]"
          }`}
        >
          {retakeOpen ? <IconRepeat size={22} /> : <IconLock size={22} />}
        </span>
        <div className="min-w-0">
          <p className="text-[15.5px] font-bold text-[var(--sp-ink)]">
            {retakeLabel(retake?.title) || (retakeState.state === "error" ? tx("Chưa tạo được bài kiểm tra lại") : tx("Đang tạo bài kiểm tra lại…"))}
          </p>
          <p className={`mt-0.5 text-[13px] ${retakeState.state === "error" && !retake ? "text-[var(--sp-pink-dark)]" : "text-[var(--sp-muted)]"}`}>
            {!retake
              ? retakeState.state === "error"
                ? retakeState.message
                : retakeState.state === "done"
                  ? tx("Bài kiểm tra lại đã được tạo, tải lại trang để xem.")
                  : tx("AI đang soạn câu hỏi, mất khoảng 10–30 giây.")
              : retakeOpen
                ? tx("Đã mở. Bạn có thể làm bài kiểm tra lại ngay.")
                : retakeDone
                  ? tx("Đã đạt. Phần này không cần ôn thêm.")
                  : tx("Đang khóa, mở khi xong các việc:")}
          </p>
          {retake && !retakeOpen && !retakeDone && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {[
                { label: tx("Đã chọn ngày ôn"), todo: tx("Chọn ngày ôn"), ok: Boolean(reviewDate) },
                { label: tx("Trả lời Tự kiểm tra nhanh"), todo: tx("Trả lời Tự kiểm tra nhanh"), ok: false },
              ].map((need) => (
                <span
                  key={need.todo}
                  className={`rounded-full border-[1.5px] px-2.5 py-0.5 text-[11.5px] font-bold ${
                    need.ok ? "border-[#a7e3c4] bg-emerald-50 text-emerald-700" : "border-[var(--sp-line)] bg-white text-[var(--sp-muted)]"
                  }`}
                >
                  {need.ok ? `✓ ${need.label}` : `○ ${need.todo}`}
                </span>
              ))}
            </div>
          )}
        </div>
        {!retake && retakeState.state === "error" ? (
          <button type="button" onClick={onRetryRetake} className="sp-btn sp-btn-secondary w-fit shrink-0 px-4 py-2.5 text-sm">
            <IconRepeat size={15} />

            {tx("Thử tạo lại")}
          </button>
        ) : retake && retakeOpen ? (
          <Link href={`/quizzes/${retake.quiz_id}`} className="sp-btn sp-btn-primary w-fit shrink-0 px-4 py-2.5 text-sm">

            {tx("Làm bài kiểm tra lại")}
            <IconArrowRight size={15} />
          </Link>
        ) : !retakeDone ? (
          <Link href={materialsHref} className="sp-btn sp-btn-primary w-fit shrink-0 px-4 py-2.5 text-sm">
            <IconBook size={15} />

            {tx("Học lại & tự kiểm tra")}
          </Link>
        ) : null}
      </div>
      {context.exam_date && (
        <p className="sr-only">{tx("Ngày thi {0}", [dayMonth(context.exam_date)])}</p>
      )}
    </section>
  );
}

/* ================= Bảng chọn ngày ôn ================= */

function ReviewDayPicker({
  context,
  reviewPlanId,
  initial,
  onClose,
  onSaved,
  required = false,
}: {
  context: ReviewContext;
  reviewPlanId: string;
  initial: string | null;
  /* Bắt buộc chọn: không đóng được khi chưa lưu ngày */
  required?: boolean;
  onClose: () => void;
  onSaved: (value: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const available = context.week.filter((day) => !day.is_past && !day.after_exam);
  // Không còn ngày nào để chọn thì không khóa hộp thoại, tránh kẹt người học
  required = required && available.length > 0;

  useEffect(() => {
    if (required) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, required]);

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${API_URL}/api/review-plans/${reviewPlanId}/review-date`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ review_date: selected }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.detail || tx("Không thể lưu ngày ôn lại."));
      onSaved(selected);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : tx("Không thể lưu ngày ôn lại."));
    } finally {
      setSaving(false);
    }
  };

  const lastChoosable = available[available.length - 1]?.date;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tx("Chọn ngày ôn lại")}
      className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--sp-purple-deep)]/45 p-3 sm:items-center"
      onClick={required ? undefined : onClose}
    >
      <div
        className="sp-task-expand max-h-[92vh] w-full max-w-[560px] overflow-y-auto rounded-[24px] border-2 border-[var(--sp-purple)] bg-white p-5 shadow-[6px_6px_0_var(--sp-lav-line)] sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="sp-accent text-[16px] text-[var(--sp-pink)]">
              {lastChoosable
                ? tx("Từ hôm nay đến {0} (trước ngày thi)", [dayMonth(lastChoosable)])
                : tx("Trước ngày thi")}
            </p>
            <h2 className="text-[22px] text-[var(--sp-ink)]">{tx("Chọn ngày ôn lại")}</h2>
            <p className="mt-1 text-sm text-[var(--sp-muted)]">
              {required ? tx("Bắt buộc chọn để tiếp tục. ") : ""}

              {tx("Được chọn cả ngày đã có lịch học: hãy xem ngày nào còn trống để chọn cho phù hợp.")}
            </p>
          </div>
          {!required && (
            <button
              type="button"
              onClick={onClose}
              aria-label={tx("Đóng")}
              className="rounded-xl p-2 text-[var(--sp-muted)] hover:bg-[var(--sp-surface-2)]"
            >
              <IconX size={18} />
            </button>
          )}
        </div>

        <div className="mt-5 grid grid-cols-7 gap-1.5 sm:gap-2">
          {context.week.map((day) => {
            const isLesson = day.date === context.scheduled_date;
            const disabled = day.is_past || day.after_exam;
            const isSelected = selected === day.date;
            const isToday = day.date === context.today;
            return (
              <button
                key={day.date}
                type="button"
                disabled={disabled}
                onClick={() => setSelected(day.date)}
                aria-pressed={isSelected}
                title={
                  day.is_past
                    ? tx("Ngày đã qua")
                    : day.after_exam
                      ? tx("Từ ngày thi trở đi")
                      : day.has_study
                        ? tx("Có lịch học: vẫn chọn được, ôn thêm sau buổi học")
                        : tx("Trống lịch")
                }
                className={`relative flex flex-col items-center rounded-2xl border-2 px-1 py-2.5 transition ${
                  isSelected
                    ? "border-[var(--sp-purple)] bg-[var(--sp-pink)] text-white shadow-[3px_3px_0_var(--sp-purple-deep)]"
                    : disabled
                      ? "cursor-not-allowed border-transparent bg-[var(--sp-surface-2)] text-[var(--sp-soft)]"
                      : day.has_study
                        ? "border-[var(--sp-lav-line)] bg-[var(--sp-lav)] text-[var(--sp-peri-dark)] hover:border-[var(--sp-pink)]"
                        : "border-[var(--sp-line)] bg-white text-[var(--sp-ink)] hover:border-[var(--sp-pink)]"
                }`}
              >
                {isToday && (
                  <span className="absolute -top-2 rounded-full bg-[var(--sp-purple)] px-1.5 text-[9px] font-bold text-white">

                    {tx("Hôm nay")}
                  </span>
                )}
                <span className="text-[11px] font-bold uppercase">{day.weekday}</span>
                <span className="text-[17px] font-extrabold">{dayMonth(day.date).slice(0, 2)}</span>
                <span className="mt-0.5 h-1.5 w-1.5 rounded-full">
                  {isLesson ? (
                    <span className="block h-1.5 w-1.5 rounded-full bg-[var(--sp-pink)]" />
                  ) : day.has_study ? (
                    <span className="block h-1.5 w-1.5 rounded-full bg-[var(--sp-peri)]" />
                  ) : null}
                </span>
                {!disabled && (
                  <span className="mt-1 text-[9.5px] font-semibold leading-none">
                    {day.has_study ? tx("Có lịch") : tx("Trống")}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] text-[var(--sp-text-2)]">
          <li className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded border-2 border-[var(--sp-lav-line)] bg-[var(--sp-lav)]" />

            {tx("Có lịch học (vẫn chọn được)")}
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[var(--sp-pink)]" />

            {tx("Ngày học bài này")}
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-[var(--sp-surface-2)]" />

            {tx("Đã qua / từ ngày thi")}
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded border-2 border-[var(--sp-line)] bg-white" />

            {tx("Trống lịch")}
          </li>
        </ul>

        {available.length === 0 && (
          <p className="mt-4 rounded-2xl bg-[var(--sp-amber-bg)] px-4 py-3 text-sm text-[var(--sp-amber-dark)]">

            {tx("Không còn ngày nào trước ngày thi để chọn. Hãy ôn ngay hôm nay bằng nút Học lại & tự kiểm tra.")}
          </p>
        )}
        {error && <p className="mt-3 text-sm font-medium text-[var(--sp-pink-dark)]">{error}</p>}

        <div className="mt-5 flex items-center justify-between gap-3">
          <p className="text-sm text-[var(--sp-muted)]">
            {selected ? tx("Đã chọn: {0}, {1}", [weekdayLong(selected), dayMonth(selected)]) : tx("Chưa chọn ngày")}
          </p>
          <button
            type="button"
            disabled={!selected || saving}
            onClick={save}
            className="sp-btn sp-btn-primary px-5 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? tx("Đang lưu...") : tx("Lưu ngày ôn")}
          </button>
        </div>
      </div>
    </div>
  );
}

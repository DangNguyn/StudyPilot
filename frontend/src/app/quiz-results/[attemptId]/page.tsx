"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getMainTopicTitle, stripOutlineNumbers } from "@/lib/content-titles";
import WrongAnswerReview, { type Mistake } from "@/components/wrong-answer-review";
import {
  IconAlert,
  IconArrowLeft,
  IconArrowRight,
  IconBook,
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
  review_level?: "intensive" | "relaxed" | "none";
  retake?: {
    review_plan_id: string;
    quiz_id: string;
    title: string;
    status?: string | null;
    review_date?: string | null;
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
  const label = new Date(`${dateKey}T00:00:00`).toLocaleDateString("vi-VN", { weekday: "long" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/* "Kiểm tra lại ngày 2: ..." → "Kiểm tra lại ngày học 2: ..." */
function retakeLabel(title?: string | null) {
  return String(title || "").replace(/^Kiểm tra lại ngày (\d+)/i, "Kiểm tra lại ngày học $1");
}

const LEVELS = {
  none: {
    label: "Nắm vững",
    title: "Làm tốt lắm!",
    text: "Bạn đã nắm vững bài này, không cần ôn lại. Cứ tiếp tục học theo lịch nhé.",
    ring: "border-emerald-300 bg-emerald-50",
    chip: "bg-emerald-600 text-white",
    score: "text-emerald-700",
  },
  relaxed: {
    label: "Cần ôn lại",
    title: "Khá ổn, ôn thêm chút nữa",
    text: "Bạn đã hiểu phần lớn bài học. Chọn một ngày trống trong tuần để ôn lại phần còn yếu rồi làm bài kiểm tra lại.",
    ring: "border-[#f3dc9a] bg-[var(--sp-amber-bg)]",
    chip: "bg-[var(--sp-yellow)] text-[var(--sp-purple-deep)]",
    score: "text-[var(--sp-amber-dark)]",
  },
  intensive: {
    label: "Ôn cấp tốc",
    title: "Cần tập trung ôn lại ngay",
    text: "Kết quả dưới 50% cho thấy bài này chưa vững. Hãy ôn cấp tốc trong tuần này trước khi học tiếp các bài sau.",
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
  const [error, setError] = useState("");
  const [showWeak, setShowWeak] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  /* "Để sau": chỉ ẩn khối nhắc; ngày ôn chưa chọn vẫn được lưu là trống để nhắc lại sau */
  const [reviewPromptDismissed, setReviewPromptDismissed] = useState(false);
  const [reviewDate, setReviewDate] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
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
        if (!response.ok) throw new Error(data?.detail || "Không thể tải kết quả bài kiểm tra.");
        if (!cancelled) {
          setResult(data);
          setReviewDate(data?.review_context?.retake?.review_date || null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Không thể tải kết quả.");
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
    if (result.ai_assessment?.ai_model === "Claude") {
      setAiAssessment(result.ai_assessment);
      return;
    }
    if (assessState.state !== "idle" || aiAssessment) return;
    setAssessState({ state: "loading" });
    fetch(`${API_URL}/api/quiz-attempts/${attemptId}/assessment`, { method: "POST" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.detail || "AI chưa đánh giá được bài làm.");
        setAiAssessment(data?.data || null);
        setAssessState({ state: "idle" });
      })
      .catch((assessError) =>
        setAssessState({
          state: "error",
          message: assessError instanceof Error ? assessError.message : "AI chưa đánh giá được bài làm.",
        })
      );
  }, [result, attemptId, assessState.state, aiAssessment]);

  /* Lượt làm dưới 80% mà chưa có bài kiểm tra lại → tạo bù một lần */
  useEffect(() => {
    const context = result?.review_context;
    if (!result || !context || context.retake || retakeState.state !== "idle") return;
    const score = result.total_questions
      ? (result.correct_count / result.total_questions) * 100
      : Number(result.score || 0);
    if (score >= 80) return;

    setRetakeState({ state: "creating" });
    fetch(`${API_URL}/api/quiz-attempts/${attemptId}/ensure-retake`, { method: "POST" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.detail || "Chưa tạo được bài kiểm tra lại.");
        // "done": không tự gọi lại nữa, tránh vòng lặp nếu vẫn chưa đọc được bài
        setRetakeState({ state: "done" });
        setReloadKey((value) => value + 1);
      })
      .catch((createError) =>
        setRetakeState({
          state: "error",
          message: createError instanceof Error ? createError.message : "Chưa tạo được bài kiểm tra lại.",
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

  if (loading && !result) {
    return (
      <div className="sp-card mx-auto max-w-5xl p-10 text-center text-[var(--sp-muted)]">
        <Sparkle size={22} className="sp-twinkle mx-auto mb-3 text-[var(--sp-pink)]" />
        Đang chấm và tổng hợp kết quả...
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className="sp-card mx-auto max-w-3xl p-8">
        <p className="text-sm font-medium text-[var(--sp-pink-dark)]">{error || "Không tìm thấy kết quả."}</p>
        <Link href="/quizzes" className="sp-btn sp-btn-primary mt-5 px-5 py-2.5 text-sm">
          Về Kiểm tra kiến thức
        </Link>
      </div>
    );
  }

  const context = result.review_context || null;
  const levelKey = percent >= 80 ? "none" : percent >= 50 ? "relaxed" : "intensive";
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
  const materialsHref = context?.subject_id
    ? `/study-materials?subject=${encodeURIComponent(context.subject_id)}&session=${encodeURIComponent(context.study_session_id)}`
    : "/study-materials";
  const dayLabel = context?.day_number ? `ngày ${context.day_number}` : "bài học";
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
    ? new Date(result.submitted_at).toLocaleDateString("vi-VN", {
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "Asia/Ho_Chi_Minh",
      })
    : null;
  const subtitle = [
    context?.is_retake ? retakeLabel(result.title) : getMainTopicTitle(context?.topic_name || result.title),
    doneDate ? `làm ${doneDate}` : null,
    `${result.total_questions} câu${minutesSpent ? ` trong ${minutesSpent} phút` : ""}`,
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
              Kiểm tra kiến thức
            </Link>
            <IconChevronRight size={14} />
            <span className="text-[var(--sp-text-2)]">Kết quả</span>
          </nav>
          <h1 className="mt-2 flex items-end gap-3 text-[40px] leading-tight sm:text-[50px]">
            <span>
              {wrong.length > 0 ? (
                <>
                  Xem lại <span className="sp-squiggle">câu sai</span>
                </>
              ) : (
                <>
                  Kết quả <span className="sp-squiggle">bài làm</span>
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
            Xem đánh giá điểm yếu
          </button>
          {retake && retake.status === "in_progress" ? (
            <Link href={`/quizzes/${retake.quiz_id}`} className="sp-btn sp-btn-primary px-4 py-2.5 text-sm">
              <IconRepeat size={16} />
              Làm lại câu sai
            </Link>
          ) : retake && retake.status !== "completed" ? (
            <Link href={materialsHref} className="sp-btn sp-btn-primary px-4 py-2.5 text-sm" title="Trả lời Tự kiểm tra nhanh để mở bài kiểm tra lại">
              <IconRepeat size={16} />
              Ôn để làm lại câu sai
            </Link>
          ) : (
            <Link href="/quizzes" className="sp-btn sp-btn-primary px-4 py-2.5 text-sm">
              <IconArrowLeft size={16} />
              Danh sách bài kiểm tra
            </Link>
          )}
        </div>
      </section>

      {/* Dưới 80%: yêu cầu chọn một buổi ôn lại, cho phép để sau, không chặn bài tiếp theo */}
      {levelKey !== "none" && retake && retake.status !== "completed" && !reviewDate && !reviewPromptDismissed && (
        <section
          role="alert"
          className="rounded-[24px] border-2 border-amber-300 bg-amber-50 px-5 py-4"
        >
          <p className="flex items-center gap-2 font-bold text-amber-900">
            <IconAlert size={18} />
            Bạn chưa đạt 80% ở bài này: hãy chọn một buổi để ôn lại
          </p>
          <p className="mt-1 text-sm text-amber-900/80">
            Chọn ngày bạn sẽ ôn lại phần kiến thức còn yếu. StudyPilot sẽ dựa vào ngày này để nhắc bạn.
            Bạn vẫn có thể học bài tiếp theo ngay bây giờ.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="sp-btn sp-btn-primary px-4 py-2.5 text-sm"
            >
              Chọn ngày ôn lại
            </button>
            <button
              type="button"
              onClick={() => setReviewPromptDismissed(true)}
              className="sp-btn sp-btn-secondary px-4 py-2.5 text-sm"
            >
              Để sau
            </button>
          </div>
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
        materialsHref={materialsHref}
      />

      {/* Đánh giá điểm yếu */}
      <section id="weak-areas" className="sp-card scroll-mt-6 p-5 sm:p-7">
        <button
          type="button"
          onClick={() => setShowWeak((value) => !value)}
          aria-expanded={showWeak}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <span>
            <span className="sp-accent block text-[16px] text-[var(--sp-pink)]">AI phân tích bài làm</span>
            <span className="block text-[22px] font-bold text-[var(--sp-ink)]">
              {levelKey === "none" ? "Nhận xét bài làm" : "Đánh giá điểm yếu"}
            </span>
          </span>
          <IconChevronDown size={20} className={`shrink-0 text-[var(--sp-muted)] transition ${showWeak ? "rotate-180" : ""}`} />
        </button>

        {showWeak && (
          <div className="sp-task-expand mt-4 space-y-4">
            {assessState.state === "loading" && !aiAssessment ? (
              <div className="flex items-center gap-3 rounded-2xl bg-[var(--sp-surface-2)] px-4 py-4 text-sm text-[var(--sp-muted)]">
                <Sparkle size={18} className="sp-twinkle shrink-0 text-[var(--sp-pink)]" />
                AI đang đọc từng câu bạn làm để nhận xét, mất khoảng 10–20 giây...
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
                      Thử lại
                    </button>
                  </div>
                )}

                {/* Nhận định chung theo mức điểm */}
                {(assessment?.verdict || assessment?.summary) && (
                  <div className={`rounded-2xl border-2 px-4 py-3.5 ${level.ring}`}>
                    <p className={`flex items-center gap-2 font-bold ${level.score}`}>
                      {levelKey === "none" ? <Sparkle size={16} /> : <IconAlert size={16} />}
                      {assessment?.verdict || level.title}
                    </p>
                    {assessment?.summary && (
                      <p className="mt-1 text-[15px] leading-6 text-[var(--sp-text-2)]">
                        {assessment.verdict
                          ? assessment.summary.replace(assessment.verdict, "").trim()
                          : assessment.summary}
                      </p>
                    )}
                  </div>
                )}

                {/* Phần sai nhiều nhất */}
                {levelKey !== "none" && weakAreas.length > 0 && (
                  <div>
                    <h3 className="mb-2.5 text-[16px] text-[var(--sp-ink)]">Bạn cần tập trung vào</h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {weakAreas.slice(0, 4).map((area, index) => {
                        const pages = area.pages?.length ? area.pages : area.source_page ? [area.source_page] : [];
                        const where = [
                          pages.length ? `trang ${pages.join(", ")}` : "",
                          area.chapter || area.hierarchy ? String(area.chapter || area.hierarchy) : "",
                          area.material_name ? `tài liệu ${area.material_name}` : "",
                        ].filter(Boolean);
                        return (
                          <article
                            key={index}
                            className={`rounded-2xl border-2 p-4 ${
                              index === 0 ? "border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)]" : "border-[var(--sp-line)] bg-white"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-xs font-bold uppercase tracking-wide text-[var(--sp-pink-dark)]">
                                {index === 0 ? "Sai nhiều nhất" : `Cần củng cố ${index + 1}`}
                              </p>
                              {area.question_numbers?.length ? (
                                <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-[var(--sp-pink-dark)]">
                                  Sai câu {area.question_numbers.join(", ")}
                                </span>
                              ) : null}
                            </div>
                            <h4 className="mt-1.5 text-[16px] font-bold text-[var(--sp-ink)]">
                              {stripOutlineNumbers(area.topic_name || "Kiến thức cần củng cố")}
                            </h4>
                            {area.description && (
                              <p className="mt-1 text-sm leading-6 text-[var(--sp-text-2)]">{area.description}</p>
                            )}
                            {area.recommendation && (
                              <p className="mt-1.5 flex gap-1.5 text-sm font-semibold leading-6 text-[var(--sp-purple)]">
                                <IconArrowRight size={14} className="mt-1.5 shrink-0" />
                                {area.recommendation}
                              </p>
                            )}
                            {where.length > 0 && (
                              <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-white/80 px-2.5 py-1.5 text-[12.5px] text-[var(--sp-peri-dark)]">
                                <IconFile size={13} className="mt-0.5 shrink-0" />
                                <span>Xem lại {where.join(" · ")}</span>
                              </p>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  {/* Thời gian học đề xuất */}
                  {studyPlan && (
                    <div className="rounded-2xl border-2 border-[var(--sp-lav-line)] bg-[var(--sp-lav)] p-4">
                      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[var(--sp-peri-dark)]">
                        <IconCalendar size={14} />
                        Thời gian học đề xuất
                      </p>
                      <p className="mt-1.5 text-[24px] font-extrabold text-[var(--sp-purple)]">
                        {studyPlan.minutes_per_day} phút/ngày
                        <span className="ml-1.5 text-[15px] font-semibold text-[var(--sp-text-2)]">
                          × {studyPlan.days} ngày
                        </span>
                      </p>
                      {studyPlan.advice && (
                        <p className="mt-1 text-sm leading-6 text-[var(--sp-text-2)]">{studyPlan.advice}</p>
                      )}
                    </div>
                  )}

                  {/* Lời khuyên */}
                  {advices.length > 0 && (
                    <div className="rounded-2xl border-2 border-[var(--sp-line)] bg-white p-4">
                      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[var(--sp-pink-dark)]">
                        <Sparkle size={13} />
                        {levelKey === "none" ? "Để giữ phong độ" : "Lời khuyên"}
                      </p>
                      <ul className="mt-2 space-y-1.5">
                        {advices.map((advice) => (
                          <li key={advice} className="flex gap-2 text-sm leading-6 text-[var(--sp-text-2)]">
                            <IconCheck size={14} className="mt-1.5 shrink-0 text-emerald-600" />
                            {advice}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {strengths.length > 0 && (
                  <p className="flex flex-wrap items-center gap-2 text-sm text-emerald-800">
                    <span className="font-bold">Bạn đã làm tốt:</span>
                    {strengths.map((item) => (
                      <span key={item} className="rounded-full bg-emerald-50 px-2.5 py-0.5">
                        {item}
                      </span>
                    ))}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </section>

      {/* Lộ trình ôn lại */}
      {levelKey !== "none" && context && (
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

      {levelKey === "none" && (
        <section className="flex flex-col items-center rounded-[24px] bg-[var(--sp-purple)] px-6 py-7 text-center text-white">
          <Sparkle size={24} className="sp-twinkle text-[var(--sp-yellow)]" />
          <p className="mt-2 text-lg font-bold">Không cần ôn lại bài này</p>
          <p className="mt-1 text-sm text-white/75">Giữ phong độ và tiếp tục với bài học tiếp theo trong kế hoạch.</p>
          <Link href={materialsHref} className="sp-btn mt-4 border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-yellow)] px-5 py-2.5 text-sm text-[var(--sp-purple-deep)]">
            Học bài tiếp theo
            <IconArrowRight size={16} />
          </Link>
        </section>
      )}

      {pickerOpen && context && retake && (
        <ReviewDayPicker
          context={context}
          reviewPlanId={retake.review_plan_id}
          initial={reviewDate}
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

  const steps = [
    {
      title: reviewDate
        ? `Ôn vào ${weekdayLong(reviewDate)}, ${dayMonth(reviewDate)}`
        : intensive
          ? "Chọn ngày ôn sớm nhất trong tuần"
          : "Chọn một ngày trống trong tuần để ôn",
      text: intensive
        ? "Ôn cấp tốc: nên ôn ngay trong 1–2 ngày tới, trước khi học bài mới."
        : "Ôn thư thả: chọn ngày còn trống trong tuần, không cần dồn gấp.",
    },
    {
      title: `Đọc lại tóm tắt ${dayLabel}`,
      text: focus.length
        ? `Tập trung vào: ${focus.join(" · ")}.`
        : "Đọc lại các ý chính và công thức của bài.",
    },
    {
      title: "Trả lời Tự kiểm tra nhanh",
      text: "Trả lời xong các câu ôn nhanh cạnh nội dung bài để mở bài kiểm tra lại.",
    },
    {
      title: retakeLabel(retake?.title) || retakeLabel(`Kiểm tra lại ${dayLabel}`),
      text: `${
        intensive
          ? "Kết hợp 30% trắc nghiệm và 70% điền vào chỗ trống."
          : "Toàn bộ câu hỏi trắc nghiệm."
      } Cần đạt từ 80%, làm lại bao nhiêu lần cũng được, mỗi lần cần ôn và tự kiểm tra trước.`,
    },
  ];

  return (
    <section
      className={`overflow-hidden rounded-[24px] border-2 bg-white ${
        intensive ? "border-[var(--sp-pink)]" : "border-[#f3dc9a]"
      }`}
    >
      <div
        className={`flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7 ${
          intensive ? "bg-[var(--sp-pink)] text-white" : "bg-[var(--sp-amber-bg)] text-[var(--sp-purple-deep)]"
        }`}
      >
        <div>
          <p className="text-xs font-bold uppercase tracking-wide opacity-80">
            {intensive ? "Dưới 50% · cần tập trung" : "50–79% · ôn nhẹ nhàng"}
          </p>
          <h2 className="text-[22px]">{intensive ? "Lộ trình ôn cấp tốc" : "Lộ trình ôn thư thả"}</h2>
        </div>
        <button
          type="button"
          onClick={onPickDate}
          disabled={!retake}
          className={`sp-btn w-fit px-4 py-2.5 text-sm disabled:opacity-50 ${
            intensive
              ? "border-2 border-white bg-white text-[var(--sp-pink-dark)]"
              : "sp-btn-primary"
          }`}
        >
          <IconCalendar size={16} />
          {!retake
            ? "Chờ tạo bài kiểm tra lại…"
            : reviewDate
              ? `Đổi ngày ôn (${dayMonth(reviewDate)})`
              : "Chọn ngày ôn lại"}
        </button>
      </div>

      <ol className="grid gap-0 sm:grid-cols-4">
        {steps.map((step, index) => (
          <li
            key={index}
            className="relative border-t border-[var(--sp-line)] px-5 py-4 sm:border-l sm:border-t-0 sm:first:border-l-0"
          >
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-lg text-sm font-extrabold ${
                index === 0 && reviewDate
                  ? "bg-emerald-500 text-white"
                  : intensive
                    ? "bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]"
                    : "bg-[var(--sp-amber-bg)] text-[var(--sp-amber-dark)]"
              }`}
            >
              {index === 0 && reviewDate ? <IconCheck size={14} /> : index + 1}
            </span>
            <p className="mt-2 font-bold leading-snug text-[var(--sp-ink)]">{step.title}</p>
            <p className="mt-1 text-[13px] leading-5 text-[var(--sp-muted)]">{step.text}</p>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-3 border-t border-[var(--sp-line)] bg-[var(--sp-surface-2)] px-5 py-4 sm:flex-row sm:items-center sm:px-7">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
            retakeOpen ? "bg-emerald-50 text-emerald-700" : "bg-white text-[var(--sp-muted)]"
          }`}
        >
          {retakeOpen ? <IconRepeat size={18} /> : <IconLock size={18} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-[var(--sp-ink)]">
            {retakeLabel(retake?.title) || (retakeState.state === "error" ? "Chưa tạo được bài kiểm tra lại" : "Đang tạo bài kiểm tra lại…")}
          </p>
          <p className={`text-[13px] ${retakeState.state === "error" && !retake ? "text-[var(--sp-pink-dark)]" : "text-[var(--sp-muted)]"}`}>
            {!retake
              ? retakeState.state === "error"
                ? retakeState.message
                : retakeState.state === "done"
                  ? "Bài kiểm tra lại đã được tạo, tải lại trang để xem."
                  : "AI đang soạn câu hỏi, mất khoảng 10–30 giây."
              : retakeOpen
                ? "Đã mở. Bạn có thể làm bài kiểm tra lại ngay."
                : "Đang khóa. Học lại và trả lời Tự kiểm tra nhanh để mở."}
          </p>
        </div>
        {!retake && retakeState.state === "error" ? (
          <button type="button" onClick={onRetryRetake} className="sp-btn sp-btn-secondary shrink-0 px-4 py-2.5 text-sm">
            <IconRepeat size={15} />
            Thử tạo lại
          </button>
        ) : retake && retakeOpen ? (
          <Link href={`/quizzes/${retake.quiz_id}`} className="sp-btn sp-btn-primary shrink-0 px-4 py-2.5 text-sm">
            Làm bài kiểm tra lại
            <IconArrowRight size={15} />
          </Link>
        ) : (
          <Link href={materialsHref} className="sp-btn sp-btn-primary shrink-0 px-4 py-2.5 text-sm">
            <IconBook size={15} />
            Học lại & tự kiểm tra
          </Link>
        )}
      </div>
      {context.exam_date && (
        <p className="sr-only">Ngày thi {dayMonth(context.exam_date)}</p>
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
}: {
  context: ReviewContext;
  reviewPlanId: string;
  initial: string | null;
  onClose: () => void;
  onSaved: (value: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const available = context.week.filter((day) => !day.has_study && !day.is_past && !day.after_exam);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

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
      if (!response.ok) throw new Error(data?.detail || "Không thể lưu ngày ôn lại.");
      onSaved(selected);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Không thể lưu ngày ôn lại.");
    } finally {
      setSaving(false);
    }
  };

  const first = context.week[0]?.date;
  const last = context.week[context.week.length - 1]?.date;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Chọn ngày ôn lại"
      className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--sp-purple-deep)]/45 p-3 sm:items-center"
      onClick={onClose}
    >
      <div
        className="sp-task-expand w-full max-w-[560px] rounded-[24px] border-2 border-[var(--sp-purple)] bg-white p-5 shadow-[6px_6px_0_var(--sp-lav-line)] sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="sp-accent text-[16px] text-[var(--sp-pink)]">
              Tuần {dayMonth(first)} – {dayMonth(last)}
            </p>
            <h2 className="text-[22px] text-[var(--sp-ink)]">Chọn ngày ôn lại</h2>
            <p className="mt-1 text-sm text-[var(--sp-muted)]">
              Chỉ ôn trong tuần của bài học, vào ngày không trùng lịch học chính.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="rounded-xl p-2 text-[var(--sp-muted)] hover:bg-[var(--sp-surface-2)]"
          >
            <IconX size={18} />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-7 gap-1.5 sm:gap-2">
          {context.week.map((day) => {
            const isLesson = day.date === context.scheduled_date;
            const disabled = day.has_study || day.is_past || day.after_exam;
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
                  day.has_study
                    ? "Ngày học chính"
                    : day.is_past
                      ? "Ngày đã qua"
                      : day.after_exam
                        ? "Từ ngày thi trở đi"
                        : "Có thể chọn"
                }
                className={`relative flex flex-col items-center rounded-2xl border-2 px-1 py-2.5 transition ${
                  isSelected
                    ? "border-[var(--sp-purple)] bg-[var(--sp-pink)] text-white shadow-[3px_3px_0_var(--sp-purple-deep)]"
                    : day.has_study
                      ? "cursor-not-allowed border-[var(--sp-lav-line)] bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]"
                      : disabled
                        ? "cursor-not-allowed border-transparent bg-[var(--sp-surface-2)] text-[var(--sp-soft)]"
                        : "border-[var(--sp-line)] bg-white text-[var(--sp-ink)] hover:border-[var(--sp-pink)]"
                }`}
              >
                {isToday && (
                  <span className="absolute -top-2 rounded-full bg-[var(--sp-purple)] px-1.5 text-[9px] font-bold text-white">
                    Hôm nay
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
              </button>
            );
          })}
        </div>

        <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] text-[var(--sp-text-2)]">
          <li className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded border-2 border-[var(--sp-lav-line)] bg-[var(--sp-lav)]" />
            Ngày học chính (đã chọn khi tạo kế hoạch)
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[var(--sp-pink)]" />
            Ngày học bài này
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-[var(--sp-surface-2)]" />
            Đã qua / từ ngày thi
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded border-2 border-[var(--sp-line)] bg-white" />
            Có thể chọn
          </li>
        </ul>

        {available.length === 0 && (
          <p className="mt-4 rounded-2xl bg-[var(--sp-amber-bg)] px-4 py-3 text-sm text-[var(--sp-amber-dark)]">
            Tuần này không còn ngày trống. Hãy ôn ngay hôm nay hoặc tranh thủ sau giờ học chính.
          </p>
        )}
        {error && <p className="mt-3 text-sm font-medium text-[var(--sp-pink-dark)]">{error}</p>}

        <div className="mt-5 flex items-center justify-between gap-3">
          <p className="text-sm text-[var(--sp-muted)]">
            {selected ? `Đã chọn: ${weekdayLong(selected)}, ${dayMonth(selected)}` : "Chưa chọn ngày"}
          </p>
          <button
            type="button"
            disabled={!selected || saving}
            onClick={save}
            className="sp-btn sp-btn-primary px-5 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Đang lưu..." : "Lưu ngày ôn"}
          </button>
        </div>
      </div>
    </div>
  );
}

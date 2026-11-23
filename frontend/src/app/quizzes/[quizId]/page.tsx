"use client";

import { tx } from "@/lib/i18n";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { SmartLoading } from "@/components/loading-play";
import Link from "next/link";
import { getMainTopicTitle } from "@/lib/content-titles";
import {
  IconBook,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconFlag,
  IconInfo,
  IconTarget,
  Sparkle,
} from "@/components/icons";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

interface QuizQuestion {
  id: string;
  question_text: string;
  question_type: "single_choice" | "multiple_choice" | "fill_blank";
  options: Record<string, string> | Array<{ key: string; text: string }> | null;
  points: number;
  question_order: number;
  difficulty_level: number | null;
}

type QuestionTag = { question_id: string; weak: boolean; page: number | null };

type Overview = {
  is_retake: boolean;
  question_tags?: QuestionTag[];
  context: {
    topic_name: string | null;
    chapter: string | null;
    subject_name?: string | null;
  };
};

/* ================= Tiện ích ================= */

function shuffleArray<T>(items: T[]): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function getOptionEntries(options: QuizQuestion["options"]): [string, string][] {
  if (!options) return [];
  if (Array.isArray(options)) {
    return options.map((option, index) => [option.key || String.fromCharCode(65 + index), option.text]);
  }
  return Object.entries(options).map(([key, value]) => [key, typeof value === "string" ? value : String(value)]);
}

const DIFFICULTY = ["", tx("Nhận biết"), tx("Nhận biết"), tx("Thông hiểu"), tx("Vận dụng"), tx("Vận dụng cao")];

/* Tách phần tình huống (các câu dẫn) khỏi câu hỏi chính (câu có dấu "?") */
function splitQuestion(text: string) {
  const clean = String(text || "").trim();
  const sentences = clean.split(/(?<=[.!?:])\s+/).filter(Boolean);
  if (sentences.length < 2) return { context: "", question: clean };
  const lastAsk = sentences.map((sentence) => sentence.includes("?")).lastIndexOf(true);
  if (lastAsk <= 0) return { context: "", question: clean };
  const context = sentences.slice(0, lastAsk).join(" ");
  if (context.length < 40) return { context: "", question: clean };
  return { context, question: sentences.slice(lastAsk).join(" ") };
}

/* In đậm các con số (kèm đơn vị) trong phần tình huống */
function emphasizeNumbers(text: string): ReactNode[] {
  const pattern = /(\d[\d.,]*(?:\s?(?:%|đồng|triệu đồng|triệu|nghìn|tỷ|vé|USD|kg|người|sản phẩm|đơn vị|năm|tháng|ngày))?)/g;
  return text.split(pattern).map((part, index) =>
    index % 2 === 1 ? (
      <b key={index} className="font-bold text-[var(--sp-ink)]">
        {part}
      </b>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    )
  );
}

/* [1,2,3,5] → "1 – 3, 5" */
function compactNumbers(numbers: number[]) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let previous = sorted[0];
  for (const value of [...sorted.slice(1), Number.NaN]) {
    if (value === previous + 1) {
      previous = value;
      continue;
    }
    parts.push(previous - start >= 2 ? `${start} – ${previous}` : start === previous ? `${start}` : `${start}, ${previous}`);
    start = value;
    previous = value;
  }
  return parts.join(", ");
}

function formatClock(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/* ================= Trang ================= */

export default function QuizTakingPage() {
  const params = useParams();
  const router = useRouter();
  const quizId = params.quizId as string;

  const startedQuizIdRef = useRef("");
  const submitStartedRef = useRef(false);
  const submitCompletedRef = useRef(false);

  const [attemptId, setAttemptId] = useState("");
  const [title, setTitle] = useState("");
  const [timeLimit, setTimeLimit] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [draftAnswers, setDraftAnswers] = useState<Record<string, string>>({});
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [overview, setOverview] = useState<Overview | null>(null);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [holdLoading, setHoldLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [finished, setFinished] = useState(false);
  // true khi màn chờ nộp bài đã sang game: giữ màn chờ tới khi người dùng bấm Xem kết quả
  const [submitHold, setSubmitHold] = useState(false);
  const [error, setError] = useState("");

  // 1. Bắt đầu bài và lấy câu hỏi
  useEffect(() => {
    if (!quizId || startedQuizIdRef.current === quizId) return;
    startedQuizIdRef.current = quizId;
    submitStartedRef.current = false;
    submitCompletedRef.current = false;

    const initializeQuiz = async () => {
      try {
        const startResponse = await fetch(`${API_URL}/api/quizzes/${quizId}/start`, { method: "POST" });
        const startData = await startResponse.json();
        if (startedQuizIdRef.current !== quizId) return;
        if (!startResponse.ok) throw new Error(startData.detail || tx("Không thể bắt đầu bài kiểm tra."));

        const receivedAttemptId = String(startData.attempt_id || "").trim();
        if (!receivedAttemptId || receivedAttemptId === "null") {
          throw new Error(tx("Không thể tạo lượt làm bài hợp lệ. Vui lòng tải lại trang."));
        }

        setAttemptId(receivedAttemptId);
        setTitle(startData.title);
        setTimeLimit(startData.time_limit_minutes);

        const questionResponse = await fetch(`${API_URL}/api/quizzes/${quizId}/questions`);
        const questionData = await questionResponse.json();
        if (startedQuizIdRef.current !== quizId) return;
        if (!questionResponse.ok) throw new Error(questionData.detail || tx("Không thể tải câu hỏi."));

        // Xáo trộn thứ tự câu; giữ nguyên thứ tự A–D để chữ cái khớp với trang kết quả
        setQuestions(shuffleArray<QuizQuestion>((questionData.data || []) as QuizQuestion[]));

        if (startData.time_limit_minutes && startData.started_at) {
          const deadline = new Date(startData.started_at).getTime() + startData.time_limit_minutes * 60 * 1000;
          setRemainingSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
        }
      } catch (err) {
        if (startedQuizIdRef.current !== quizId) return;
        setError(err instanceof Error ? err.message : tx("Đã xảy ra lỗi khi tải bài kiểm tra."));
      } finally {
        if (startedQuizIdRef.current === quizId) setLoading(false);
      }
    };

    void initializeQuiz();

    // Thông tin phụ: phần yếu, trang tài liệu, tên môn (không chặn việc làm bài)
    fetch(`${API_URL}/api/quizzes/${quizId}/overview`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data?.data && startedQuizIdRef.current === quizId) setOverview(data.data);
      })
      .catch(() => undefined);
  }, [quizId]);

  // 2. Lưu câu trả lời
  const handleSelectAnswer = async (answer: string | string[]) => {
    const question = questions[currentIndex];
    if (!question || !attemptId || saving || submitting || finished) return;

    const previous = answers[question.id];
    setAnswers((current) => ({ ...current, [question.id]: answer }));
    setSaving(true);
    setError("");

    try {
      const response = await fetch(`${API_URL}/api/quiz-attempts/${attemptId}/answers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question_id: question.id, selected_answer: answer }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || tx("Không thể lưu câu trả lời."));
    } catch (err) {
      setAnswers((current) => {
        const next = { ...current };
        if (previous === undefined) delete next[question.id];
        else next[question.id] = previous;
        return next;
      });
      setError(err instanceof Error ? err.message : tx("Không thể lưu câu trả lời."));
    } finally {
      setSaving(false);
    }
  };

  const answeredCount = questions.filter((question) => {
    const answer = answers[question.id];
    return Array.isArray(answer) ? answer.length > 0 : Boolean(answer);
  }).length;

  // 3. Nộp bài → chuyển sang trang kết quả
  const handleSubmit = useCallback(
    async (autoSubmit = false) => {
      if (!attemptId || submitting || saving || finished || submitStartedRef.current) return;

      if (!autoSubmit && !submitCompletedRef.current) {
        const missing = questions.length - answeredCount;
        const confirmed = window.confirm(
          missing > 0
            ? tx("Bạn còn {0} câu chưa trả lời. Vẫn nộp bài?", [missing])
            : tx("Bạn chắc chắn muốn nộp bài?")
        );
        if (!confirmed) return;
      }

      submitStartedRef.current = true;
      setSubmitting(true);
      setError("");

      try {
        if (!submitCompletedRef.current) {
          const response = await fetch(`${API_URL}/api/quiz-attempts/${attemptId}/submit`, { method: "POST" });
          const data = await response.json();
          if (!response.ok) throw new Error(data.detail || tx("Không thể nộp bài."));
          submitCompletedRef.current = true;
        }
        setFinished(true);
      } catch (err) {
        // Có thể bài đã được chấm dù bước sau lỗi: kiểm tra lại rồi mới báo lỗi
        try {
          const recovery = await fetch(`${API_URL}/api/quiz-attempts/${attemptId}/result`);
          const recoveryData = await recovery.json();
          if (recovery.ok && recoveryData.status === "submitted") {
            setFinished(true);
            return;
          }
        } catch {
          /* giữ lỗi gốc */
        }
        setSubmitHold(false);
        setError(err instanceof Error ? err.message : tx("Không thể nộp bài."));
        if (remainingSeconds !== null && remainingSeconds <= 0) setRemainingSeconds(null);
      } finally {
        submitStartedRef.current = false;
        setSubmitting(false);
      }
    },
    [attemptId, submitting, saving, finished, questions.length, answeredCount, remainingSeconds]
  );

  // 4. Đồng hồ đếm ngược, hết giờ tự nộp
  useEffect(() => {
    if (remainingSeconds === null || finished || loading || !attemptId || submitting || saving) return;
    if (remainingSeconds <= 0) {
      void handleSubmit(true);
      return;
    }
    const timer = window.setTimeout(() => {
      setRemainingSeconds((previous) => (previous === null ? null : Math.max(0, previous - 1)));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [remainingSeconds, finished, loading, attemptId, submitting, saving, handleSubmit]);

  // Chấm xong: sang trang kết quả khi người dùng không còn giữ màn chờ (đang chơi game)
  useEffect(() => {
    if (finished && !submitHold && attemptId) router.replace(`/quiz-results/${attemptId}`);
  }, [finished, submitHold, attemptId, router]);

  const tagById = useMemo(
    () => new Map((overview?.question_tags || []).map((tag) => [tag.question_id, tag])),
    [overview]
  );

  // 5. Trạng thái tải
  if (loading || holdLoading) {
    return (
      <SmartLoading
        text={tx("Đang chuẩn bị bài kiểm tra…")}
        sub={tx("Pilot đang xáo câu hỏi, chuẩn bị bút nhé!")}
        stages={[tx("Tải đề"), tx("Xếp câu hỏi"), tx("Hẹn giờ"), tx("Sẵn sàng")]}
        continueLabel={tx("Vào làm bài")}
        done={!loading}
        onHoldChange={setHoldLoading}
      />
    );
  }

  // Nộp bài: chấm điểm, điểm thấp còn phải soạn bài kiểm tra lại nên có thể lâu
  if (submitting || submitHold || finished) {
    return (
      <SmartLoading
        text={tx("Đang nộp bài và chấm điểm…")}
        sub={tx("Pilot đang chấm từng câu, chờ mình xíu nhé!")}
        stages={[tx("Nộp bài"), tx("Chấm điểm"), tx("Phân tích câu sai"), tx("Soạn bài ôn lại")]}
        continueLabel={tx("Xem kết quả")}
        done={finished}
        onHoldChange={setSubmitHold}
      />
    );
  }

  if (error && questions.length === 0) {
    return (
      <div className="sp-card mx-auto max-w-3xl p-8 text-center">
        <p className="font-semibold text-[var(--sp-pink-dark)]">{error}</p>
        <Link href="/quizzes" className="sp-btn sp-btn-primary mt-5 px-5 py-2.5 text-sm">

          {tx("Về Kiểm tra kiến thức")}
        </Link>
      </div>
    );
  }

  const currentQuestion = questions[currentIndex];

  if (!currentQuestion) {
    return <div className="sp-card mx-auto max-w-3xl p-8 text-center text-[var(--sp-muted)]">{tx("Bài này chưa có câu hỏi.")}</div>;
  }

  const total = questions.length;
  const choiceCount = questions.filter((question) => question.question_type !== "fill_blank").length;
  const fillCount = total - choiceCount;
  const typeSummary = fillCount === 0 ? tx("{0} câu trắc nghiệm", [total]) : tx("{0} trắc nghiệm · {1} điền khuyết", [choiceCount, fillCount]);
  const displayTitle = overview?.context.topic_name ? getMainTopicTitle(overview.context.topic_name) : getMainTopicTitle(title);
  const kind = overview?.is_retake ? tx("Kiểm tra lại") : tx("Kiểm tra kiến thức");
  const tag = tagById.get(currentQuestion.id);
  const isFlagged = flagged.has(currentQuestion.id);
  const { context: stem, question: ask } = splitQuestion(currentQuestion.question_text);
  const difficulty = DIFFICULTY[currentQuestion.difficulty_level || 0] || "";
  const ratio = remainingSeconds !== null && timeLimit ? remainingSeconds / (timeLimit * 60) : 1;
  const lowTime = remainingSeconds !== null && remainingSeconds <= 60;

  /* "Bài này gồm" */
  const numbered = questions.map((question, index) => ({ number: index + 1, tag: tagById.get(question.id) }));
  const groups: { icon: ReactNode; tone: string; title: string; text: string }[] = [];
  if (overview?.is_retake) {
    const weak = numbered.filter((item) => item.tag?.weak).map((item) => item.number);
    const rest = numbered.filter((item) => !item.tag?.weak).map((item) => item.number);
    if (weak.length) {
      groups.push({
        icon: <IconTarget size={16} />,
        tone: "bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]",
        title: tx("Câu {0} · phần yếu", [compactNumbers(weak)]),
        text: tx("Phần bạn làm sai ở lần trước"),
      });
    }
    if (rest.length) {
      groups.push({
        icon: <IconBook size={16} />,
        tone: "bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]",
        title: tx("Câu {0}", [compactNumbers(rest)]),
        text: tx("Phần còn lại của bài học"),
      });
    }
  } else if (overview) {
    const byPage = new Map<string, number[]>();
    for (const item of numbered) {
      const key = item.tag?.page ? `Trang ${item.tag.page}` : tx("Nội dung bài học");
      byPage.set(key, [...(byPage.get(key) || []), item.number]);
    }
    Array.from(byPage.entries())
      .sort(([a], [b]) => a.localeCompare(b, "vi", { numeric: true }))
      .slice(0, 3)
      .forEach(([page, numbers]) =>
        groups.push({
          icon: <IconBook size={16} />,
          tone: "bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]",
          title: tx("Câu {0}", [compactNumbers(numbers)]),
          text: `${page}${overview.context.chapter ? ` · ${overview.context.chapter}` : ""}`,
        })
      );
  }
  const flaggedNumbers = numbered.filter((item) => flagged.has(questions[item.number - 1].id)).map((item) => item.number);
  groups.push({
    icon: <IconFlag size={16} />,
    tone: "bg-[var(--sp-amber-bg)] text-[var(--sp-amber-dark)]",
    title: flaggedNumbers.length ? tx("{0} câu đã đánh dấu", [flaggedNumbers.length]) : tx("Chưa đánh dấu câu nào"),
    text: flaggedNumbers.length
      ? tx("Câu {0}, xem lại trước khi nộp", [compactNumbers(flaggedNumbers)])
      : tx("Bấm \"Đánh dấu xem lại\" với câu bạn còn phân vân"),
  });

  const isLast = currentIndex === total - 1;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      {/* ---------- Thanh trên ---------- */}
      <header className="flex flex-col gap-4 rounded-[24px] border-2 border-[var(--sp-purple-deep)] bg-white p-4 shadow-[5px_5px_0_var(--sp-peri)] sm:p-5 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <Link href="/quizzes" className="sp-btn sp-btn-secondary shrink-0 px-4 py-2.5 text-sm">
            <IconChevronLeft size={16} />

            {tx("Thoát")}
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-[19px] font-extrabold leading-tight text-[var(--sp-purple)] sm:text-[22px]">
              {kind} · {displayTitle}
            </h1>
            <p className="mt-0.5 truncate text-[13px] text-[var(--sp-muted)]">
              {[overview?.context.subject_name, typeSummary, tx("chỉ gồm phần đã học")].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1 lg:w-[260px] lg:flex-none">
            <div className="flex justify-between text-[13px] font-semibold text-[var(--sp-text-2)]">
              <span>{tx("Đã trả lời")}</span>
              <span className="font-bold text-[var(--sp-ink)]">
                {tx("{0} / {1} câu", [answeredCount, total])}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--sp-surface-2)]">
              <div
                className="h-full rounded-full bg-[var(--sp-peri)] transition-all duration-500"
                style={{ width: `${(answeredCount / total) * 100}%` }}
              />
            </div>
          </div>

          <div
            className={`flex shrink-0 items-center gap-3 rounded-2xl px-4 py-2.5 text-white ${
              lowTime ? "bg-[var(--sp-pink-dark)]" : "bg-[var(--sp-purple)]"
            }`}
            aria-live="polite"
          >
            <span className="relative flex h-10 w-10 items-center justify-center">
              <svg viewBox="0 0 40 40" className="absolute inset-0 -rotate-90">
                <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="4" />
                <circle
                  cx="20"
                  cy="20"
                  r="16"
                  fill="none"
                  stroke="var(--sp-yellow)"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray={`${Math.max(0, Math.min(1, ratio)) * 100.5} 100.5`}
                />
              </svg>
              <IconClock size={15} />
            </span>
            <span>
              <span className="block text-[24px] font-extrabold leading-none tabular-nums">
                {remainingSeconds !== null ? formatClock(remainingSeconds) : "∞"}
              </span>
              <span className="block text-[11px] text-white/75">
                {timeLimit ? tx("còn lại / {0}", [formatClock(timeLimit * 60)]) : tx("không giới hạn")}
              </span>
            </span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* ---------- Câu hỏi ---------- */}
        <section className="sp-card flex min-h-[540px] flex-col p-5 sm:p-8">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="mr-1 flex items-baseline gap-1 text-[var(--sp-pink)]">
              <span className="text-[34px] font-black leading-none">{tx("Câu {0}", [currentIndex + 1])}</span>
              <span className="text-[18px] font-bold text-[var(--sp-muted)]">/ {total}</span>
            </h2>
            {tag?.weak && (
              <span className="sp-chip flex items-center gap-1 bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]">
                <IconTarget size={13} />

                {tx("Phần yếu")}{tag.page ? ` · trang ${tag.page}` : ""}
              </span>
            )}
            {!tag?.weak && tag?.page && (
              <span className="sp-chip bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]">Trang {tag.page}</span>
            )}
            {difficulty && <span className="sp-chip bg-[var(--sp-surface-2)] text-[var(--sp-text-2)]">{difficulty}</span>}
            <button
              type="button"
              aria-pressed={isFlagged}
              onClick={() =>
                setFlagged((current) => {
                  const next = new Set(current);
                  if (next.has(currentQuestion.id)) next.delete(currentQuestion.id);
                  else next.add(currentQuestion.id);
                  return next;
                })
              }
              className={`sp-btn ml-auto px-3.5 py-2 text-[13px] ${
                isFlagged
                  ? "border-2 border-[var(--sp-yellow)] bg-[var(--sp-amber-bg)] text-[var(--sp-amber-dark)]"
                  : "sp-btn-secondary"
              }`}
            >
              <IconFlag size={15} />
              {isFlagged ? tx("Đã đánh dấu") : tx("Đánh dấu xem lại")}
            </button>
          </div>

          {stem && (
            <p className="mt-5 rounded-2xl border-l-4 border-[var(--sp-peri)] bg-[var(--sp-lav)] px-5 py-4 text-justify text-[15px] leading-7 text-[var(--sp-text-2)]">
              {emphasizeNumbers(stem)}
            </p>
          )}

          <p className="mt-5 text-justify text-[19px] font-bold leading-8 text-[var(--sp-ink)] sm:text-[21px]">{ask}</p>

          {currentQuestion.question_type === "fill_blank" ? (
            <div className="mt-5">
              <p className="text-[13px] text-[var(--sp-muted)]">{tx("Nhập câu trả lời rồi bấm Lưu (hoặc Enter).")}</p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  value={
                    draftAnswers[currentQuestion.id] ??
                    (typeof answers[currentQuestion.id] === "string" ? (answers[currentQuestion.id] as string) : "")
                  }
                  onChange={(event) =>
                    setDraftAnswers((current) => ({ ...current, [currentQuestion.id]: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    const value = (draftAnswers[currentQuestion.id] ?? "").trim();
                    if (event.key === "Enter" && value) void handleSelectAnswer(value);
                  }}
                  disabled={submitting}
                  placeholder={tx("Câu trả lời của bạn...")}
                  className="min-w-0 flex-1 rounded-2xl border-2 border-[var(--sp-line)] bg-white px-4 py-3.5 text-[15px] text-[var(--sp-ink)] outline-none transition placeholder:text-[var(--sp-soft)] focus:border-[var(--sp-peri)]"
                />
                <button
                  type="button"
                  disabled={saving || submitting || !(draftAnswers[currentQuestion.id] ?? "").trim()}
                  onClick={() => void handleSelectAnswer((draftAnswers[currentQuestion.id] ?? "").trim())}
                  className="sp-btn sp-btn-primary justify-center px-5 py-3 text-sm disabled:opacity-50"
                >
                  <IconCheck size={15} />

                  {tx("Lưu câu trả lời")}
                </button>
              </div>
              {typeof answers[currentQuestion.id] === "string" && answers[currentQuestion.id] && (
                <p className="mt-2 text-[13px] font-semibold text-emerald-700">
                  {tx("Đã lưu: “{0}”", [answers[currentQuestion.id] as string])}</p>
              )}
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {currentQuestion.question_type === "multiple_choice" && (
                <p className="text-[13px] text-[var(--sp-muted)]">{tx("Có thể chọn nhiều đáp án.")}</p>
              )}
              {getOptionEntries(currentQuestion.options).map(([key, optionText], index) => {
                const currentAnswer = answers[currentQuestion.id];
                const selected = Array.isArray(currentAnswer) ? currentAnswer.includes(key) : currentAnswer === key;
                const letter = key || String.fromCharCode(65 + index);
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={submitting}
                    aria-pressed={selected}
                    onClick={() => {
                      if (currentQuestion.question_type === "multiple_choice") {
                        const list = Array.isArray(currentAnswer) ? currentAnswer : [];
                        void handleSelectAnswer(list.includes(key) ? list.filter((item) => item !== key) : [...list, key]);
                      } else {
                        void handleSelectAnswer(key);
                      }
                    }}
                    className={`flex w-full items-center gap-4 rounded-2xl border-2 px-4 py-3.5 text-left transition sm:px-5 ${
                      selected
                        ? "border-[var(--sp-purple)] bg-[var(--sp-lav)] shadow-[4px_4px_0_var(--sp-peri)]"
                        : "border-[var(--sp-line)] bg-white hover:border-[var(--sp-lav-line)] hover:bg-[var(--sp-surface-2)]"
                    }`}
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[15px] font-extrabold ${
                        selected ? "bg-[var(--sp-peri)] text-white" : "bg-[var(--sp-surface-2)] text-[var(--sp-text-2)]"
                      }`}
                    >
                      {letter}
                    </span>
                    <span className="flex-1 text-justify text-[16px] font-semibold leading-6 text-[var(--sp-ink)]">{optionText}</span>
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                        selected ? "border-[var(--sp-peri)]" : "border-[var(--sp-soft)]"
                      }`}
                    >
                      {selected && <span className="h-3 w-3 rounded-full bg-[var(--sp-peri)]" />}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {error && <p className="mt-4 text-sm font-medium text-[var(--sp-pink-dark)]">{error}</p>}

          <div aria-hidden="true" className="min-h-8 flex-1" />
          <div className="flex flex-wrap items-center gap-3 border-t-2 border-dashed border-[var(--sp-line)] pt-5">
            <button
              type="button"
              disabled={currentIndex === 0 || submitting}
              onClick={() => setCurrentIndex((index) => index - 1)}
              className="sp-btn sp-btn-secondary px-4 py-2.5 text-sm disabled:opacity-40"
            >
              <IconChevronLeft size={16} />

              {tx("Câu trước")}
            </button>
            <p className="hidden flex-1 items-center gap-1.5 text-[13px] text-[var(--sp-muted)] sm:flex">
              <IconInfo size={15} />

              {tx("Đáp án và giải thích hiện sau khi nộp bài")}
            </p>
            {isLast ? (
              <button
                type="button"
                disabled={saving || submitting}
                onClick={() => void handleSubmit(false)}
                className="sp-btn ml-auto bg-[var(--sp-purple)] px-5 py-2.5 text-sm text-white hover:bg-[var(--sp-purple-deep)] disabled:opacity-50"
              >
                <IconCheck size={16} />
                {submitting ? tx("Đang nộp...") : tx("Nộp bài")}
              </button>
            ) : (
              <button
                type="button"
                disabled={submitting}
                onClick={() => setCurrentIndex((index) => index + 1)}
                className="sp-btn sp-btn-primary ml-auto px-5 py-2.5 text-sm"
              >

                {tx("Câu tiếp")}
                <IconChevronRight size={16} />
              </button>
            )}
          </div>
        </section>

        {/* ---------- Cột phải ---------- */}
        <aside className="space-y-5 lg:sticky lg:top-6">
          <section className="sp-card p-5">
            <p className="sp-accent text-[16px] text-[var(--sp-pink)]">{tx("Bấm số để chuyển câu")}</p>
            <h3 className="text-[19px] text-[var(--sp-ink)]">{tx("Danh sách câu hỏi")}</h3>
            <div className="mt-4 grid grid-cols-5 gap-2 lg:grid-cols-4">
              {questions.map((question, index) => {
                const answer = answers[question.id];
                const answered = Array.isArray(answer) ? answer.length > 0 : Boolean(answer);
                const current = index === currentIndex;
                return (
                  <button
                    key={question.id}
                    type="button"
                    onClick={() => setCurrentIndex(index)}
                    aria-label={tx("Câu {0}{1}{2}{3}", [index + 1, answered ? tx(", đã trả lời") : tx(", chưa trả lời"), flagged.has(question.id) ? tx(", đã đánh dấu") : "", current ? tx(", đang làm") : ""])}
                    className={`relative flex h-12 items-center justify-center rounded-xl border-2 text-[17px] font-extrabold transition ${
                      current
                        ? "border-[var(--sp-purple-deep)] bg-[var(--sp-pink)] text-white shadow-[3px_3px_0_var(--sp-purple-deep)]"
                        : answered
                          ? "border-[var(--sp-peri)] bg-[var(--sp-peri)] text-white hover:brightness-105"
                          : "border-[var(--sp-line)] bg-white text-[var(--sp-muted)] hover:border-[var(--sp-lav-line)]"
                    }`}
                  >
                    {index + 1}
                    {flagged.has(question.id) && (
                      <Sparkle size={14} className="absolute -right-1.5 -top-1.5 text-[var(--sp-yellow)]" />
                    )}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[13px] text-[var(--sp-text-2)]">
              <span className="flex items-center gap-1.5">
                <span className="h-3.5 w-3.5 rounded bg-[var(--sp-peri)]" />

                {tx("Đã trả lời")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3.5 w-3.5 rounded border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-pink)]" />

                {tx("Đang làm")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3.5 w-3.5 rounded border-2 border-[var(--sp-line)] bg-white" />

                {tx("Chưa làm")}
              </span>
              <span className="flex items-center gap-1.5">
                <Sparkle size={13} className="text-[var(--sp-yellow)]" />

                {tx("Đánh dấu")}
              </span>
            </div>
          </section>

          <section className="sp-card p-5">
            <h3 className="text-[19px] text-[var(--sp-ink)]">{tx("Bài này gồm")}</h3>
            <ul className="mt-3 space-y-3.5">
              {groups.map((group) => (
                <li key={group.title} className="flex gap-3">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${group.tone}`}>
                    {group.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[14px] font-bold text-[var(--sp-ink)]">{group.title}</span>
                    <span className="block text-[13px] leading-5 text-[var(--sp-muted)]">{group.text}</span>
                  </span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              disabled={saving || submitting}
              onClick={() => void handleSubmit(false)}
              className="sp-btn mt-6 w-full justify-center bg-[var(--sp-purple)] py-3.5 text-[16px] text-white hover:bg-[var(--sp-purple-deep)] disabled:opacity-60"
            >
              <IconCheck size={17} />
              {submitting ? tx("Đang nộp bài...") : tx("Nộp bài")}
            </button>
          </section>
        </aside>
      </div>
    </div>
  );
}

"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  IconAlert,
  IconArrowRight,
  IconBook,
  IconCheck,
  IconRepeat,
  IconX,
  Sparkle,
} from "@/components/icons";

/* ================= Kiểu dữ liệu ================= */

export type PracticeQuestion = {
  section_index: number;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
  evidence: string;
};

/* Câu hỏi đã gắn với mục đang hiển thị trong ngày học */
export type DayPracticeQuestion = PracticeQuestion & {
  key: string;
  sectionId: string;
  sectionNumber: number;
  sectionHeading: string;
};

export type PracticeHighlight = { sectionId: string; evidence: string } | null;

/* ================= Tô sáng đoạn giải thích ================= */

const HighlightContext = createContext<string>("");

export const HighlightProvider = HighlightContext.Provider;

function normalize(text: string) {
  return text
    .toLocaleLowerCase("vi")
    .replace(/\*\*/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesEvidence(text: string, evidence: string) {
  const line = normalize(text);
  const target = normalize(evidence);
  if (!line || !target) return false;
  if (line.includes(target) || (line.length >= 12 && target.includes(line))) return true;

  const words = target.split(" ").filter((word) => word.length > 1);
  if (words.length < 3) return false;
  const lineWords = new Set(line.split(" "));
  const hits = words.filter((word) => lineWords.has(word)).length;
  return hits / words.length >= 0.7;
}

/* Bọc một dòng nội dung: nếu dòng chứa đoạn giải thích thì tô nền */
export function Highlightable({ text, children }: { text: string; children: React.ReactNode }) {
  const evidence = useContext(HighlightContext);
  if (!evidence || !matchesEvidence(text, evidence)) return <>{children}</>;
  return (
    <mark className="sp-evidence rounded-md bg-[#fff1b8] px-1 text-inherit [box-decoration-break:clone] [-webkit-box-decoration-break:clone]">
      {children}
    </mark>
  );
}

/* ================= Khung câu hỏi ================= */

const LETTERS = ["A", "B", "C", "D"];

type Answer = { choice: number; correct: boolean };

export type UnlockState = {
  state: "idle" | "saving" | "done" | "error";
  quizHref?: string;
  retakeHref?: string;
  quizLabel?: string;
  title?: string;
  message?: string;
};

export default function PracticeQuizPanel({
  questions,
  isLoading,
  error,
  onRetry,
  onReview,
  reviewingKey,
  onUnderstood,
  onRestart,
  onFinish,
  unlock,
  emptyHint,
  renderText = (text: string) => text,
}: {
  questions: DayPracticeQuestion[];
  isLoading: boolean;
  error: string;
  onRetry: () => void;
  onReview: (question: DayPracticeQuestion) => void;
  /* Câu đang được tô sáng trong bài (đã bấm "Xem giải thích") */
  reviewingKey?: string;
  onUnderstood: () => void;
  /* Đổi bộ câu hỏi khác khi làm lại */
  onRestart: () => void;
  /* Trả lời xong → mở bài kiểm tra của buổi học */
  onFinish: (answered: number, correct: number) => void;
  unlock: UnlockState;
  emptyHint?: string;
  /* Hiển thị công thức/chỉ số dưới (vd |E_D|) giống phần nội dung */
  renderText?: (text: string) => React.ReactNode;
}) {
  const [index, setIndex] = useState(0);
  const [choice, setChoice] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});

  const signature = useMemo(() => questions.map((item) => item.key).join("|"), [questions]);
  useEffect(() => {
    setIndex(0);
    setChoice(null);
    setAnswers({});
  }, [signature]);

  const total = questions.length;
  const finished = total > 0 && index >= total;
  const current = finished ? undefined : questions[index];
  const answer = current ? answers[current.key] : undefined;
  const correctCount = Object.values(answers).filter((item) => item.correct).length;
  const wrongCount = Object.values(answers).length - correctCount;

  const confirm = () => {
    if (!current || choice === null) return;
    setAnswers((state) => ({
      ...state,
      [current.key]: { choice, correct: choice === current.correct_index },
    }));
  };

  const next = () => {
    if (index + 1 >= total) {
      const results = Object.values(answers);
      onFinish(results.length, results.filter((item) => item.correct).length);
    }
    onUnderstood();
    setIndex((value) => value + 1);
    setChoice(null);
  };

  const restart = () => {
    onUnderstood();
    onRestart();
    setIndex(0);
    setChoice(null);
    setAnswers({});
  };

  return (
    <div className="flex h-full flex-col bg-[var(--sp-lav)]/55 px-4 py-4 sm:px-5 sm:py-5">
      {/* Đầu khung */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="sp-accent text-[14px] text-[var(--sp-pink)]">Tự kiểm tra nhanh</p>
          <h2 className="text-lg leading-tight text-[var(--sp-ink)]">
            {total > 0 && !finished ? (
              <>
                Câu {index + 1}
                <span className="text-[var(--sp-soft)]"> / {total}</span>
              </>
            ) : (
              "Ôn nhanh"
            )}
          </h2>
        </div>
        {total > 0 && (
          <div className="flex gap-2.5 pt-5 text-xs font-semibold text-[var(--sp-text-2)]">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Đúng {correctCount}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[var(--sp-pink)]" />
              Sai {wrongCount}
            </span>
          </div>
        )}
      </div>

      {total > 0 && (
        <div className="mt-2.5 flex gap-1" aria-hidden="true">
          {questions.map((item, itemIndex) => {
            const result = answers[item.key];
            return (
              <span
                key={item.key}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  result
                    ? result.correct
                      ? "bg-emerald-500"
                      : "bg-[var(--sp-pink)]"
                    : itemIndex === index
                      ? "bg-[var(--sp-peri)]"
                      : "bg-white"
                }`}
              />
            );
          })}
        </div>
      )}

      {/* Nội dung */}
      <div className="mt-4 flex flex-1 flex-col">
        {isLoading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
            <Sparkle size={26} className="sp-twinkle text-[var(--sp-pink)]" />
            <p className="font-bold text-[var(--sp-ink)]">Đang soạn câu hỏi ôn nhanh…</p>
            <p className="max-w-[260px] text-sm text-[var(--sp-muted)]">
              Lần đầu mở bài có thể mất vài giây, những lần sau sẽ hiện ngay.
            </p>
            <div className="mt-2 w-full space-y-2.5">
              {[0, 1, 2, 3].map((item) => (
                <span key={item} className="block h-12 animate-pulse rounded-2xl bg-white/80" />
              ))}
            </div>
          </div>
        ) : error ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]">
              <IconAlert size={20} />
            </span>
            <p className="font-bold text-[var(--sp-ink)]">Chưa tạo được câu hỏi</p>
            <p className="max-w-[280px] text-sm text-[var(--sp-muted)]">{error}</p>
            <button type="button" onClick={onRetry} className="sp-btn sp-btn-secondary mt-1 px-4 py-2 text-sm">
              <IconRepeat size={15} />
              Thử lại
            </button>
            <UnlockBlock unlock={unlock} onComplete={() => onFinish(0, 0)} compact />
          </div>
        ) : total === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
            <IconBook size={26} className="text-[var(--sp-peri-dark)]" />
            <p className="font-bold text-[var(--sp-ink)]">Chưa có câu hỏi cho ngày này</p>
            <p className="max-w-[280px] text-sm text-[var(--sp-muted)]">
              {emptyHint || "Nội dung hôm nay quá ngắn để tạo câu hỏi ôn nhanh."}
            </p>
            <UnlockBlock unlock={unlock} onComplete={() => onFinish(0, 0)} compact />
          </div>
        ) : finished ? (
          <div className="flex flex-1 flex-col items-center justify-center py-8 text-center">
            <span
              className={`flex h-14 w-14 items-center justify-center rounded-[18px] text-xl font-extrabold ${
                correctCount === total
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-[var(--sp-amber-bg)] text-[var(--sp-amber-dark)]"
              }`}
            >
              {correctCount}/{total}
            </span>
            <p className="mt-3 text-[15px] font-bold text-[var(--sp-ink)]">
              {correctCount === total
                ? "Xuất sắc, bạn nhớ hết rồi!"
                : correctCount === 0
                  ? "Đọc lại phần tô vàng rồi thử lần nữa nhé"
                  : "Gần được rồi, ôn lại câu sai nhé"}
            </p>
            <p className="mt-1 text-[13px] text-[var(--sp-muted)]">Câu hỏi ôn nhanh không tính điểm.</p>
            <UnlockBlock unlock={unlock} onComplete={() => onFinish(total, correctCount)} />
            <button
              type="button"
              onClick={restart}
              className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-bold text-[var(--sp-peri-dark)] hover:underline"
            >
              <IconRepeat size={14} />
              Làm lại với câu hỏi khác
            </button>
          </div>
        ) : current ? (
          <>
            <p className="truncate text-[11px] font-bold uppercase tracking-wide text-[var(--sp-muted)]">
              Mục {current.sectionNumber} · {current.sectionHeading}
            </p>
            <p className="mt-1 text-[14.5px] font-bold leading-6 text-[var(--sp-ink)]">{renderText(current.question)}</p>

            <div className="mt-3 space-y-2" role="radiogroup" aria-label="Các lựa chọn">
              {current.options.map((option, optionIndex) => {
                const selected = (answer ? answer.choice : choice) === optionIndex;
                const isCorrect = optionIndex === current.correct_index;
                const state = answer
                  ? isCorrect
                    ? "correct"
                    : selected
                      ? "wrong"
                      : "idle"
                  : selected
                    ? "selected"
                    : "idle";

                return (
                  <button
                    key={optionIndex}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={Boolean(answer)}
                    onClick={() => setChoice(optionIndex)}
                    className={`flex w-full items-center gap-2.5 rounded-xl border-2 px-2.5 py-2 text-left text-[13.5px] font-medium leading-5 transition ${
                      state === "correct"
                        ? "border-emerald-500 bg-emerald-50 text-emerald-900"
                        : state === "wrong"
                          ? "border-[var(--sp-pink)] bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]"
                          : state === "selected"
                            ? "border-[var(--sp-purple)] bg-white text-[var(--sp-ink)] shadow-[3px_3px_0_var(--sp-lav-line)]"
                            : "border-[var(--sp-line)] bg-white text-[var(--sp-ink)] hover:border-[var(--sp-lav-line)] disabled:hover:border-[var(--sp-line)]"
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-extrabold ${
                        state === "correct"
                          ? "bg-emerald-500 text-white"
                          : state === "wrong"
                            ? "bg-[var(--sp-pink)] text-white"
                            : state === "selected"
                              ? "bg-[var(--sp-peri)] text-white"
                              : "bg-[var(--sp-surface-2)] text-[var(--sp-text-2)]"
                      }`}
                    >
                      {state === "correct" ? <IconCheck size={13} /> : state === "wrong" ? <IconX size={13} /> : LETTERS[optionIndex]}
                    </span>
                    <span className="flex-1">{renderText(option)}</span>
                  </button>
                );
              })}
            </div>

            {/* Kết quả */}
            {answer && (
              <div
                className={`sp-task-expand mt-3 rounded-xl border-2 px-3 py-2.5 ${
                  answer.correct
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-[var(--sp-pink-line)] bg-white"
                }`}
              >
                {answer.correct ? (
                  <p className="flex items-center gap-2 text-sm font-bold text-emerald-800">
                    <IconCheck size={15} />
                    Chính xác!
                  </p>
                ) : (
                  <>
                    <p className="flex items-center gap-2 text-sm font-bold text-[var(--sp-pink-dark)]">
                      <IconX size={15} />
                      Chưa đúng, đáp án là {LETTERS[current.correct_index]}
                    </p>
                    {current.explanation && (
                      <p className="mt-1 text-[13px] leading-5 text-[var(--sp-text-2)]">{renderText(current.explanation)}</p>
                    )}
                    {reviewingKey === current.key ? (
                      <button
                        type="button"
                        onClick={onUnderstood}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1 text-[13px] font-bold text-white transition hover:bg-emerald-700"
                      >
                        <IconCheck size={14} />
                        Đã hiểu
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onReview(current)}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#fff1b8] px-2.5 py-1 text-[13px] font-bold text-[var(--sp-purple)] transition hover:bg-[#ffe68a]"
                      >
                        <IconBook size={14} />
                        Xem giải thích trong bài
                        <IconArrowRight size={13} />
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="mt-auto flex items-center justify-between gap-3 pt-4">
              <p className="text-xs leading-4 text-[var(--sp-muted)]">
                {answer ? "Không tính điểm" : "Chọn đáp án rồi xác nhận"}
              </p>
              {answer ? (
                <button type="button" onClick={next} className="sp-btn sp-btn-primary shrink-0 px-4 py-2 text-[13px]">
                  {index + 1 < total ? "Câu tiếp theo" : "Xem kết quả"}
                  <IconArrowRight size={16} />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={choice === null}
                  onClick={confirm}
                  className="sp-btn sp-btn-primary shrink-0 px-4 py-2 text-[13px] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Xác nhận
                  <IconArrowRight size={15} />
                </button>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/* Khối mở bài kiểm tra sau khi trả lời xong */
function UnlockBlock({
  unlock,
  onComplete,
  compact = false,
}: {
  unlock: UnlockState;
  onComplete: () => void;
  compact?: boolean;
}) {
  if (unlock.state === "done") {
    return (
      <div className="sp-task-expand mt-4 w-full rounded-2xl border-2 border-emerald-200 bg-emerald-50 px-4 py-3 text-left">
        <p className="flex items-center gap-2 text-sm font-bold text-emerald-800">
          <IconCheck size={16} />
          {unlock.title ? unlock.title : unlock.retakeHref
            ? "Bài kiểm tra lại đã mở"
            : unlock.quizLabel
              ? "Bạn đã làm bài kiểm tra của buổi này"
              : "Bài kiểm tra hôm nay đã mở"}
        </p>
        {unlock.retakeHref && (
          <Link
            href={unlock.retakeHref}
            className="sp-btn sp-btn-primary mt-2.5 w-full justify-center py-2 text-[13px]"
          >
            <IconRepeat size={14} />
            Làm bài kiểm tra lại
          </Link>
        )}
        {!unlock.retakeHref && (!unlock.title || unlock.quizHref) && (
          <Link
            href={unlock.quizHref || "/quizzes"}
            className="sp-btn sp-btn-primary mt-2.5 w-full justify-center py-2 text-[13px]"
          >
            {unlock.quizLabel || "Làm bài kiểm tra"}
            <IconArrowRight size={15} />
          </Link>
        )}
      </div>
    );
  }

  if (unlock.state === "error") {
    return (
      <div className="mt-4 w-full rounded-2xl border-2 border-[var(--sp-pink-line)] bg-white px-4 py-3 text-left">
        <p className="text-[13px] text-[var(--sp-pink-dark)]">{unlock.message}</p>
        <button type="button" onClick={onComplete} className="sp-btn sp-btn-secondary mt-2 px-3 py-1.5 text-[13px]">
          <IconRepeat size={14} />
          Mở lại bài kiểm tra
        </button>
      </div>
    );
  }

  if (unlock.state === "saving") {
    return (
      <p className="mt-4 flex items-center gap-2 text-[13px] font-semibold text-[var(--sp-muted)]">
        <Sparkle size={13} className="sp-twinkle text-[var(--sp-pink)]" />
        Đang mở bài kiểm tra…
      </p>
    );
  }

  return compact ? (
    <button type="button" onClick={onComplete} className="sp-btn sp-btn-primary mt-3 px-4 py-2 text-[13px]">
      Hoàn thành bài học
      <IconArrowRight size={15} />
    </button>
  ) : null;
}

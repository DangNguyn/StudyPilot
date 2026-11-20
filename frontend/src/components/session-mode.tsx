"use client";

/*
 * Trang Tài liệu học tập mở theo 3 chế độ (từ lịch tháng):
 * - learn: học như bình thường (không có khối riêng);
 * - review: buổi ôn lại, trả lời Tự kiểm tra nhanh để mở bài kiểm tra lại;
 * - revisit: xem lại buổi đã học, kèm câu sai và giải thích của bài kiểm tra.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import WrongAnswerReview, { type ReviewQuestion } from "@/components/wrong-answer-review";
import { IconAlert, IconRepeat } from "@/components/icons";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

export type SessionMode = "learn" | "review" | "revisit";

export function parseSessionMode(value: string | null): SessionMode | null {
  return value === "learn" || value === "review" || value === "revisit" ? value : null;
}

type Attempt = { attempt_id: string; quiz_id: string; submitted_at?: string | null };
type Quiz = { id: string; study_session_id?: string | null; is_retake?: boolean };
type AttemptResult = {
  attempt_id: string;
  score: number | null;
  correct_count: number;
  total_questions: number;
  results: ReviewQuestion[];
};

async function list<T>(url: string): Promise<T[]> {
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.detail || "Không thể tải dữ liệu.");
  return Array.isArray(data?.data) ? data.data : [];
}

/* Kết quả bài kiểm tra gốc gần nhất của buổi học */
export function useSessionQuizResult(planId: string | undefined, sessionId: string | null | undefined, enabled: boolean) {
  const [state, setState] = useState<{ result: AttemptResult | null; loading: boolean; error: string }>({
    result: null,
    loading: false,
    error: "",
  });

  useEffect(() => {
    if (!enabled || !planId || !sessionId) return;
    let cancelled = false;
    (async () => {
      setState({ result: null, loading: true, error: "" });
      try {
        const [quizzes, attempts] = await Promise.all([
          list<Quiz>(`${API_URL}/api/quizzes?exam_plan_id=${planId}`),
          list<Attempt>(`${API_URL}/api/quiz-attempts`),
        ]);
        const quiz = quizzes.find((item) => !item.is_retake && item.study_session_id === sessionId);
        const attempt = quiz
          ? attempts
              .filter((item) => item.quiz_id === quiz.id && item.submitted_at)
              .sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)))[0]
          : undefined;
        if (!attempt) {
          if (!cancelled) setState({ result: null, loading: false, error: "" });
          return;
        }
        const response = await fetch(`${API_URL}/api/quiz-attempts/${attempt.attempt_id}/result`, { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.detail || "Không thể tải kết quả bài kiểm tra.");
        if (!cancelled) setState({ result: { ...data, attempt_id: attempt.attempt_id }, loading: false, error: "" });
      } catch (error) {
        if (!cancelled) {
          setState({
            result: null,
            loading: false,
            error: error instanceof Error ? error.message : "Không thể tải kết quả bài kiểm tra.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, planId, sessionId]);

  return state;
}

function percentOf(result: AttemptResult) {
  return result.total_questions
    ? Math.round((result.correct_count / result.total_questions) * 100)
    : Math.round(Number(result.score || 0));
}

/* Khối đầu trang cho chế độ Vào ôn / Xem lại */
export function SessionModeBanner({
  mode,
  topicTitle,
  result,
}: {
  mode: SessionMode;
  topicTitle: string;
  result: AttemptResult | null;
}) {
  if (mode === "learn") return null;
  const percent = result ? percentOf(result) : null;

  if (mode === "review") {
    return (
      <section className="rounded-[20px] border-2 border-[var(--sp-pink)] bg-[var(--sp-pink-bg)] px-5 py-4 shadow-[4px_4px_0_var(--sp-pink-line)]">
        <p className="sp-accent text-[var(--sp-pink-dark)]">Buổi ôn lại</p>
        <p className="flex items-center gap-2 text-lg font-extrabold text-[var(--sp-ink)]">
          <IconRepeat size={18} className="shrink-0 text-[var(--sp-pink-dark)]" />
          {topicTitle}
        </p>
        <ul className="mt-1.5 space-y-0.5 text-sm text-[var(--sp-text-2)]">
          {percent !== null && (
            <li>
              Lần kiểm tra trước: {result?.correct_count}/{result?.total_questions} câu ({percent}%)
            </li>
          )}
          <li>Đọc lại tóm tắt, trả lời phần Tự kiểm tra nhanh bên phải để mở bài kiểm tra lại.</li>
          <li>
            Bài kiểm tra lại:{" "}
            {percent !== null && percent < 50
              ? "trắc nghiệm kết hợp điền khuyết (vì lần trước dưới 50%)"
              : "trắc nghiệm"}
            . Cần đạt từ 80%.
          </li>
        </ul>
      </section>
    );
  }

  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border-2 border-[var(--sp-purple)] bg-[var(--sp-lav)] px-5 py-4 shadow-[4px_4px_0_var(--sp-lav-line)]">
      <div className="min-w-0">
        <p className="sp-accent text-[var(--sp-pink)]">Xem lại buổi đã học</p>
        <p className="text-lg font-extrabold text-[var(--sp-ink)]">{topicTitle}</p>
        <p className="text-sm text-[var(--sp-text-2)]">
          {percent !== null
            ? `Bài kiểm tra: ${result?.correct_count}/${result?.total_questions} câu (${percent}%). Câu sai và giải thích ở cuối trang.`
            : "Ôn lại tóm tắt và câu hỏi lồng của buổi này."}
        </p>
      </div>
      {percent !== null && (
        <a href="#quiz-review" className="sp-btn sp-btn-primary px-4 py-2.5 text-sm">
          Xem câu sai
        </a>
      )}
    </section>
  );
}

/* Câu sai và giải thích của bài kiểm tra (chế độ Xem lại) */
export function RevisitQuizReview({
  result,
  loading,
  error,
  materialsHref,
}: {
  result: AttemptResult | null;
  loading: boolean;
  error: string;
  materialsHref: string;
}) {
  if (loading) {
    return <p className="sp-card p-6 text-sm text-[var(--sp-muted)]">Đang tải bài kiểm tra của buổi này…</p>;
  }
  if (error) {
    return (
      <p className="sp-card flex items-center gap-2 p-6 text-sm font-medium text-[var(--sp-pink-dark)]">
        <IconAlert size={16} /> {error}
      </p>
    );
  }
  if (!result) return null;
  const percent = percentOf(result);
  const level =
    percent >= 80
      ? { label: "Nắm vững", chip: "bg-emerald-600 text-white" }
      : percent >= 50
        ? { label: "Cần ôn lại", chip: "bg-[var(--sp-yellow)] text-[var(--sp-purple-deep)]" }
        : { label: "Ôn cấp tốc", chip: "bg-[var(--sp-pink)] text-white" };

  return (
    <section id="quiz-review" className="scroll-mt-24 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="sp-accent text-[17px] text-[var(--sp-pink)]">Bài kiểm tra của buổi này</p>
          <h2 className="text-[24px] text-[var(--sp-ink)]">Câu sai và giải thích</h2>
        </div>
        <Link href={`/quiz-results/${result.attempt_id}`} className="text-sm font-bold text-[var(--sp-peri-dark)] hover:underline">
          Mở trang kết quả đầy đủ
        </Link>
      </div>
      <WrongAnswerReview
        results={result.results}
        correct={result.correct_count}
        total={result.total_questions}
        percent={percent}
        levelLabel={level.label}
        levelChip={level.chip}
        weakNumbers={new Set<number>()}
        mistakes={[]}
        weakHints={[]}
        materialsHref={materialsHref}
      />
    </section>
  );
}

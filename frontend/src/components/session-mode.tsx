"use client";

import { tx } from "@/lib/i18n";
import { scoreLevel } from "@/lib/score-rules";
/*
 * Trang Tài liệu học tập mở theo 3 chế độ (từ lịch tháng):
 * - learn: học như bình thường (không có khối riêng);
 * - review: buổi ôn lại, trả lời Tự kiểm tra nhanh để mở bài kiểm tra lại;
 * - revisit: xem lại buổi đã học, nút Xem câu sai dẫn sang trang kết quả bài kiểm tra.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { type ReviewQuestion } from "@/components/wrong-answer-review";
import { IconRepeat } from "@/components/icons";

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
  if (!response.ok) throw new Error(data?.detail || tx("Không thể tải dữ liệu."));
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
        if (!response.ok) throw new Error(data?.detail || tx("Không thể tải kết quả bài kiểm tra."));
        if (!cancelled) setState({ result: { ...data, attempt_id: attempt.attempt_id }, loading: false, error: "" });
      } catch (error) {
        if (!cancelled) {
          setState({
            result: null,
            loading: false,
            error: error instanceof Error ? error.message : tx("Không thể tải kết quả bài kiểm tra."),
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
        <p className="sp-accent text-[var(--sp-pink-dark)]">{tx("Buổi ôn lại")}</p>
        <p className="flex items-center gap-2 text-lg font-extrabold text-[var(--sp-ink)]">
          <IconRepeat size={18} className="shrink-0 text-[var(--sp-pink-dark)]" />
          {topicTitle}
        </p>
        <ul className="mt-1.5 space-y-0.5 text-sm text-[var(--sp-text-2)]">
          {percent !== null && (
            <li>
              {tx("Lần kiểm tra trước: {0}/{1} câu ({2}%)", [result?.correct_count, result?.total_questions, percent])}</li>
          )}
          <li>{tx("Đọc lại tóm tắt, trả lời phần Tự kiểm tra nhanh bên phải để mở bài kiểm tra lại.")}</li>
          <li>

            {tx("Bài kiểm tra lại:")}{" "}
            {percent !== null && scoreLevel(percent) === "weak"
              ? tx("trắc nghiệm kết hợp điền khuyết (vì lần trước dưới 50%)")
              : tx("trắc nghiệm")}

            {tx(". Cần đạt từ 80%.")}
          </li>
        </ul>
      </section>
    );
  }

  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border-2 border-[var(--sp-purple)] bg-[var(--sp-lav)] px-5 py-4 shadow-[4px_4px_0_var(--sp-lav-line)]">
      <div className="min-w-0">
        <p className="sp-accent text-[var(--sp-pink)]">{tx("Xem lại buổi đã học")}</p>
        <p className="text-lg font-extrabold text-[var(--sp-ink)]">{topicTitle}</p>
        <p className="text-sm text-[var(--sp-text-2)]">
          {percent !== null
            ? tx("Bài kiểm tra: {0}/{1} câu ({2}%).", [result?.correct_count, result?.total_questions, percent])
            : tx("Ôn lại tóm tắt và câu hỏi lồng của buổi này.")}
        </p>
      </div>
      {percent !== null && result && (
        <Link href={`/quiz-results/${result.attempt_id}`} className="sp-btn sp-btn-primary px-4 py-2.5 text-sm">

          {tx("Xem câu sai")}
        </Link>
      )}
    </section>
  );
}

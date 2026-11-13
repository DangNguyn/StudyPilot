
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getMainTopicTitle } from "@/lib/content-titles";

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

export default function QuizzesPage() {
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [attempts, setAttempts] = useState<QuizAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [expandedWeeks, setExpandedWeeks] = useState<Record<string, boolean>>(
    {}
  );

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(
          "http://127.0.0.1:8000/api/quizzes"
        );

        const result = await response.json();

        if (!response.ok) {
          throw new Error(
            result.detail || "Không thể tải danh sách bài kiểm tra."
          );
        }

        setQuizzes(result.data || []);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Đã xảy ra lỗi khi tải bài kiểm tra."
        );
      } finally {
        setLoading(false);
      }

      try {
        const response = await fetch(
          "http://127.0.0.1:8000/api/quiz-attempts"
        );

        const result = await response.json();

        if (!response.ok) {
          throw new Error(
            result.detail || "Không thể tải lịch sử làm bài."
          );
        }

        setAttempts(result.data || []);
      } catch (err) {
        setHistoryError(
          err instanceof Error
            ? err.message
            : "Đã xảy ra lỗi khi tải lịch sử."
        );
      } finally {
        setHistoryLoading(false);
      }
    };

    fetchData();
  }, []);

  const formatDate = (value?: string | null) => {
    if (!value) return "Chưa xác định";

    return new Date(value).toLocaleDateString("vi-VN");
  };

  
    const formatDuration = (
    seconds = 0,
    requiredSeconds = 300
  ) => {
    const remaining = Math.max(0, requiredSeconds - seconds);
    const minutes = Math.ceil(remaining / 60);

    return minutes > 0
      ? `${minutes} phút`
      : "Đã đủ thời gian học";
  };

  // Chỉ cho phép bắt đầu Quiz khi backend xác nhận đã mở khóa
  const canStartQuiz = (quiz: Quiz) => {
    return quiz.is_unlocked === true;
  };

  // Hiển thị lý do khóa do backend trả về
    const getLockMessage = (quiz: Quiz) => {
    if (quiz.lock_reason) {
      return quiz.lock_reason;
    }

    if (quiz.is_retake) {
      if (quiz.review_status === "completed") {
        return "Đã hoàn thành bài kiểm tra lại";
      }

      return `Cần ôn lại tài liệu thêm ${formatDuration(
        quiz.review_study_seconds,
        900
      )}`;
    }

    if (quiz.session_status !== "completed") {
      return "Cần hoàn thành buổi học trước";
    }

    return "Quiz đã sẵn sàng để làm.";
  };

  const planGroups = quizzes.reduce<Record<string, Quiz[]>>(
    (groups, quiz) => {
      const key = quiz.exam_plan_id || "unassigned";

      if (!groups[key]) {
        groups[key] = [];
      }

      groups[key].push(quiz);
      return groups;
    },
    {}
  );

  const sortedPlanGroups = Object.entries(planGroups);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8">
        <p className="text-sm font-medium text-[#829080]">
          KIỂM TRA KIẾN THỨC
        </p>

        <h1 className="mt-2 text-3xl font-bold text-[#355642]">
          Bài kiểm tra của bạn
        </h1>

        <p className="mt-2 text-sm text-[#829080]">
          Hoàn thành nội dung học tập trước khi kiểm tra và củng cố
          kiến thức qua các bài ôn tập lại.
        </p>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-[#E2E5DC] bg-white p-5">
          <p className="text-sm text-[#829080]">
            Tổng số bài kiểm tra
          </p>
          <p className="mt-2 text-3xl font-bold text-[#355642]">
            {quizzes.length}
          </p>
        </div>

        <div className="rounded-2xl border border-[#E2E5DC] bg-white p-5">
          <p className="text-sm text-[#829080]">
            Tổng lượt làm bài
          </p>
          <p className="mt-2 text-3xl font-bold text-[#355642]">
            {attempts.length}
          </p>
        </div>

        <div className="rounded-2xl border border-[#E2E5DC] bg-white p-5">
          <p className="text-sm text-[#829080]">
            Bài kiểm tra đã mở
          </p>
          <p className="mt-2 text-3xl font-bold text-[#54765D]">
            {quizzes.filter(canStartQuiz).length}
          </p>
        </div>
      </div>

      <div className="mb-5">
        <h2 className="text-xl font-bold text-[#355642]">
          Danh sách bài kiểm tra
        </h2>
        <p className="mt-1 text-sm text-[#829080]">
          Các bài kiểm tra được sắp xếp theo kế hoạch và ngày học.
        </p>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-[#E2E5DC] bg-white p-10 text-center text-[#829080]">
          Đang tải danh sách bài kiểm tra...
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-white p-6 text-red-600">
          {error}
        </div>
      ) : quizzes.length === 0 ? (
        <div className="rounded-2xl border border-[#E2E5DC] bg-white p-10 text-center">
          <div className="text-4xl">📝</div>
          <h3 className="mt-4 font-bold text-[#355642]">
            Chưa có bài kiểm tra nào
          </h3>
          <p className="mt-2 text-sm text-[#829080]">
            Hãy tải tài liệu và hoàn thành các bước học tập để tạo bài kiểm tra.
          </p>
          <Link
            href="/study-materials"
            className="mt-5 inline-block rounded-xl bg-[#54765D] px-5 py-3 text-sm font-semibold text-white hover:bg-[#355642]"
          >
            Đến tài liệu học tập
          </Link>
        </div>
      ) : (
        <div className="space-y-7">
            {sortedPlanGroups.map(([planId, planQuizzes]) => {
            return (
              <section
                key={planId}
                className="rounded-2xl border border-[#E2E5DC] bg-white p-5 sm:p-6"
              >
                <div className="mb-5 border-b border-[#EEF0E9] pb-4">
                                    <h3 className="text-lg font-bold text-[#355642]">
                    {planQuizzes[0]?.subject_name || "Môn học chưa xác định"}
                  </h3>

                  <p className="mt-1 text-sm font-medium text-[#54765D]">
                    {planQuizzes[0]?.plan_title || "Kế hoạch ôn tập"}
                  </p>

                  <p className="mt-1 text-xs text-[#829080]">
                    {planId === "unassigned"
                      ? "Chưa liên kết kế hoạch"
                      : `Mã kế hoạch: ${planId.slice(0, 8)}`}
                  </p>
                </div>

                <div className="space-y-6">
                  {(() => {
                    const weekGroups = planQuizzes.reduce<
                      Record<string, Quiz[]>
                    >((groups, quiz) => {
                      const week = quiz.study_week ?? "unknown";
                      if (!groups[String(week)]) {
                        groups[String(week)] = [];
                      }
                      groups[String(week)].push(quiz);
                      return groups;
                    }, {});

                    const sortedWeeks = Object.entries(weekGroups).sort(
                      ([a], [b]) => {
                        const weekA = Number(a);
                        const weekB = Number(b);
                        if (Number.isNaN(weekA)) return 1;
                        if (Number.isNaN(weekB)) return -1;
                        return weekA - weekB;
                      }
                    );

                    return sortedWeeks.map(([week, weekQuizzes]) => {
                      const dayGroups = weekQuizzes.reduce<
                        Record<string, Quiz[]>
                      >((groups, quiz) => {
                        const day =
                          quiz.study_day ??
                          quiz.study_day_in_week ??
                          "unknown";
                        if (!groups[String(day)]) {
                          groups[String(day)] = [];
                        }
                        groups[String(day)].push(quiz);
                        return groups;
                      }, {});

                      const sortedDays = Object.entries(dayGroups).sort(
                        ([a], [b]) => {
                          const dayA = Number(a);
                          const dayB = Number(b);
                          if (Number.isNaN(dayA)) return 1;
                          if (Number.isNaN(dayB)) return -1;
                          return dayA - dayB;
                        }
                      );
                      const weekKey = `${planId}:${week}`;
                      const isExpanded = expandedWeeks[weekKey] ?? true;

                      return (
                        <div
                          key={weekKey}
                          className="overflow-hidden rounded-2xl border border-[#E2E5DC] bg-[#F8FAF6]"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedWeeks((current) => ({
                                ...current,
                                [weekKey]: !isExpanded,
                              }))
                            }
                            className="flex w-full items-center justify-between px-5 py-4 text-left"
                          >
                            <span className="font-bold text-[#355642]">
                              {week === "unknown"
                                ? "Bài kiểm tra chưa phân tuần"
                                : `Tuần ${week}`}
                            </span>
                            <span className="text-sm text-[#829080]">
                              {weekQuizzes.length} bài kiểm tra{" "}
                              <span className="ml-2 text-base">
                                {isExpanded ? "⌃" : "⌄"}
                              </span>
                            </span>
                          </button>

                          {isExpanded && (
                            <div className="grid grid-cols-1 gap-4 border-t border-[#E2E5DC] p-4 md:grid-cols-3">
                              {sortedDays.map(([day, dayQuizzes]) => (
                                <div
                                  key={`${weekKey}:${day}`}
                                  className="flex h-full flex-col"
                                >
                                  <h4 className="mb-3 font-semibold text-[#355642]">
                                    {day === "unknown"
                                      ? "Ngày chưa xác định"
                                      : `Ngày học ${day}`}
                                  </h4>

                                  <div className="flex flex-1 flex-col space-y-4">
                                    {dayQuizzes.map((quiz) => {
                          const unlocked = canStartQuiz(quiz);

                          return (
                            <div
                              key={quiz.id}
                              className="flex h-full flex-col rounded-xl border border-[#E2E5DC] p-5"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E8EEE4] text-xl">
                                  {quiz.is_retake ? "🔄" : "📝"}
                                </div>

                                <span
                                  className={`rounded-lg px-3 py-1 text-xs font-semibold ${
                                    unlocked
                                      ? "bg-[#E8EEE4] text-[#54765D]"
                                      : quiz.is_retake &&
                                          quiz.review_status === "completed"
                                        ? "bg-gray-100 text-gray-500"
                                        : "bg-[#FFF2DF] text-[#A87536]"
                                  }`}
                                >
                                  {unlocked
                                    ? "Đã mở"
                                    : quiz.is_retake &&
                                        quiz.review_status === "completed"
                                      ? "Đã hoàn thành"
                                      : "Đang khóa"}
                                </span>
                              </div>

                                <h5 className="mt-4 font-bold text-[#355642]">
                                {quiz.is_retake
                                    ? `Kiểm tra lại: ${getMainTopicTitle(
                                        quiz.topic_name || quiz.title
                                      )}`
                                    : getMainTopicTitle(
                                        quiz.topic_name || quiz.title
                                      )}
                              </h5>

                              <p className="mt-1 text-sm font-medium text-[#54765D]">
                                {quiz.is_retake
                                  ? "Bài kiểm tra củng cố kiến thức chưa vững"
                                  : "Bài kiểm tra kiến thức chương này"}
                              </p>

                              <div className="mt-4 flex flex-wrap gap-3 text-xs text-[#829080]">
                                <span>
                                  ⏱️{" "}
                                  {quiz.time_limit_minutes
                                    ? `${quiz.time_limit_minutes} phút`
                                    : "Không giới hạn"}
                                </span>

                                <span>
                                  📅 {formatDate(
                                    quiz.scheduled_start || quiz.created_at
                                  )}
                                </span>
                              </div>

                              <div className="mt-auto border-t border-[#EEF0E9] pt-4">
                                {unlocked ? (
                                  <Link
                                    href={`/quizzes/${quiz.id}`}
                                    className="block rounded-xl bg-[#54765D] px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-[#355642]"
                                  >
                                    Bắt đầu làm bài →
                                  </Link>
                                ) : (
                                  <div className="rounded-xl bg-[#F5F5F0] px-4 py-3 text-center text-sm font-medium text-[#829080]">
                                    {getLockMessage(quiz)}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <div className="mb-5 mt-12">
        <h2 className="text-xl font-bold text-[#355642]">
          Lịch sử làm bài
        </h2>
        <p className="mt-1 text-sm text-[#829080]">
          Theo dõi kết quả các lần kiểm tra trước đây.
        </p>
      </div>

      {historyLoading ? (
        <div className="rounded-2xl border border-[#E2E5DC] bg-white p-8 text-center text-[#829080]">
          Đang tải lịch sử làm bài...
        </div>
      ) : historyError ? (
        <div className="rounded-2xl border border-red-200 bg-white p-6 text-red-600">
          {historyError}
        </div>
      ) : attempts.length === 0 ? (
        <div className="rounded-2xl border border-[#E2E5DC] bg-white p-8 text-center">
          <div className="text-3xl">📊</div>
          <h3 className="mt-3 font-bold text-[#355642]">
            Chưa có lịch sử làm bài
          </h3>
          <p className="mt-2 text-sm text-[#829080]">
            Kết quả sẽ xuất hiện tại đây sau khi bạn hoàn thành một bài Quiz.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[#E2E5DC] bg-white">
          <div className="divide-y divide-[#EEF0E9]">
            {attempts.map((attempt) => (
              <div
                key={attempt.attempt_id}
                className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-[#355642]">
                    {attempt.quiz_title}
                  </h3>

                  <p className="mt-2 text-sm text-[#829080]">
                    {attempt.submitted_at
                      ? new Date(attempt.submitted_at).toLocaleString("vi-VN")
                      : "Chưa có thời gian nộp bài"}
                  </p>

                  <p className="mt-1 text-sm text-[#829080]">
                    Số câu đúng: {attempt.correct_count}/
                    {attempt.total_questions}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-5 sm:justify-end">
                  <div className="text-right">
                    <p className="text-xs text-[#829080]">
                      Điểm số
                    </p>

                    <p
                      className={`mt-1 text-2xl font-bold ${
                        attempt.score > 80
                          ? "text-[#54765D]"
                          : attempt.score >= 50
                            ? "text-[#C58D3D]"
                            : "text-[#B65C50]"
                      }`}
                    >
                      {Number(attempt.score).toFixed(0)}/100
                    </p>
                  </div>

                  <Link
                    href={`/quiz-results/${attempt.attempt_id}`}
                    className="whitespace-nowrap rounded-xl border border-[#DCE5D8] px-4 py-2.5 text-sm font-semibold text-[#54765D] transition hover:bg-[#E8EEE4]"
                  >
                    Xem kết quả →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

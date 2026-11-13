
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getMainTopicTitle } from "@/lib/content-titles";

const API_BASE_URL = "http://127.0.0.1:8000";

interface WeakArea {
  topic_id: string;
  topic_name: string;
  description: string | null;
  total_answers: number;
  correct_answers: number;
  incorrect_answers: number;
  accuracy: number;
  level: string;
  level_label: string;
}

interface AnalyticsResponse {
  total_submitted_attempts: number;
  total_graded_answers: number;
  weak_areas: WeakArea[];
}

interface StudyRecommendation {
  topic_id: string;
  topic_name: string;
  priority: "high" | "medium";
  reason: string;
  study_actions: string[] | null;
  estimated_minutes: number;
}

interface RecommendationResponse {
  success: boolean;
  message: string;
  analysis_summary: string;
  recommendations: StudyRecommendation[] | null;
}

interface AIAssessmentHistory {
  id: string;
  mastery_level: "mastered" | "needs_review" | "not_mastered";
  summary: string;
  strengths: {
    topic_name: string;
    description: string;
  }[];
  weak_areas: {
    topic_name: string;
    description: string;
    source_page: number | null;
    source_content: string | null;
    recommendation: string;
  }[];
  recommendations: string[];
  created_at: string;
}

interface ReviewPlanHistory {
  id: string;
  overall_goal: string | null;
  status: string;
  retake_quiz_id: string | null;
  retake_quiz_title?: string;
  retake_attempt_count?: number;
  review_items?: {
    topic_name: string;
    description: string;
    recommendation: string;
  }[];
}

interface RetakeAttemptHistory {
  attempt_id: string;
  score: number;
  correct_count: number;
  total_questions: number;
  started_at: string;
  submitted_at: string;
  status: string;
}

interface QuizAttemptHistory {
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
  ai_assessment: AIAssessmentHistory | null;
  review_plan: ReviewPlanHistory | null;
  retake_attempts?: RetakeAttemptHistory[] | null;
}

// Chuyển nội dung lỗi API thành chuỗi dễ đọc.
function getErrorMessage(
  detail: unknown,
  fallback: string
): string {
  if (typeof detail === "string" && detail.trim()) {
    return detail;
  }

  if (Array.isArray(detail)) {
    const messages = detail.map((item) => {
      if (typeof item === "string") {
        return item;
      }

      if (
        typeof item === "object" &&
        item !== null &&
        "msg" in item
      ) {
        return String(item.msg);
      }

      return JSON.stringify(item) ?? fallback;
    });

    return messages.join("; ");
  }

  if (detail && typeof detail === "object") {
    return JSON.stringify(detail) ?? fallback;
  }

  return fallback;
}

// Đọc thông tin lỗi từ phản hồi API.
function getResponseDetail(payload: unknown): unknown {
  if (
    payload &&
    typeof payload === "object" &&
    "detail" in payload
  ) {
    return payload.detail;
  }

  if (
    payload &&
    typeof payload === "object" &&
    "message" in payload
  ) {
    return payload.message;
  }

  return undefined;
}

// Kiểm tra dữ liệu phản hồi có phải object hay không.
function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

// Đọc JSON an toàn, tránh lỗi khi API trả về nội dung không hợp lệ.
async function readResponseJson(
  response: Response
): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export default function WeakAreasPage() {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [recommendation, setRecommendation] =
    useState<RecommendationResponse | null>(null);

  const [generating, setGenerating] = useState(false);
  const [recommendationError, setRecommendationError] = useState("");

  const [selectedSchedule, setSelectedSchedule] = useState<
    Record<string, string>
  >({});

  const [savingTopicId, setSavingTopicId] = useState("");

  const [createdSessions, setCreatedSessions] = useState<
    Record<string, boolean>
  >({});

  const [sessionMessages, setSessionMessages] = useState<
    Record<string, string>
  >({});

  const [quizHistory, setQuizHistory] = useState<QuizAttemptHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");

  // Lấy dữ liệu đánh giá năng lực.
  useEffect(() => {
    const controller = new AbortController();

    const fetchWeakAreas = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/analytics/weak-areas`,
          { signal: controller.signal }
        );

        const result = await readResponseJson(response);

        if (!response.ok) {
          throw new Error(
            getErrorMessage(
              getResponseDetail(result),
              "Không thể tải dữ liệu phân tích điểm yếu."
            )
          );
        }

        if (!isRecord(result)) {
          throw new Error("Dữ liệu phân tích trả về không hợp lệ.");
        }

        const weakAreas = Array.isArray(result.weak_areas)
          ? (result.weak_areas as WeakArea[])
          : [];

        const analyticsData: AnalyticsResponse = {
          total_submitted_attempts: Number(
            result.total_submitted_attempts ?? 0
          ),
          total_graded_answers: Number(
            result.total_graded_answers ?? 0
          ),
          weak_areas: weakAreas,
        };

        if (!controller.signal.aborted) {
          setData(analyticsData);
        }
      } catch (err) {
        if (controller.signal.aborted) return;

        setError(
          err instanceof Error
            ? err.message
            : "Đã xảy ra lỗi khi tải dữ liệu."
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    fetchWeakAreas();

    return () => controller.abort();
  }, []);

  // Lấy lịch sử làm Quiz và đánh giá AI.
  useEffect(() => {
    const controller = new AbortController();

    const fetchQuizHistory = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/quiz-attempts`,
          { signal: controller.signal }
        );

        const result = await readResponseJson(response);

        if (!response.ok) {
          throw new Error(
            getErrorMessage(
              getResponseDetail(result),
              "Không thể tải lịch sử làm bài Quiz."
            )
          );
        }

        let historyData: unknown[] = [];

        if (Array.isArray(result)) {
          historyData = result;
        } else if (
          isRecord(result) &&
          Array.isArray(result.data)
        ) {
          historyData = result.data;
        }

        if (!controller.signal.aborted) {
          setQuizHistory(
            historyData as QuizAttemptHistory[]
          );
        }
      } catch (err) {
        if (controller.signal.aborted) return;

        setHistoryError(
          err instanceof Error
            ? err.message
            : "Đã xảy ra lỗi khi tải lịch sử Quiz."
        );
      } finally {
        if (!controller.signal.aborted) {
          setHistoryLoading(false);
        }
      }
    };

    fetchQuizHistory();

    return () => controller.abort();
  }, []);

  // Gọi AI tạo đề xuất ôn tập.
  const handleGenerateRecommendations = async () => {
    setGenerating(true);
    setRecommendationError("");
    setRecommendation(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/analytics/study-recommendations`,
        {
          method: "POST",
        }
      );

      const result = await readResponseJson(response);

      if (!response.ok) {
        throw new Error(
          getErrorMessage(
            getResponseDetail(result),
            "Không thể tạo đề xuất ôn tập."
          )
        );
      }

      if (!isRecord(result)) {
        throw new Error("Dữ liệu đề xuất từ AI không hợp lệ.");
      }

      if (result.success === false) {
        throw new Error(
          getErrorMessage(
            result.message,
            "AI không thể tạo đề xuất ôn tập."
          )
        );
      }

      const recommendations = Array.isArray(
        result.recommendations
      )
        ? (result.recommendations as StudyRecommendation[])
        : null;

      const recommendationData: RecommendationResponse = {
        success: result.success !== false,
        message:
          typeof result.message === "string"
            ? result.message
            : "",
        analysis_summary:
          typeof result.analysis_summary === "string"
            ? result.analysis_summary
            : "",
        recommendations,
      };

      setRecommendation(recommendationData);
    } catch (err) {
      setRecommendationError(
        err instanceof Error
          ? err.message
          : "Đã xảy ra lỗi khi gọi AI."
      );
    } finally {
      setGenerating(false);
    }
  };

  // Tạo buổi học từ đề xuất AI.
  const handleCreateStudySession = async (
    item: StudyRecommendation
  ) => {
    const scheduledStart = selectedSchedule[item.topic_id];

    if (!scheduledStart) {
      setSessionMessages((prev) => ({
        ...prev,
        [item.topic_id]: "Vui lòng chọn ngày và giờ ôn tập.",
      }));
      return;
    }

    const scheduledDate = new Date(scheduledStart);

    if (Number.isNaN(scheduledDate.getTime())) {
      setSessionMessages((prev) => ({
        ...prev,
        [item.topic_id]: "Ngày giờ không hợp lệ. Vui lòng chọn lại.",
      }));
      return;
    }

    if (scheduledDate.getTime() <= Date.now()) {
      setSessionMessages((prev) => ({
        ...prev,
        [item.topic_id]: "Vui lòng chọn thời gian trong tương lai.",
      }));
      return;
    }

    setSavingTopicId(item.topic_id);

    setSessionMessages((prev) => ({
      ...prev,
      [item.topic_id]: "",
    }));

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/study-sessions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            topic_id: item.topic_id,
            scheduled_start: scheduledDate.toISOString(),
            duration_minutes: item.estimated_minutes || 30,
            status: "scheduled",
            source: "ai",
            notes: `Buổi học được tạo từ đề xuất AI: ${item.reason}`,
          }),
        }
      );

      const result = await readResponseJson(response);

      if (!response.ok) {
        throw new Error(
          getErrorMessage(
            getResponseDetail(result),
            "Không thể tạo buổi học."
          )
        );
      }

      setCreatedSessions((prev) => ({
        ...prev,
        [item.topic_id]: true,
      }));

      setSessionMessages((prev) => ({
        ...prev,
        [item.topic_id]:
          "Đã thêm buổi học vào lịch học thành công!",
      }));
    } catch (err) {
      setSessionMessages((prev) => ({
        ...prev,
        [item.topic_id]:
          err instanceof Error
            ? err.message
            : "Đã xảy ra lỗi khi tạo buổi học.",
      }));
    } finally {
      setSavingTopicId("");
    }
  };

  // Tính tỷ lệ đúng trung bình.
  const averageAccuracy =
    data && data.weak_areas.length > 0
      ? data.weak_areas.reduce(
          (sum, item) => sum + Number(item.accuracy || 0),
          0
        ) / data.weak_areas.length
      : 0;

  // Phân loại mức độ nắm vững kiến thức.
  const getLevelStyle = (level: string) => {
    switch (level) {
      case "weak":
        return {
          color: "bg-red-100 text-red-700",
          bar: "bg-red-500",
        };

      case "improving":
        return {
          color: "bg-amber-100 text-amber-700",
          bar: "bg-amber-500",
        };

      default:
        return {
          color: "bg-green-100 text-green-700",
          bar: "bg-green-500",
        };
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-600">
        Đang phân tích kết quả học tập...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <p className="rounded-xl bg-red-50 p-4 text-red-700">
          {error}
        </p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="min-h-screen bg-[#F8F7F4] p-6 md:p-8">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-8">
          <p className="mb-2 text-sm font-medium text-[#5D856C]">
            STUDYPILOT / LEARNING ANALYTICS
          </p>

          <h1 className="text-3xl font-bold text-gray-900">
            Phân tích điểm yếu
          </h1>

          <p className="mt-2 text-gray-600">
            Theo dõi mức độ nắm vững kiến thức và xác định
            những chủ đề cần ưu tiên ôn tập.
          </p>
        </div>

        {/* Summary Cards */}
        <div className="mb-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <p className="text-sm text-gray-500">
              Số lượt làm bài đã nộp
            </p>

            <h2 className="mt-3 text-3xl font-bold text-gray-900">
              {data.total_submitted_attempts}
            </h2>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <p className="text-sm text-gray-500">
              Số câu trả lời đã chấm
            </p>

            <h2 className="mt-3 text-3xl font-bold text-gray-900">
              {data.total_graded_answers}
            </h2>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <p className="text-sm text-gray-500">
              Tỷ lệ đúng trung bình theo chủ đề
            </p>

            <h2 className="mt-3 text-3xl font-bold text-[#5D856C]">
              {averageAccuracy.toFixed(1)}%
            </h2>
          </div>
        </div>

        {/* AI Study Recommendations */}
        <div className="mb-10 rounded-2xl border border-[#DCE6DA] bg-white p-6 shadow-sm md:p-8">
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-center">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded-lg bg-[#E6EDE4] p-2 text-lg">
                  ✨
                </span>

                <p className="text-sm font-semibold text-[#5D856C]">
                  STUDYPILOT AI
                </p>
              </div>

              <h2 className="text-xl font-bold text-gray-900">
                Đề xuất ôn tập cá nhân hóa
              </h2>

              <p className="mt-2 text-sm text-gray-500">
                AI phân tích kết quả Quiz và đề xuất phương pháp
                cải thiện những kiến thức bạn chưa nắm vững.
              </p>
            </div>

            <button
              onClick={handleGenerateRecommendations}
              disabled={generating || data.weak_areas.length === 0}
              className="shrink-0 rounded-xl bg-[#355642] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#294532] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generating
                ? "AI đang phân tích..."
                : recommendation
                  ? "Tạo lại đề xuất"
                  : "Tạo đề xuất ôn tập bằng AI"}
            </button>
          </div>

          {recommendationError && (
            <div className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">
              {recommendationError}
            </div>
          )}

          {generating && (
            <div className="mt-6 rounded-xl bg-[#F7F8F4] p-6 text-center">
              <p className="font-medium text-[#355642]">
                AI đang phân tích kết quả học tập của bạn...
              </p>

              <p className="mt-2 text-sm text-gray-500">
                Vui lòng chờ trong giây lát.
              </p>
            </div>
          )}

          {recommendation && !generating && (
            <div className="mt-6 border-t border-gray-100 pt-6">
              <div className="mb-6 rounded-xl bg-[#F0F4ED] p-5">
                <h3 className="font-semibold text-[#355642]">
                  Nhận xét từ AI
                </h3>

                <p className="mt-2 text-sm leading-7 text-gray-700">
                  {recommendation.analysis_summary ||
                    recommendation.message}
                </p>
              </div>

              {!recommendation.recommendations?.length ? (
                <div className="rounded-xl border border-gray-100 p-6 text-center">
                  <h3 className="font-semibold text-gray-800">
                    Bạn đang có tiến độ học tập tốt!
                  </h3>

                  <p className="mt-2 text-sm text-gray-500">
                    {recommendation.message}
                  </p>
                </div>
              ) : (
                <div>
                  <h3 className="mb-4 font-bold text-gray-900">
                    Kế hoạch ôn tập được đề xuất
                  </h3>

                  <div className="space-y-4">
                    {recommendation.recommendations.map(
                      (item, index) => (
                        <div
                          key={`${item.topic_id}-${index}`}
                          className="rounded-xl border border-gray-100 p-5"
                        >
                          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                            <div>
                              <p className="text-xs font-semibold text-[#5D856C]">
                                CHỦ ĐỀ {index + 1}
                              </p>

                              <h4 className="mt-1 text-lg font-semibold text-gray-900">
                                {getMainTopicTitle(item.topic_name)}
                              </h4>
                            </div>

                            <span
                              className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${
                                item.priority === "high"
                                  ? "bg-red-100 text-red-700"
                                  : "bg-amber-100 text-amber-700"
                              }`}
                            >
                              {item.priority === "high"
                                ? "Ưu tiên cao"
                                : "Ưu tiên trung bình"}
                            </span>
                          </div>

                          <div className="mt-4 rounded-lg bg-[#F8F7F4] p-4">
                            <p className="text-sm font-semibold text-gray-700">
                              Vì sao cần ôn tập?
                            </p>

                            <p className="mt-1 text-sm leading-6 text-gray-600">
                              {item.reason}
                            </p>
                          </div>

                          <div className="mt-5">
                            <p className="mb-3 text-sm font-semibold text-gray-800">
                              Các hoạt động nên thực hiện
                            </p>

                            <div className="space-y-3">
                              {(item.study_actions || []).map(
                                (action, actionIndex) => (
                                  <div
                                    key={actionIndex}
                                    className="flex items-start gap-3"
                                  >
                                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#E6EDE4] text-xs font-bold text-[#355642]">
                                      {actionIndex + 1}
                                    </span>

                                    <p className="text-sm leading-6 text-gray-700">
                                      {action}
                                    </p>
                                  </div>
                                )
                              )}
                            </div>
                          </div>

                          <div className="mt-5 flex items-center gap-2 border-t border-gray-100 pt-4 text-sm">
                            <span>⏱</span>

                            <span className="font-semibold text-gray-800">
                              Thời gian dự kiến:
                            </span>

                            <span className="text-[#5D856C]">
                              {item.estimated_minutes} phút
                            </span>
                          </div>

                          <div className="mt-5 border-t border-gray-100 pt-5">
                            <h4 className="mb-3 text-sm font-semibold text-gray-800">
                              Lên lịch ôn tập
                            </h4>

                            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                              <div className="flex-1">
                                <label className="mb-2 block text-sm text-gray-600">
                                  Ngày và giờ bắt đầu
                                </label>

                                <input
                                  type="datetime-local"
                                  value={
                                    selectedSchedule[item.topic_id] || ""
                                  }
                                  onChange={(e) => {
                                    setSelectedSchedule((prev) => ({
                                      ...prev,
                                      [item.topic_id]: e.target.value,
                                    }));

                                    setCreatedSessions((prev) => ({
                                      ...prev,
                                      [item.topic_id]: false,
                                    }));

                                    setSessionMessages((prev) => ({
                                      ...prev,
                                      [item.topic_id]: "",
                                    }));
                                  }}
                                  disabled={
                                    createdSessions[item.topic_id]
                                  }
                                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-800 outline-none focus:border-[#5D856C] disabled:bg-gray-100"
                                />
                              </div>

                              <button
                                onClick={() =>
                                  handleCreateStudySession(item)
                                }
                                disabled={
                                  savingTopicId === item.topic_id ||
                                  Boolean(createdSessions[item.topic_id])
                                }
                                className="rounded-xl bg-[#355642] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#294532] disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {savingTopicId === item.topic_id
                                  ? "Đang lưu..."
                                  : createdSessions[item.topic_id]
                                    ? "Đã thêm vào lịch học"
                                    : "Thêm vào lịch học"}
                              </button>
                            </div>

                            {sessionMessages[item.topic_id] && (
                              <p
                                className={`mt-3 text-sm ${
                                  createdSessions[item.topic_id]
                                    ? "text-green-600"
                                    : "text-red-600"
                                }`}
                              >
                                {sessionMessages[item.topic_id]}
                              </p>
                            )}
                          </div>
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Quiz Assessment History */}
        <div className="mb-10">
          <div className="mb-5">
            <p className="text-sm font-semibold text-[#5D856C]">
              STUDYPILOT LEARNING HISTORY
            </p>

            <h2 className="mt-2 text-xl font-bold text-gray-900">
              Lịch sử đánh giá và ôn tập
            </h2>

            <p className="mt-2 text-sm text-gray-500">
              Theo dõi kết quả từng lần làm Quiz, đánh giá năng lực từ AI
              và tiến độ cải thiện kiến thức.
            </p>
          </div>

          {historyLoading ? (
            <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
              <p className="text-sm text-gray-500">
                Đang tải lịch sử học tập...
              </p>
            </div>
          ) : historyError ? (
            <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
              {historyError}
            </div>
          ) : quizHistory.length === 0 ? (
            <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
              <h3 className="font-semibold text-gray-800">
                Chưa có lịch sử đánh giá
              </h3>

              <p className="mt-2 text-sm text-gray-500">
                Hoàn thành một bài Quiz để xem kết quả phân tích
                và đề xuất ôn tập từ AI.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {quizHistory.map((attempt, index) => {
                const assessment = attempt.ai_assessment;
                const reviewPlan = attempt.review_plan;
                const retakeAttempts = attempt.retake_attempts || [];

                const masteryStyle =
                  assessment?.mastery_level === "mastered"
                    ? "bg-green-100 text-green-700"
                    : assessment?.mastery_level === "needs_review"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-red-100 text-red-700";

                const masteryLabel =
                  assessment?.mastery_level === "mastered"
                    ? "Đã nắm vững"
                    : assessment?.mastery_level === "needs_review"
                      ? "Cần ôn tập"
                      : assessment?.mastery_level === "not_mastered"
                        ? "Chưa nắm vững"
                        : "Chưa có đánh giá AI";

                return (
                  <div
                    key={attempt.attempt_id}
                    className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
                  >
                    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                      <div>
                        <p className="text-xs font-semibold text-[#5D856C]">
                          LẦN LÀM BÀI {quizHistory.length - index}
                        </p>

                        <h3 className="mt-1 text-lg font-bold text-gray-900">
                          {attempt.quiz_title}
                        </h3>

                        <p className="mt-1 text-sm text-gray-500">
                          Nộp bài:{" "}
                          {attempt.submitted_at
                            ? new Date(
                                attempt.submitted_at
                              ).toLocaleString("vi-VN")
                            : "Không có thông tin"}
                        </p>
                      </div>

                      <div className="rounded-xl bg-[#F4F7F2] px-5 py-3">
                        <p className="text-xs text-gray-500">
                          Điểm số
                        </p>

                        <p className="mt-1 text-2xl font-bold text-[#355642]">
                          {Number(attempt.score || 0).toFixed(1)}%
                        </p>

                        <p className="text-xs text-gray-500">
                          {attempt.correct_count}/{attempt.total_questions} câu đúng
                        </p>
                      </div>
                    </div>

                    <div className="mt-5 border-t border-gray-100 pt-5">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <h4 className="font-semibold text-gray-900">
                          Đánh giá từ AI
                        </h4>

                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${masteryStyle}`}
                        >
                          {masteryLabel}
                        </span>
                      </div>

                      {assessment ? (
                        <>
                          <p className="text-sm leading-6 text-gray-600">
                            {assessment.summary}
                          </p>

                          {assessment.strengths?.length > 0 && (
                            <div className="mt-4">
                              <p className="mb-2 text-sm font-semibold text-green-700">
                                Điểm mạnh
                              </p>

                              <div className="space-y-2">
                                {assessment.strengths.map((item, i) => (
                                  <div
                                    key={i}
                                    className="rounded-lg bg-green-50 p-3"
                                  >
                                    <p className="text-sm font-semibold text-gray-800">
                                      {getMainTopicTitle(item.topic_name)}
                                    </p>

                                    <p className="mt-1 text-sm text-gray-600">
                                      {item.description}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {assessment.weak_areas?.length > 0 && (
                            <div className="mt-4">
                              <p className="mb-2 text-sm font-semibold text-red-700">
                                Kiến thức cần cải thiện
                              </p>

                              <div className="space-y-3">
                                {assessment.weak_areas.map((item, i) => (
                                  <div
                                    key={i}
                                    className="rounded-lg border border-red-100 bg-red-50/50 p-4"
                                  >
                                    <p className="font-semibold text-gray-900">
                                      {getMainTopicTitle(item.topic_name)}
                                    </p>

                                    <p className="mt-1 text-sm text-gray-600">
                                      {item.description}
                                    </p>

                                    {item.source_page != null && (
                                      <p className="mt-2 text-xs text-gray-500">
                                        Trang tài liệu: {item.source_page}
                                      </p>
                                    )}

                                    <p className="mt-2 text-sm text-[#355642]">
                                      <span className="font-semibold">
                                        Đề xuất:
                                      </span>{" "}
                                      {item.recommendation}
                                    </p>

                                    {item.source_content && (
                                      <details className="mt-3">
                                        <summary className="cursor-pointer text-xs font-semibold text-[#5D856C]">
                                          Xem nội dung tài liệu liên quan
                                        </summary>

                                        <p className="mt-2 whitespace-pre-wrap rounded-lg bg-white p-3 text-sm leading-6 text-gray-600">
                                          {item.source_content}
                                        </p>
                                      </details>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {assessment.recommendations?.length > 0 && (
                            <div className="mt-4 rounded-xl bg-[#F4F7F2] p-4">
                              <p className="mb-2 text-sm font-semibold text-[#355642]">
                                Khuyến nghị từ AI
                              </p>

                              <ul className="list-inside list-disc space-y-1">
                                {assessment.recommendations.map(
                                  (item, i) => (
                                    <li
                                      key={i}
                                      className="text-sm leading-6 text-gray-600"
                                    >
                                      {item}
                                    </li>
                                  )
                                )}
                              </ul>
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="text-sm text-gray-500">
                          Chưa có kết quả đánh giá AI cho lần làm bài này.
                        </p>
                      )}
                    </div>

                    {reviewPlan && (
                      <div className="mt-5 rounded-xl border border-[#DCE6DA] bg-[#F8FAF6] p-5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h4 className="font-semibold text-gray-900">
                            Lộ trình ôn tập lại
                          </h4>

                          <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-[#355642]">
                            {reviewPlan.status === "completed"
                              ? "Đã hoàn thành"
                              : reviewPlan.status === "in_progress"
                                ? "Đang thực hiện"
                                : "Chờ ôn tập"}
                          </span>
                        </div>

                        {reviewPlan.overall_goal && (
                          <p className="mt-2 text-sm leading-6 text-gray-600">
                            {reviewPlan.overall_goal}
                          </p>
                        )}

                        {(reviewPlan.review_items || []).length > 0 && (
                          <div className="mt-4 space-y-2">
                            {(reviewPlan.review_items || []).map(
                              (item, i) => (
                                <div
                                  key={i}
                                  className="rounded-lg bg-white p-3"
                                >
                                  <p className="text-sm font-semibold text-gray-800">
                                    {getMainTopicTitle(item.topic_name)}
                                  </p>

                                  <p className="mt-1 text-sm text-gray-600">
                                    {item.recommendation}
                                  </p>
                                </div>
                              )
                            )}
                          </div>
                        )}

                        {reviewPlan.retake_quiz_id && (
                          <div className="mt-4 border-t border-[#DCE6DA] pt-4">
                            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                              <div>
                                <p className="text-sm font-semibold text-gray-800">
                                  {reviewPlan.retake_quiz_title ||
                                    "Quiz ôn tập lại"}
                                </p>

                                <p className="mt-1 text-xs text-gray-500">
                                  Đã thực hiện{" "}
                                  {reviewPlan.retake_attempt_count ?? 0} lần
                                </p>
                              </div>

                              {reviewPlan.status === "completed" ? (
                                <span className="rounded-xl bg-green-100 px-5 py-3 text-center text-sm font-semibold text-green-700">
                                  Đã hoàn thành ôn tập
                                </span>
                              ) : (
                                <Link
                                  href={`/review-plans/${reviewPlan.id}`}
                                  className="rounded-xl bg-[#355642] px-5 py-3 text-center text-sm font-semibold text-white transition hover:bg-[#294532]"
                                >
                                  Xem nội dung ôn tập →
                                </Link>
                              )}
                            </div>

                            {retakeAttempts.length > 0 && (
                              <div className="mt-4 space-y-2">
                                <p className="text-sm font-semibold text-gray-800">
                                  Lịch sử Quiz ôn tập
                                </p>

                                {retakeAttempts.map((retake, i) => (
                                  <div
                                    key={retake.attempt_id}
                                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-3"
                                  >
                                    <div>
                                      <p className="text-sm font-medium text-gray-800">
                                        Lần {retakeAttempts.length - i}
                                      </p>

                                      <p className="text-xs text-gray-500">
                                        {retake.submitted_at
                                          ? new Date(
                                              retake.submitted_at
                                            ).toLocaleString("vi-VN")
                                          : "Không có thông tin"}
                                      </p>
                                    </div>

                                    <div className="text-right">
                                      <p className="font-bold text-[#355642]">
                                        {Number(
                                          retake.score || 0
                                        ).toFixed(1)}%
                                      </p>

                                      <p className="text-xs text-gray-500">
                                        {retake.correct_count}/
                                        {retake.total_questions} câu đúng
                                      </p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Topic Analysis */}
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">
            Kết quả theo từng chủ đề
          </h2>

          <span className="text-sm text-gray-500">
            {data.weak_areas.length} chủ đề
          </span>
        </div>

        {data.weak_areas.length === 0 ? (
          <div className="rounded-2xl border border-gray-100 bg-white p-10 text-center shadow-sm">
            <h3 className="text-lg font-semibold text-gray-800">
              Chưa có dữ liệu phân tích
            </h3>

            <p className="mt-2 text-gray-500">
              Hãy hoàn thành và nộp bài Quiz để StudyPilot
              phân tích mức độ hiểu bài của bạn.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {data.weak_areas.map((item) => {
              const style = getLevelStyle(item.level);

              return (
                <div
                  key={item.topic_id}
                  className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
                >
                  <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-gray-900">
                        {getMainTopicTitle(item.topic_name)}
                      </h3>

                      <p className="mt-2 text-sm text-gray-500">
                        {item.description || "Chưa có mô tả chủ đề."}
                      </p>
                    </div>

                    <span
                      className={`w-fit rounded-full px-3 py-1 text-sm font-medium ${style.color}`}
                    >
                      {item.level_label}
                    </span>
                  </div>

                  {/* Accuracy */}
                  <div className="mt-6">
                    <div className="mb-2 flex justify-between">
                      <span className="text-sm font-medium text-gray-600">
                        Tỷ lệ trả lời đúng
                      </span>

                      <span className="font-bold text-gray-900">
                        {item.accuracy}%
                      </span>
                    </div>

                    <div className="h-3 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className={`h-full rounded-full transition-all ${style.bar}`}
                        style={{
                          width: `${Math.min(
                            100,
                            Math.max(0, Number(item.accuracy) || 0)
                          )}%`,
                        }}
                      />
                    </div>
                  </div>

                  {/* Answer Statistics */}
                  <div className="mt-5 grid grid-cols-3 gap-3 border-t border-gray-100 pt-5">
                    <div>
                      <p className="text-xs text-gray-500">
                        Tổng số câu
                      </p>

                      <p className="mt-1 text-xl font-bold text-gray-900">
                        {item.total_answers}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs text-gray-500">
                        Câu trả lời đúng
                      </p>

                      <p className="mt-1 text-xl font-bold text-green-600">
                        {item.correct_answers}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs text-gray-500">
                        Câu trả lời sai
                      </p>

                      <p className="mt-1 text-xl font-bold text-red-600">
                        {item.incorrect_answers}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}


"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getMainTopicTitle } from "@/lib/content-titles";

interface QuestionResult {
  question_id: string;
  question_text: string;
  selected_answer: string | string[] | null;
  correct_answer: string | string[];
  is_correct: boolean;
  earned_points: number;
  explanation: string | null;
  source_location?: {
    page_number: number | null;
    chunk_index: number | null;
    material_id: string | null;
    content?: string | null;
  } | null;
}

interface AssessmentItem {
  topic_name?: string;
  hierarchy?: string;
  description?: string;
  recommendation?: string;
  reason?: string;
  content?: string;
  source_page?: number | null;
  source_chunk_id?: string | null;
  scheduled_date?: string | null;
}

interface AIWeakArea extends AssessmentItem {
  topic_name: string;
  description: string;
  recommendation: string;
}

interface AIAssessment {
  id: string;
  mastery_level: "mastered" | "needs_review" | "not_mastered";
  summary: string;
  strengths: (AssessmentItem | string)[] | null;
  weak_areas: (AIWeakArea | string)[] | null;
  recommendations: string[] | null;
  ai_model: string;
  assessment_status: string;
  created_at: string;
}

interface ReviewPlan {
  id: string;
  assessment_id: string;
  review_items: AIWeakArea[];
  overall_goal: string | null;
  status: string;
  retake_quiz_id: string | null;
  review_study_seconds?: number;
}

function formatReviewDate(value?: string | null): string {
  if (!value) {
    return "Chưa xếp ngày";
  }

  return new Date(`${value}T00:00:00`).toLocaleDateString(
    "vi-VN",
    {
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }
  );
}

interface QuizResult {
  attempt_id: string;
  quiz_id: string;
  title: string;
  score: number;
  correct_count: number;
  total_questions: number;
  earned_points: number;
  total_points: number;
  status: string;
  results: QuestionResult[];
  ai_assessment: AIAssessment | null;
  review_plan: ReviewPlan | null;
}

function formatAnswer(
  value: string | string[] | null | undefined
): string {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "Chưa trả lời";
  }

  return Array.isArray(value)
    ? value.join(", ")
    : value;
}

export default function QuizResultPage() {
  const params = useParams();
  const attemptId = params.attemptId as string;

  const [result, setResult] = useState<QuizResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAssessment, setShowAssessment] = useState(false);

  // 1. Lấy kết quả bài kiểm tra
  useEffect(() => {
    let cancelled = false;

    const fetchResult = async () => {
      setLoading(true);
      setError("");
      setResult(null);
      setShowAssessment(false);

      if (!attemptId) {
        setError("Không tìm thấy mã lượt làm bài.");
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(
          `http://127.0.0.1:8000/api/quiz-attempts/${attemptId}/result`
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.detail || "Không thể tải kết quả bài kiểm tra."
          );
        }

        if (!cancelled) {
          setResult(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Đã xảy ra lỗi khi tải kết quả."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void fetchResult();

    return () => {
      cancelled = true;
    };
  }, [attemptId]);

  // 2. Trạng thái tải dữ liệu
  if (loading) {
    return (
      <div className="mx-auto max-w-4xl rounded-2xl border border-[#E2E5DC] bg-white p-10 text-center text-[#829080]">
        Đang tải kết quả bài kiểm tra...
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className="mx-auto max-w-4xl rounded-2xl border border-red-200 bg-white p-8 text-center">
        <p className="text-red-600">
          {error || "Không tìm thấy kết quả bài kiểm tra."}
        </p>

        <Link
          href="/quizzes"
          className="mt-5 inline-block rounded-xl bg-[#54765D] px-5 py-3 text-sm font-semibold text-white"
        >
          Quay lại danh sách Quiz
        </Link>
      </div>
    );
  }

  // 3. Chuẩn hóa dữ liệu AI
  const assessment = result.ai_assessment;

  const strengths = assessment?.strengths ?? [];
  const weakAreas = assessment?.weak_areas ?? [];
  const recommendations = assessment?.recommendations ?? [];

  const score = Number(result.score) || 0;

  const accuracy =
    result.total_questions > 0
      ? Math.round(
          (result.correct_count / result.total_questions) * 100
        )
      : 0;

  const reviewPlan = result.review_plan;
  const hasRetakeQuiz = Boolean(reviewPlan?.retake_quiz_id);

  // 4. Giao diện kết quả
  return (
    <div className="mx-auto max-w-4xl">
      {/* Tiêu đề */}
      <div className="mb-8">
        <Link
          href="/quizzes"
          className="text-sm font-medium text-[#829080] hover:text-[#355642]"
        >
          ← Quay lại danh sách Quiz
        </Link>

        <p className="mt-6 text-sm font-medium text-[#829080]">
          KẾT QUẢ KIỂM TRA
        </p>

        <h1 className="mt-2 text-3xl font-bold text-[#355642]">
          {result.title}
        </h1>
      </div>

      {/* Tổng kết điểm */}
      <div className="mb-8 rounded-2xl border border-[#E2E5DC] bg-white p-7">
        <div className="text-center">
          <p className="text-sm font-medium text-[#829080]">
            Điểm số của bạn
          </p>

          <p
            className={`mt-3 text-6xl font-bold ${
              score > 80
                ? "text-[#54765D]"
                : score >= 50
                ? "text-[#C58D3D]"
                : "text-[#B65C50]"
            }`}
          >
            {score.toFixed(0)}
            <span className="text-2xl">/100</span>
          </p>

          <p className="mt-3 text-sm text-[#829080]">
            {score > 80
              ? "Xuất sắc! Bạn đã nắm vững kiến thức."
              : score >= 70
              ? "Rất tốt! Bạn đã hoàn thành bài kiểm tra với kết quả tốt."
              : score >= 50
              ? "Bạn đã đạt yêu cầu. Hãy tiếp tục cải thiện những phần còn yếu."
              : "Bạn chưa đạt yêu cầu. Hãy ôn tập lại tài liệu trước khi thử sức lần nữa."}
          </p>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-4 border-t border-[#EEF0E9] pt-6 sm:grid-cols-3">
          <div className="text-center">
            <p className="text-sm text-[#829080]">
              Số câu đúng
            </p>

            <p className="mt-2 text-2xl font-bold text-[#355642]">
              {result.correct_count}/{result.total_questions}
            </p>
          </div>

          <div className="text-center">
            <p className="text-sm text-[#829080]">
              Điểm đạt được
            </p>

            <p className="mt-2 text-2xl font-bold text-[#355642]">
              {result.earned_points}/{result.total_points}
            </p>
          </div>

          <div className="col-span-2 text-center sm:col-span-1">
            <p className="text-sm text-[#829080]">
              Tỷ lệ chính xác
            </p>

            <p className="mt-2 text-2xl font-bold text-[#355642]">
              {accuracy}%
            </p>
          </div>
        </div>
      </div>

      {/* Nút xem đánh giá AI */}
      <button
        type="button"
        onClick={() =>
          setShowAssessment((previous) => !previous)
        }
        className="mb-8 w-full rounded-xl border border-[#54765D] bg-white px-5 py-4 text-sm font-semibold text-[#355642] transition hover:bg-[#E8EEE4]"
      >
        {showAssessment
          ? "Ẩn đánh giá và lộ trình ↑"
          : "✨ Xem đánh giá và lộ trình →"}
      </button>

      {/* Đánh giá kết quả bằng AI */}
      {showAssessment && (
        <div className="mb-8 rounded-2xl border border-[#E2E5DC] bg-white p-7">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#E8EEE4] text-xl">
              ✨
            </div>

            <div>
              <h2 className="text-xl font-bold text-[#355642]">
                Đánh giá từ AI
              </h2>

              <p className="text-sm text-[#829080]">
                Phân tích mức độ hiểu bài và đề xuất cải thiện
              </p>
            </div>
          </div>

          {assessment ? (
            <div className="mt-6 space-y-6">
              {/* Nhận xét tổng quan */}
              <div className="rounded-xl bg-[#F7F5EF] p-5">
                <p className="text-sm font-semibold text-[#829080]">
                  Mức độ nắm vững kiến thức
                </p>

                <p className="mt-2 text-lg font-bold text-[#355642]">
                  {assessment.mastery_level === "mastered"
                    ? "Đã nắm vững"
                    : assessment.mastery_level === "needs_review"
                    ? "Cần ôn tập thêm"
                    : "Chưa nắm vững"}
                </p>

                <p className="mt-3 text-sm leading-7 text-[#647568]">
                  {assessment.summary}
                </p>
              </div>

              {/* Điểm mạnh */}
              <div>
                <h3 className="font-semibold text-[#54765D]">
                  ✓ Kiến thức đã nắm vững
                </h3>

                {strengths.length > 0 ? (
                  <div className="mt-3 space-y-3">
                    {strengths.map((item, index) => (
                      <div
                        key={index}
                        className="rounded-xl border border-[#E2E5DC] p-4"
                      >
                        {typeof item === "string" ? (
                          <p className="text-sm leading-6 text-[#647568]">
                            {item}
                          </p>
                        ) : (
                          <>
                            {item.topic_name && (
                              <p className="font-semibold text-[#355642]">
                                {getMainTopicTitle(item.topic_name)}
                              </p>
                            )}

                            <p className="mt-1 text-sm leading-6 text-[#829080]">
                              {item.description ||
                                item.content ||
                                "Đã nắm được nội dung này."}
                            </p>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-[#829080]">
                    Chưa có dữ liệu về điểm mạnh.
                  </p>
                )}
              </div>

              {/* Nội dung cần cải thiện */}
              <div>
                <h3 className="font-semibold text-[#B65C50]">
                  ! Kiến thức cần ôn tập
                </h3>

                {weakAreas.length > 0 ? (
                  <div className="mt-3 space-y-3">
                    {weakAreas.map((item, index) => (
                      <div
                        key={index}
                        className="rounded-xl border border-[#F0DCD7] bg-[#FFFAF8] p-4"
                      >
                        {typeof item === "string" ? (
                          <p className="text-sm leading-6 text-[#647568]">
                            {item}
                          </p>
                        ) : (
                          <>
                            <p className="font-semibold text-[#355642]">
                              {getMainTopicTitle(
                                item.topic_name || "Nội dung cần cải thiện"
                              )}
                            </p>

                            {item.hierarchy && (
                              <p className="mt-1 text-xs font-medium text-[#54765D]">
                                Vị trí trong tài liệu: {item.hierarchy}
                              </p>
                            )}

                            <p className="mt-2 text-sm leading-6 text-[#829080]">
                              {item.description ||
                                item.content ||
                                item.reason ||
                                ""}
                            </p>

                            {item.source_page != null && (
                              <p className="mt-2 text-xs font-medium text-[#54765D]">
                                Trang tài liệu: {item.source_page}
                              </p>
                            )}

                            {item.recommendation && (
                              <div className="mt-3 rounded-lg bg-white p-3">
                                <p className="text-xs font-semibold text-[#54765D]">
                                  Gợi ý ôn tập
                                </p>

                                <p className="mt-1 text-sm leading-6 text-[#647568]">
                                  {item.recommendation}
                                </p>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-[#829080]">
                    Không có nội dung đáng kể cần cải thiện.
                  </p>
                )}
              </div>

              {/* Đề xuất cải thiện */}
              <div>
                <h3 className="font-semibold text-[#355642]">
                  Đề xuất cải thiện
                </h3>

                {recommendations.length > 0 ? (
                  <ul className="mt-3 space-y-2">
                    {recommendations.map((item, index) => (
                      <li
                        key={index}
                        className="flex gap-2 text-sm leading-6 text-[#647568]"
                      >
                        <span className="text-[#54765D]">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-[#829080]">
                    Bạn chưa cần thêm đề xuất cải thiện.
                  </p>
                )}
              </div>

              {/* Lộ trình học bổ trợ / ôn tập lại */}
              {reviewPlan ? (
                <div className="border-t border-[#EEF0E9] pt-6">
                  <h3 className="font-semibold text-[#355642]">
                    {hasRetakeQuiz
                      ? "Lộ trình ôn tập và kiểm tra lại"
                      : "Lộ trình học bổ trợ"}
                  </h3>

                  <p className="mt-2 text-sm leading-6 text-[#829080]">
                    {reviewPlan.overall_goal ||
                      "Củng cố những kiến thức cần cải thiện dựa trên kết quả bài kiểm tra."}
                  </p>

                  {reviewPlan.review_items?.length ? (
                    <div className="mt-4 space-y-3">
                      {reviewPlan.review_items.map((item, index) => (
                        <div
                          key={`${item.topic_name || "review"}-${index}`}
                          className="rounded-xl border border-[#E2E5DC] bg-white p-4"
                        >
                          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                            <div>
                              <p className="font-semibold text-[#355642]">
                                {index + 1}.{" "}
                                {getMainTopicTitle(
                                  item.topic_name ||
                                    "Nội dung cần ôn lại"
                                )}
                              </p>

                              {item.hierarchy && (
                                <p className="mt-1 text-xs text-[#54765D]">
                                  {item.hierarchy}
                                </p>
                              )}
                            </div>

                            <span className="w-fit rounded-full bg-[#E8EEE4] px-3 py-1 text-xs font-semibold capitalize text-[#54765D]">
                              {formatReviewDate(item.scheduled_date)}
                            </span>
                          </div>

                          {item.source_page != null && (
                            <p className="mt-2 text-xs font-medium text-[#829080]">
                              Học tại trang {item.source_page} trong tài liệu
                            </p>
                          )}

                          <p className="mt-2 text-sm leading-6 text-[#647568]">
                            {item.recommendation ||
                              "Đọc lại phần này, ghi lại ý chính và làm lại các câu hỏi liên quan."}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {reviewPlan.status === "completed" ? (
                    <div className="mt-4 rounded-xl bg-[#E8EEE4] p-4">
                      <p className="font-semibold text-[#54765D]">
                        {hasRetakeQuiz
                          ? "Bạn đã hoàn thành kế hoạch ôn tập!"
                          : "Bạn đã hoàn thành lộ trình học bổ trợ!"}
                      </p>

                      <p className="mt-1 text-sm leading-6 text-[#647568]">
                        {hasRetakeQuiz
                          ? "Bạn đã hoàn thành bài kiểm tra lại và đạt yêu cầu."
                          : "Bạn đã hoàn thành việc củng cố những kiến thức cần cải thiện."}
                      </p>
                    </div>
                  ) : hasRetakeQuiz ? (
                    <div className="mt-4 rounded-xl bg-[#F7F5EF] p-4">
                      <p className="text-sm leading-6 text-[#647568]">
                        Bạn có thể làm bài kiểm tra lại ngay sau khi xem
                        nội dung ôn tập.
                      </p>

                      <p className="mt-2 text-xs text-[#829080]">
                        Thời gian đã ôn:{" "}
                        {Math.floor(
                          (reviewPlan.review_study_seconds || 0) / 60
                        )}{" "}
                        phút
                      </p>

                      <Link
                        href={`/review-plans/${reviewPlan.id}`}
                        className="mt-4 block rounded-xl bg-[#54765D] px-5 py-3 text-center text-sm font-semibold text-white transition hover:bg-[#355642]"
                      >
                        Xem nội dung ôn tập →
                      </Link>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-xl bg-[#F7F5EF] p-4">
                      <p className="font-semibold text-[#355642]">
                        ✨ AI đã tạo nội dung học bổ trợ cho bạn
                      </p>

                      <p className="mt-2 text-sm leading-6 text-[#647568]">
                        Dựa trên kết quả bài kiểm tra, AI đã xác định
                        những kiến thức bạn cần củng cố và chuẩn bị
                        nội dung học tập bổ trợ theo từng phần.
                        Bạn có thể bắt đầu học ngay mà không cần chờ
                        thời gian ôn tập tối thiểu.
                      </p>

                      <Link
                        href={`/review-plans/${reviewPlan.id}`}
                        className="mt-4 block rounded-xl bg-[#54765D] px-5 py-3 text-center text-sm font-semibold text-white transition hover:bg-[#355642]"
                      >
                        Học nội dung bổ trợ →
                      </Link>
                    </div>
                  )}
                </div>
              ) : weakAreas.length === 0 ? (
                <div className="rounded-xl bg-[#E8EEE4] p-4">
                  <p className="font-semibold text-[#54765D]">
                    Chúc mừng! Bạn không cần tạo lộ trình ôn tập lại.
                  </p>

                  <p className="mt-1 text-sm text-[#647568]">
                    Hãy tiếp tục duy trì kết quả học tập tốt nhé.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl bg-[#F7F5EF] p-4">
                  <p className="text-sm leading-6 text-[#829080]">
                    Chưa tìm thấy kế hoạch ôn tập được liên kết với
                    lượt kiểm tra này.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-5 rounded-xl bg-[#F7F5EF] p-4 text-sm leading-6 text-[#829080]">
              Chưa có đánh giá AI cho lượt làm bài này.
            </p>
          )}
        </div>
      )}

      {/* Chi tiết từng câu */}
      <div className="mb-5">
        <h2 className="text-xl font-bold text-[#355642]">
          Chi tiết câu trả lời
        </h2>

        <p className="mt-1 text-sm text-[#829080]">
          Xem lại đáp án của bạn và đối chiếu với đáp án chính xác.
        </p>
      </div>

      <div className="space-y-5">
        {(result.results || []).map((question, index) => (
          <div
            key={question.question_id}
            className="rounded-2xl border border-[#E2E5DC] bg-white p-6"
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-semibold leading-7 text-[#355642]">
                Câu {index + 1}: {question.question_text}
              </h3>

              <span
                className={`shrink-0 rounded-lg px-3 py-1 text-xs font-semibold ${
                  question.is_correct
                    ? "bg-[#E8EEE4] text-[#54765D]"
                    : "bg-[#F8E8E5] text-[#B65C50]"
                }`}
              >
                {question.is_correct ? "Chính xác" : "Chưa đúng"}
              </span>
            </div>

            <div className="mt-5 space-y-3">
              <div className="rounded-xl bg-[#F7F5EF] p-4">
                <p className="text-xs font-medium text-[#829080]">
                  Câu trả lời của bạn
                </p>

                <p className="mt-1 font-semibold text-[#355642]">
                  {formatAnswer(question.selected_answer)}
                </p>
              </div>

              <div className="rounded-xl bg-[#E8EEE4] p-4">
                <p className="text-xs font-medium text-[#54765D]">
                  Đáp án chính xác
                </p>

                <p className="mt-1 font-semibold text-[#355642]">
                  {formatAnswer(question.correct_answer)}
                </p>
              </div>
            </div>

            {question.explanation && (
              <div className="mt-4 border-t border-[#EEF0E9] pt-4">
                <p className="text-sm font-semibold text-[#355642]">
                  Giải thích
                </p>

                <p className="mt-2 text-sm leading-6 text-[#829080]">
                  {question.explanation}
                </p>
              </div>
            )}

            {question.source_location && (
              <div className="mt-4 rounded-xl border border-[#E2E5DC] bg-[#F8F9F5] p-4">
                <p className="text-sm font-semibold text-[#355642]">
                  📚 Vị trí kiến thức trong tài liệu
                </p>

                <p className="mt-2 text-sm text-[#718074]">
                  {question.source_location.page_number != null
                    ? `Trang ${question.source_location.page_number}`
                    : "Chưa xác định trang"}

                  {question.source_location.chunk_index != null
                    ? ` · Đoạn nội dung ${
                        question.source_location.chunk_index + 1
                      }`
                    : ""}
                </p>

                {!question.is_correct &&
                  question.source_location.content && (
                    <div className="mt-3 rounded-lg bg-white p-3">
                      <p className="text-xs font-semibold text-[#54765D]">
                        Nội dung tham chiếu để ôn lại
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#647568]">
                        {question.source_location.content}
                      </p>
                    </div>
                  )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Nút quay lại */}
      <div className="mb-10 mt-8">
        <Link
          href="/quizzes"
          className="block rounded-xl bg-[#54765D] px-5 py-3 text-center text-sm font-semibold text-white transition hover:bg-[#355642]"
        >
          Quay lại danh sách bài kiểm tra
        </Link>
      </div>
    </div>
  );
}

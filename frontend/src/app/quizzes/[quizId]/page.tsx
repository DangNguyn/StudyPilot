
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getMainTopicTitle } from "@/lib/content-titles";

interface QuizQuestion {
  id: string;
  question_text: string;
  question_type: "single_choice" | "multiple_choice" | "fill_blank";
  options:
    | Record<string, string>
    | Array<{ key: string; text: string }>
    | null;
  points: number;
  question_order: number;
  difficulty_level: number | null;
}

interface QuestionResult {
  question_id: string;
  question_text: string;
  selected_answer: string | string[] | null;
  correct_answer: string | string[];
  is_correct: boolean;
  earned_points: number;
  explanation: string | null;
  source_location: {
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

interface QuizResult {
  score: number;
  correct_count: number;
  total_questions: number;
  earned_points: number;
  total_points: number;
  results: QuestionResult[];
  ai_assessment: {
    mastery_level: string;
    summary: string;
    strengths: (AssessmentItem | string)[] | null;
    weak_areas: (AssessmentItem | string)[] | null;
    recommendations: string[] | null;
  } | null;
  review_plan: {
    id: string;
    retake_quiz_id: string | null;
    status: string;
    review_items?: AssessmentItem[];
    overall_goal?: string | null;
  } | null;
  assessment_save_error?: string | null;
  next_session_unlocked?: boolean;
  requires_retake?: boolean;
}

function shuffleArray<T>(items: T[]): T[] {
  const shuffled = [...items];

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

function getOptionEntries(
  options: QuizQuestion["options"]
): [string, string][] {
  if (!options) {
    return [];
  }

  if (Array.isArray(options)) {
    return options.map((option, index) => [
      option.key || String.fromCharCode(65 + index),
      option.text,
    ]);
  }

  return Object.entries(options).map(([key, value]) => [
    key,
    typeof value === "string" ? value : String(value),
  ]);
}

function formatAnswer(
  value: string | string[] | null | undefined
): string {
  if (value === null || value === undefined || value === "") {
    return "Chưa trả lời";
  }

  return Array.isArray(value) ? value.join(", ") : value;
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

function formatAssessmentItem(
  item: AssessmentItem | string
): string {
  if (typeof item === "string") {
    return item;
  }

  const topic = item.topic_name
    ? `${getMainTopicTitle(item.topic_name)}: `
    : "";
  const detail =
    item.description ||
    item.reason ||
    item.content ||
    item.recommendation ||
    "";

  return `${topic}${detail}`.trim() || "Chưa có thông tin chi tiết.";
}

export default function QuizTakingPage() {
  const params = useParams();
  const quizId = params.quizId as string;

  const startedQuizIdRef = useRef("");
  const submitStartedRef = useRef(false);
  const submitCompletedRef = useRef(false);

  const [attemptId, setAttemptId] = useState("");
  const [title, setTitle] = useState("");
  const [timeLimit, setTimeLimit] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<
    Record<string, string | string[]>
  >({});
  const [draftAnswers, setDraftAnswers] = useState<
    Record<string, string>
  >({});

  const [currentIndex, setCurrentIndex] = useState(0);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [result, setResult] = useState<QuizResult | null>(null);
  const [showAssessment, setShowAssessment] = useState(false);

  // 1. Bắt đầu Quiz và lấy câu hỏi
  useEffect(() => {
    if (!quizId || startedQuizIdRef.current === quizId) {
      return;
    }

    startedQuizIdRef.current = quizId;

    // Reset dữ liệu khi chuyển sang Quiz khác.
    setAttemptId("");
    setTitle("");
    setTimeLimit(null);
    setRemainingSeconds(null);
    setQuestions([]);
    setAnswers({});
    setDraftAnswers({});
    setCurrentIndex(0);
    setLoading(true);
    setSaving(false);
    setSubmitting(false);
    setError("");
    setResult(null);
    setShowAssessment(false);

    submitStartedRef.current = false;
    submitCompletedRef.current = false;

    const initializeQuiz = async () => {
      try {
        const startResponse = await fetch(
          `http://127.0.0.1:8000/api/quizzes/${quizId}/start`,
          { method: "POST" }
        );

        const startData = await startResponse.json();

        if (startedQuizIdRef.current !== quizId) {
          return;
        }

        if (!startResponse.ok) {
          throw new Error(
            startData.detail || "Không thể bắt đầu bài kiểm tra."
          );
        }

        const receivedAttemptId = String(
          startData.attempt_id || ""
        ).trim();

        if (!receivedAttemptId || receivedAttemptId === "null") {
          throw new Error(
            "Không thể tạo lượt làm bài hợp lệ. Vui lòng tải lại Quiz."
          );
        }

        setAttemptId(receivedAttemptId);
        setTitle(startData.title);
        setTimeLimit(startData.time_limit_minutes);

        const questionResponse = await fetch(
          `http://127.0.0.1:8000/api/quizzes/${quizId}/questions`
        );

        const questionData = await questionResponse.json();

        if (startedQuizIdRef.current !== quizId) {
          return;
        }

        if (!questionResponse.ok) {
          throw new Error(
            questionData.detail || "Không thể tải câu hỏi."
          );
        }

        const shuffledQuestions = shuffleArray<QuizQuestion>(
          ((questionData.data || []) as QuizQuestion[]).map(
            (question): QuizQuestion => ({
              ...question,
              // Xáo trộn thứ tự đáp án nhưng giữ nguyên key.
              options: question.options
                ? Object.fromEntries(
                    shuffleArray(getOptionEntries(question.options))
                  )
                : null,
            })
          )
        );

        setQuestions(shuffledQuestions);

        if (startData.time_limit_minutes && startData.started_at) {
          const startedAt = new Date(startData.started_at).getTime();
          const deadline =
            startedAt + startData.time_limit_minutes * 60 * 1000;

          setRemainingSeconds(
            Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
          );
        }
      } catch (err) {
        if (startedQuizIdRef.current !== quizId) {
          return;
        }

        setError(
          err instanceof Error
            ? err.message
            : "Đã xảy ra lỗi khi tải bài kiểm tra."
        );
      } finally {
        if (startedQuizIdRef.current === quizId) {
          setLoading(false);
        }
      }
    };

    void initializeQuiz();
  }, [quizId]);

  // 2. Lưu câu trả lời
  const handleSelectAnswer = async (
    answer: string | string[]
  ) => {
    const question = questions[currentIndex];

    if (
      !question ||
      !attemptId ||
      saving ||
      submitting ||
      result
    ) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      const response = await fetch(
        `http://127.0.0.1:8000/api/quiz-attempts/${attemptId}/answers`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            question_id: question.id,
            selected_answer: answer,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail || "Không thể lưu câu trả lời."
        );
      }

      setAnswers((previous) => ({
        ...previous,
        [question.id]: answer,
      }));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Không thể lưu câu trả lời."
      );
    } finally {
      setSaving(false);
    }
  };

  // 3. Nộp bài và nhận kết quả
  const handleSubmit = useCallback(
    async (autoSubmit = false) => {
      if (
        !attemptId ||
        submitting ||
        saving ||
        result ||
        submitStartedRef.current
      ) {
        return;
      }

      if (!autoSubmit && !submitCompletedRef.current) {
        const confirmed = window.confirm(
          "Bạn có chắc chắn muốn nộp bài kiểm tra không?"
        );

        if (!confirmed) {
          return;
        }
      }

      submitStartedRef.current = true;
      setSubmitting(true);
      setError("");

      try {
        // Chỉ gửi yêu cầu nộp bài một lần.
        if (!submitCompletedRef.current) {
          const response = await fetch(
            `http://127.0.0.1:8000/api/quiz-attempts/${attemptId}/submit`,
            { method: "POST" }
          );

          const data = await response.json();

          if (!response.ok) {
            throw new Error(
              data.detail || "Không thể nộp bài."
            );
          }

          submitCompletedRef.current = true;
        }

        // Nếu tải kết quả lỗi, lần tiếp theo chỉ tải lại kết quả.
        const resultResponse = await fetch(
          `http://127.0.0.1:8000/api/quiz-attempts/${attemptId}/result`
        );

        const resultData = await resultResponse.json();

        if (!resultResponse.ok) {
          throw new Error(
            resultData.detail || "Không thể tải kết quả bài kiểm tra."
          );
        }

        setShowAssessment(false);
        setResult(resultData);
      } catch (err) {
        // Nếu chấm điểm đã hoàn tất nhưng lưu đánh giá bị lỗi,
        // vẫn tải lại kết quả đã nộp để người dùng không bị mất điểm.
        try {
          const recoveryResponse = await fetch(
            `http://127.0.0.1:8000/api/quiz-attempts/${attemptId}/result`
          );
          const recoveryData = await recoveryResponse.json();

          if (
            recoveryResponse.ok &&
            recoveryData.status === "submitted"
          ) {
            setShowAssessment(false);
            setResult(recoveryData as QuizResult);
            return;
          }
        } catch {
          // Giữ lại lỗi nộp bài gốc nếu không thể tải kết quả.
        }

        setError(
          err instanceof Error
            ? err.message
            : "Không thể nộp bài."
        );

        if (remainingSeconds !== null && remainingSeconds <= 0) {
          setRemainingSeconds(null);
        }
      } finally {
        submitStartedRef.current = false;
        setSubmitting(false);
      }
    },
    [
      attemptId,
      submitting,
      saving,
      result,
      remainingSeconds,
    ]
  );

  // 4. Đồng hồ đếm ngược và tự động nộp bài
  useEffect(() => {
    if (
      remainingSeconds === null ||
      result ||
      loading ||
      !attemptId ||
      submitting ||
      saving
    ) {
      return;
    }

    if (remainingSeconds <= 0) {
      void handleSubmit(true);
      return;
    }

    const timer = window.setTimeout(() => {
      setRemainingSeconds((previous) =>
        previous === null ? null : Math.max(0, previous - 1)
      );
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [
    remainingSeconds,
    result,
    loading,
    attemptId,
    submitting,
    saving,
    handleSubmit,
  ]);

  // 5. Trạng thái tải dữ liệu
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-[#829080]">
        Đang chuẩn bị bài kiểm tra...
      </div>
    );
  }

  if (error && questions.length === 0) {
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border border-red-200 bg-white p-8 text-center">
        <p className="font-semibold text-red-600">{error}</p>

        <Link
          href="/quizzes"
          className="mt-5 inline-block rounded-xl bg-[#54765D] px-5 py-3 text-sm font-semibold text-white"
        >
          Quay lại danh sách Quiz
        </Link>
      </div>
    );
  }

  // 6. Màn hình kết quả sau khi nộp bài
  if (result) {
    const strengths = result.ai_assessment?.strengths ?? [];
    const weakAreas = result.ai_assessment?.weak_areas ?? [];
    const recommendations =
      result.ai_assessment?.recommendations ?? [];

    return (
      <div className="mx-auto max-w-4xl">
        {/* Tổng quan kết quả */}
        <div className="rounded-2xl border border-[#E2E5DC] bg-white p-8 text-center">
          <div className="text-5xl">🎉</div>

          <h1 className="mt-4 text-2xl font-bold text-[#355642]">
            Hoàn thành bài kiểm tra!
          </h1>

          <p className="mt-2 text-sm text-[#829080]">
            {title}
          </p>

          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl bg-[#E8EEE4] p-5">
              <p className="text-sm text-[#718074]">Điểm số</p>
              <p className="mt-2 text-3xl font-bold text-[#355642]">
                {result.score}/100
              </p>
            </div>

            <div className="rounded-xl bg-[#F0F1E9] p-5">
              <p className="text-sm text-[#718074]">Số câu đúng</p>
              <p className="mt-2 text-3xl font-bold text-[#355642]">
                {result.correct_count}/{result.total_questions}
              </p>
            </div>

            <div className="rounded-xl bg-[#F7EEE8] p-5">
              <p className="text-sm text-[#718074]">Điểm đạt được</p>
              <p className="mt-2 text-3xl font-bold text-[#A66F50]">
                {result.earned_points}/{result.total_points}
              </p>
            </div>
          </div>

          <div
            className={`mx-auto mt-4 max-w-2xl rounded-xl p-4 text-center text-sm leading-6 ${
              result.score < 50
                ? "bg-[#F9E9E5] text-[#A94F3D]"
                : result.score < 70
                  ? "bg-[#FFF4E5] text-[#9A6A24]"
                  : "bg-[#E8EEE4] text-[#54765D]"
            }`}
          >
            {result.score < 50 ? (
              <>
                <strong>Chưa đạt 50%.</strong> Bạn cần ôn lại lộ trình
                được đề xuất và đạt từ 50% ở bài kiểm tra lại để mở ngày
                học tiếp theo.
              </>
            ) : result.score < 70 ? (
              <>
                <strong>Cần củng cố thêm.</strong> Bạn vẫn được học ngày
                tiếp theo. Hãy ôn lại những phần còn yếu để củng cố kiến
                thức.
              </>
            ) : result.score <= 80 ? (
              <>
                <strong>Đạt yêu cầu.</strong> Bạn được phép học ngày tiếp
                theo; hãy tiếp tục củng cố các phần còn yếu.
              </>
            ) : (
              <>
                <strong>Xuất sắc!</strong> Bạn đã nắm vững phần lớn kiến
                thức và được phép học ngày tiếp theo.
              </>
            )}
          </div>
        </div>

        {/* Đáp án và giải thích */}
        <div className="mt-8">
          <h2 className="mb-5 text-xl font-bold text-[#355642]">
            Xem lại đáp án và kiến thức
          </h2>

          <div className="space-y-5">
            {result.results.map((item, index) => (
              <div
                key={item.question_id}
                className="rounded-2xl border border-[#E2E5DC] bg-white p-6"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold text-[#355642]">
                    Câu {index + 1}. {item.question_text}
                  </h3>

                  <span
                    className={`shrink-0 rounded-lg px-3 py-1 text-xs font-semibold ${
                      item.is_correct
                        ? "bg-[#E8EEE4] text-[#54765D]"
                        : "bg-[#F9E9E5] text-[#A94F3D]"
                    }`}
                  >
                    {item.is_correct ? "Chính xác" : "Chưa đúng"}
                  </span>
                </div>

                <p className="mt-4 text-sm text-[#829080]">
                  Bạn chọn:{" "}
                  <strong className="text-[#355642]">
                    {formatAnswer(item.selected_answer)}
                  </strong>
                </p>

                <p className="mt-2 text-sm text-[#54765D]">
                  Đáp án đúng:{" "}
                  <strong>{formatAnswer(item.correct_answer)}</strong>
                </p>

                {item.explanation && (
                  <div className="mt-4 rounded-xl bg-[#F7F5EF] p-4">
                    <p className="text-sm font-semibold text-[#355642]">
                      Giải thích
                    </p>

                    <p className="mt-2 text-sm leading-6 text-[#718074]">
                      {item.explanation}
                    </p>
                  </div>
                )}

                {item.source_location && (
                  <div className="mt-4 rounded-xl border border-[#E2E5DC] bg-[#F8F9F5] p-4">
                    <p className="text-sm font-semibold text-[#355642]">
                      📚 Vị trí kiến thức trong tài liệu
                    </p>

                    <p className="mt-2 text-sm text-[#718074]">
                      {item.source_location.page_number != null
                        ? `Trang ${item.source_location.page_number}`
                        : "Chưa xác định trang"}

                      {item.source_location.chunk_index != null
                        ? ` · Đoạn nội dung ${item.source_location.chunk_index + 1}`
                        : ""}
                    </p>

                    {!item.is_correct &&
                      item.source_location.content && (
                        <div className="mt-3 rounded-lg bg-white p-3">
                          <p className="text-xs font-semibold text-[#54765D]">
                            Nội dung tham chiếu để ôn lại
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#647568]">
                            {item.source_location.content}
                          </p>
                        </div>
                      )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Nút xem đánh giá AI */}
        <div className="mt-8 rounded-2xl border border-[#E2E5DC] bg-white p-6 text-center">
          <h2 className="text-xl font-bold text-[#355642]">
            Bạn đã hoàn thành phần xem lại đáp án!
          </h2>

          <p className="mt-2 text-sm leading-6 text-[#829080]">
            Xem đánh giá năng lực và lộ trình ôn tập được đề xuất
            dựa trên kết quả bài kiểm tra.
          </p>

          {!showAssessment ? (
            <button
              type="button"
              onClick={() => setShowAssessment(true)}
              className="mt-5 rounded-xl bg-[#54765D] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#355642]"
            >
              Xem đánh giá và lộ trình
            </button>
          ) : (
            <div className="mt-6 text-left">
              {result.ai_assessment ? (
                <>
                  {/* Nhận xét tổng quan */}
                  <div className="rounded-xl bg-[#E8EEE4] p-5">
                    <p className="text-sm font-semibold text-[#355642]">
                      Nhận xét tổng quan
                    </p>

                    <p className="mt-2 text-sm leading-6 text-[#536657]">
                      {result.ai_assessment.summary}
                    </p>
                  </div>

                  {/* Điểm mạnh */}
                  <div className="mt-5">
                    <h3 className="font-semibold text-[#355642]">
                      Điểm mạnh
                    </h3>

                    {strengths.length > 0 ? (
                      <div className="mt-3 space-y-3">
                        {strengths.map((item, index) => (
                          <div
                            key={index}
                            className="rounded-xl bg-[#F7F8F4] p-4"
                          >
                            <p className="text-sm leading-6 text-[#536657]">
                              {formatAssessmentItem(item)}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-[#829080]">
                        Chưa có dữ liệu về điểm mạnh.
                      </p>
                    )}
                  </div>

                  {/* Nội dung cần cải thiện */}
                  <div className="mt-5">
                    <h3 className="font-semibold text-[#355642]">
                      Nội dung cần cải thiện
                    </h3>

                    {weakAreas.length > 0 ? (
                      <div className="mt-3 space-y-3">
                        {weakAreas.map((item, index) => (
                          <div
                            key={index}
                            className="rounded-xl border border-[#E2E5DC] bg-[#F8F9F5] p-4"
                          >
                            {typeof item === "string" ? (
                              <p className="text-sm leading-6 text-[#536657]">
                                {item}
                              </p>
                            ) : (
                              <>
                                <p className="font-semibold text-[#355642]">
                                  {getMainTopicTitle(
                                    item.topic_name ||
                                      "Nội dung cần cải thiện"
                                  )}
                                </p>

                                {item.hierarchy && (
                                  <p className="mt-1 text-xs font-medium text-[#54765D]">
                                    Vị trí: {item.hierarchy}
                                  </p>
                                )}

                                <p className="mt-2 text-sm leading-6 text-[#536657]">
                                  {item.description ||
                                    item.content ||
                                    item.reason ||
                                    "Chưa có mô tả chi tiết."}
                                </p>

                                {item.source_page != null && (
                                  <p className="mt-2 text-xs text-[#829080]">
                                    Học lại tại trang{" "}
                                    {item.source_page} trong tài liệu
                                  </p>
                                )}

                                {item.recommendation && (
                                  <p className="mt-3 text-sm leading-6 text-[#A66F50]">
                                    Gợi ý: {item.recommendation}
                                  </p>
                                )}
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-[#829080]">
                        Không có nội dung đáng kể cần cải thiện.
                      </p>
                    )}
                  </div>

                  {/* Lộ trình ôn tập */}
                  <div className="mt-5">
                    <h3 className="font-semibold text-[#355642]">
                      Lộ trình ôn tập đề xuất
                    </h3>

                    {recommendations.length > 0 ? (
                      <div className="mt-3 space-y-2">
                        {recommendations.map((item, index) => (
                          <p
                            key={index}
                            className="text-sm leading-6 text-[#718074]"
                          >
                            {index + 1}. {item}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-[#829080]">
                        Bạn chưa cần thêm lộ trình ôn tập.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <p className="rounded-xl bg-[#F7F5EF] p-4 text-sm text-[#718074]">
                  Chưa có đánh giá AI cho lượt kiểm tra này.
                </p>
              )}

              {/* Kế hoạch ôn tập lại */}
              {result.review_plan && (
                <div className="mt-6 rounded-xl border border-[#E2E5DC] p-5">
                  <h3 className="font-semibold text-[#355642]">
                    Kế hoạch ôn tập lại
                  </h3>

                  {result.review_plan.overall_goal && (
                    <p className="mt-2 text-sm leading-6 text-[#718074]">
                      {result.review_plan.overall_goal}
                    </p>
                  )}

                  {result.review_plan.review_items &&
                    result.review_plan.review_items.length > 0 && (
                      <div className="mt-4 space-y-3">
                        {result.review_plan.review_items.map(
                          (item, index) => (
                            <div
                              key={`${item.topic_name || "review"}-${index}`}
                              className="rounded-xl border border-[#E2E5DC] bg-[#F8F9F5] p-4"
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
                                <p className="mt-2 text-xs text-[#829080]">
                                  Học tại trang {item.source_page}
                                </p>
                              )}

                              <p className="mt-2 text-sm leading-6 text-[#718074]">
                                {item.recommendation ||
                                  "Đọc lại phần này, ghi lại ý chính và làm lại các câu hỏi liên quan."}
                              </p>
                            </div>
                          )
                        )}
                      </div>
                    )}

                  {result.review_plan.status === "completed" ? (
                    <p className="mt-2 text-sm leading-6 text-[#54765D]">
                      Bạn đã hoàn thành kế hoạch ôn tập và đạt yêu cầu
                      bài kiểm tra lại.
                    </p>
                  ) : result.review_plan.retake_quiz_id ? (
                    <>
                      <p className="mt-2 text-sm leading-6 text-[#718074]">
                        Bài kiểm tra lại gồm 30% câu trắc nghiệm và 70% câu
                        điền vào chỗ trống. Bạn có thể làm ngay.
                      </p>

                      <Link
                        href={`/review-plans/${result.review_plan.id}`}
                        className="mt-4 inline-block rounded-xl bg-[#A66F50] px-5 py-3 text-sm font-semibold text-white hover:bg-[#8D593E]"
                      >
                        Vào ôn tập lại →
                      </Link>
                    </>
                  ) : (
                    <p className="mt-2 text-sm leading-6 text-[#A66F50]">
                      Kế hoạch ôn tập đã được tạo nhưng bài kiểm tra lại
                      chưa khả dụng. Vui lòng thử lại sau.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <Link
          href="/quizzes"
          className="mt-8 inline-block rounded-xl bg-[#54765D] px-6 py-3 text-sm font-semibold text-white hover:bg-[#355642]"
        >
          Quay lại danh sách Quiz
        </Link>
      </div>
    );
  }

  const currentQuestion = questions[currentIndex];

  const answeredCount = Object.values(answers).filter((answer) =>
    Array.isArray(answer) ? answer.length > 0 : Boolean(answer)
  ).length;

  if (!currentQuestion) {
    return (
      <div className="rounded-2xl bg-white p-8 text-center">
        <p className="text-[#829080]">
          Quiz hiện chưa có câu hỏi.
        </p>
      </div>
    );
  }

  // 7. Giao diện làm bài
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-8">
        <Link
          href="/quizzes"
          className="text-sm font-medium text-[#829080] hover:text-[#355642]"
        >
          ← Danh sách bài kiểm tra
        </Link>

        <h1 className="mt-4 text-2xl font-bold text-[#355642]">
          {title}
        </h1>

        <div className="mt-4 flex flex-wrap gap-4 text-sm text-[#829080]">
          <span>📝 {questions.length} câu hỏi</span>

          <span>
            ⏱️{" "}
            {timeLimit
              ? `${timeLimit} phút`
              : "Không giới hạn thời gian"}
          </span>

          <span>
            ✓ Đã trả lời {answeredCount}/{questions.length} câu
          </span>
        </div>
      </div>

      {remainingSeconds !== null && (
        <div
          className={`mb-6 flex items-center justify-between rounded-2xl border p-4 ${
            remainingSeconds <= 60
              ? "border-red-200 bg-red-50"
              : "border-[#E2E5DC] bg-white"
          }`}
        >
          <div>
            <p className="text-sm font-semibold text-[#355642]">
              Thời gian còn lại
            </p>

            <p className="mt-1 text-xs text-[#829080]">
              Bài sẽ tự động nộp khi đồng hồ về 00:00.
            </p>
          </div>

          <div
            className={`text-2xl font-bold tabular-nums ${
              remainingSeconds <= 60
                ? "text-red-600"
                : "text-[#355642]"
            }`}
          >
            {String(Math.floor(remainingSeconds / 60)).padStart(2, "0")}:
            {String(remainingSeconds % 60).padStart(2, "0")}
          </div>
        </div>
      )}

      {submitting && (
        <p className="mb-4 text-sm font-medium text-[#A66F50]">
          Đang nộp bài kiểm tra...
        </p>
      )}

      <div className="mb-6">
        <div className="mb-2 flex justify-between text-xs text-[#829080]">
          <span>Tiến độ làm bài</span>

          <span>
            {Math.round((answeredCount / questions.length) * 100)}%
          </span>
        </div>

        <div className="h-2 overflow-hidden rounded-full bg-[#E8EEE4]">
          <div
            className="h-full rounded-full bg-[#54765D] transition-all"
            style={{
              width: `${(answeredCount / questions.length) * 100}%`,
            }}
          />
        </div>
      </div>

      <div className="rounded-2xl border border-[#E2E5DC] bg-white p-6 sm:p-8">
        <div className="flex items-center justify-between">
          <span className="rounded-lg bg-[#E8EEE4] px-3 py-1 text-sm font-semibold text-[#54765D]">
            Câu {currentIndex + 1}/{questions.length}
          </span>

          <span className="text-sm text-[#829080]">
            {currentQuestion.points} điểm
          </span>
        </div>

        <h2 className="mt-6 text-lg font-bold leading-8 text-[#355642]">
          {currentQuestion.question_text}
        </h2>

        {/* Câu hỏi trắc nghiệm một hoặc nhiều đáp án */}
        {(
          currentQuestion.question_type === "single_choice" ||
          currentQuestion.question_type === "multiple_choice"
        ) ? (
          <>
            <p className="mt-2 text-xs text-[#9AA397]">
              {currentQuestion.question_type === "multiple_choice"
                ? "Có thể chọn nhiều đáp án đúng."
                : "Chọn một đáp án đúng nhất."}
            </p>

            <div className="mt-6 space-y-3">
              {getOptionEntries(currentQuestion.options).map(
                ([key, optionText]) => {
                  const currentAnswer = answers[currentQuestion.id];

                  const isSelected = Array.isArray(currentAnswer)
                    ? currentAnswer.includes(key)
                    : currentAnswer === key;

                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={saving || submitting}
                      onClick={() => {
                        if (
                          currentQuestion.question_type === "multiple_choice"
                        ) {
                          const currentAnswers = Array.isArray(
                            answers[currentQuestion.id]
                          )
                            ? (answers[currentQuestion.id] as string[])
                            : [];

                          const nextAnswers = currentAnswers.includes(key)
                            ? currentAnswers.filter((item) => item !== key)
                            : [...currentAnswers, key];

                          void handleSelectAnswer(nextAnswers);
                        } else {
                          void handleSelectAnswer(key);
                        }
                      }}
                      className={`flex w-full items-start gap-4 rounded-xl border p-4 text-left transition ${
                        isSelected
                          ? "border-[#54765D] bg-[#E8EEE4]"
                          : "border-[#E2E5DC] bg-white hover:border-[#9BAF9A] hover:bg-[#F7F8F4]"
                      } ${saving ? "cursor-wait opacity-70" : ""}`}
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                          isSelected
                            ? "bg-[#54765D] text-white"
                            : "bg-[#F0F1E9] text-[#718074]"
                        }`}
                      >
                        {key}
                      </span>

                      <span className="pt-1 text-sm leading-6 text-[#536657]">
                        {optionText}
                      </span>
                    </button>
                  );
                }
              )}
            </div>
          </>
        ) : (
          /* Câu hỏi điền khuyết */
          <>
            <p className="mt-2 text-xs text-[#9AA397]">
              Nhập câu trả lời của bạn vào ô bên dưới.
            </p>

            <textarea
              value={
                draftAnswers[currentQuestion.id] ??
                (
                  typeof answers[currentQuestion.id] === "string"
                    ? (answers[currentQuestion.id] as string)
                    : ""
                )
              }
              onChange={(event) =>
                setDraftAnswers((previous) => ({
                  ...previous,
                  [currentQuestion.id]: event.target.value,
                }))
              }
              disabled={saving || submitting}
              placeholder="Nhập câu trả lời..."
              rows={3}
              className="mt-6 w-full resize-y rounded-xl border border-[#E2E5DC] bg-white p-4 text-sm text-[#355642] outline-none transition placeholder:text-[#A5ADA2] focus:border-[#54765D] focus:ring-2 focus:ring-[#E8EEE4] disabled:opacity-60"
            />

            <button
              type="button"
              disabled={
                saving ||
                submitting ||
                !(draftAnswers[currentQuestion.id] ?? "").trim()
              }
              onClick={() =>
                void handleSelectAnswer(
                  (draftAnswers[currentQuestion.id] ?? "").trim()
                )
              }
              className="mt-4 rounded-xl bg-[#54765D] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#355642] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Lưu câu trả lời
            </button>
          </>
        )}

        {saving && (
          <p className="mt-4 text-sm text-[#829080]">
            Đang lưu câu trả lời...
          </p>
        )}

        {error && (
          <p className="mt-4 text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="mt-8 flex items-center justify-between border-t border-[#EEF0E9] pt-6">
          <button
            type="button"
            disabled={currentIndex === 0 || saving || submitting}
            onClick={() => setCurrentIndex((index) => index - 1)}
            className="rounded-xl border border-[#E2E5DC] px-5 py-3 text-sm font-semibold text-[#718074] hover:bg-[#F7F5EF] disabled:cursor-not-allowed disabled:opacity-40"
          >
            ← Câu trước
          </button>

          {currentIndex < questions.length - 1 ? (
            <button
              type="button"
              disabled={saving || submitting}
              onClick={() => setCurrentIndex((index) => index + 1)}
              className="rounded-xl bg-[#54765D] px-5 py-3 text-sm font-semibold text-white hover:bg-[#355642] disabled:opacity-50"
            >
              Câu tiếp theo →
            </button>
          ) : (
            <button
              type="button"
              disabled={saving || submitting}
              onClick={() => void handleSubmit(false)}
              className="rounded-xl bg-[#A66F50] px-5 py-3 text-sm font-semibold text-white hover:bg-[#8D593E] disabled:opacity-50"
            >
              {submitting ? "Đang nộp bài..." : "Nộp bài"}
            </button>
          )}
        </div>
      </div>

      {/* Điều hướng câu hỏi */}
      <div className="mt-6 rounded-2xl border border-[#E2E5DC] bg-white p-5">
        <p className="mb-4 text-sm font-semibold text-[#355642]">
          Điều hướng câu hỏi
        </p>

        <div className="flex flex-wrap gap-2">
          {questions.map((question, index) => {
            const answer = answers[question.id];

            const isAnswered = Array.isArray(answer)
              ? answer.length > 0
              : Boolean(answer);

            const isCurrent = currentIndex === index;

            return (
              <button
                key={question.id}
                type="button"
                disabled={saving || submitting}
                onClick={() => setCurrentIndex(index)}
                className={`flex h-10 w-10 items-center justify-center rounded-lg text-sm font-semibold ${
                  isCurrent
                    ? "bg-[#54765D] text-white"
                    : isAnswered
                    ? "bg-[#E8EEE4] text-[#54765D]"
                    : "bg-[#F0F1E9] text-[#829080]"
                }`}
              >
                {index + 1}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap gap-4 text-xs text-[#829080]">
          <span>🟢 Đã trả lời</span>
          <span>⚪ Chưa trả lời</span>
          <span>🟩 Câu đang xem</span>
        </div>
      </div>
    </div>
  );
}

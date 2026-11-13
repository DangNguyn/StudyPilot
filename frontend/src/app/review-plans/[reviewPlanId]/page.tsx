
"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getMainTopicTitle } from "@/lib/content-titles";

const API_URL = "http://127.0.0.1:8000";
interface ReviewChunk {
  id: string;
  material_id: string;
  content: string;
  page_number: number | null;
  chunk_index: number;
}

interface ContentSection {
  heading: string;
  content?: string;
  key_points?: string[];
  subsections?: ContentSection[];
}

interface SupplementalContent {
  learning_objective?: string;
  content_sections?: ContentSection[];
}

interface ReviewItem {
  topic_name?: string;
  hierarchy?: string;
  description?: string;
  recommendation?: string;
  source_page?: number | null;
  source_content?: string;
  scheduled_date?: string | null;
  supplemental_content?: SupplementalContent;
}

interface ReviewMaterial {
  review_plan_id: string;
  original_quiz_id: string;
  retake_quiz_id: string | null;
  original_quiz_title: string;
  study_session_id: string | null;
  topic_id: string | null;
  topic_name: string | null;
  overall_goal?: string;
  review_items?: ReviewItem[];
  is_supplemental_only?: boolean;
  requires_retake?: boolean;
  chunks: ReviewChunk[];
  total_chunks: number;
  review_study_seconds?: number;
  is_eligible_for_quiz?: boolean;
}

interface ReviewResponse {
  review_study_seconds?: number;
  required_seconds?: number;
  is_eligible_for_quiz?: boolean;
  requires_retake?: boolean;
  message?: string;
  detail?: string;
  status?: string;
}

function ContentSectionView({
  section,
  level = 0,
}: {
  section: ContentSection;
  level?: number;
}) {
  return (
    <div className={level > 0 ? "mt-4 border-l-2 border-[#E2E9DF] pl-4" : "mt-4"}>
      <h4 className="font-bold text-[#1C3829]">
        {section.heading}
      </h4>

      {section.content && (
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-gray-700 md:text-base">
          {section.content}
        </p>
      )}

      {section.key_points && section.key_points.length > 0 && (
        <ul className="mt-3 list-disc space-y-2 pl-6 text-sm leading-7 text-gray-700 md:text-base">
          {section.key_points.map((point, index) => (
            <li key={index}>{point}</li>
          ))}
        </ul>
      )}

      {section.subsections?.map((subsection, index) => (
        <ContentSectionView
          key={`${subsection.heading}-${index}`}
          section={subsection}
          level={level + 1}
        />
      ))}
    </div>
  );
}

export default function ReviewPlanPage() {
  const params = useParams<{ reviewPlanId: string }>();
  const router = useRouter();

  const reviewPlanId = params.reviewPlanId;

  const [material, setMaterial] = useState<ReviewMaterial | null>(null);
  const [studySeconds, setStudySeconds] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activityError, setActivityError] = useState("");
  const [completing, setCompleting] = useState(false);
  const [completed, setCompleted] = useState(false);

  const formatTime = (seconds: number) => {
    const safeSeconds = Math.max(0, seconds);
    const minutes = Math.floor(safeSeconds / 60);
    const remainingSeconds = safeSeconds % 60;

    return `${String(minutes).padStart(2, "0")}:${String(
      remainingSeconds
    ).padStart(2, "0")}`;
  };

  const requiresRetake = Boolean(
    material?.requires_retake ?? material?.retake_quiz_id
  );

  const isEligible = requiresRetake;
  const progress = 100;

  const recordActivity = useCallback(async () => {
    try {
      if (document.visibilityState !== "visible") {
        return;
      }

      const response = await fetch(
        `${API_URL}/api/review-plans/${reviewPlanId}/review-activity`,
        {
          method: "POST",
        }
      );

      const data: ReviewResponse = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail || "Không thể ghi nhận thời gian ôn tập."
        );
      }

      setStudySeconds(data.review_study_seconds || 0);
      setActivityError("");
    } catch (err) {
      setActivityError(
        err instanceof Error
          ? err.message
          : "Không thể cập nhật thời gian ôn tập."
      );
    }
  }, [reviewPlanId]);

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const initializeReview = async () => {
      try {
        setLoading(true);
        setError("");

        const startResponse = await fetch(
          `${API_URL}/api/review-plans/${reviewPlanId}/start-review`,
          {
            method: "POST",
          }
        );

        const startData: ReviewResponse = await startResponse.json();

        if (!startResponse.ok) {
          throw new Error(
            startData.detail || "Không thể bắt đầu phiên học bổ trợ."
          );
        }

        if (cancelled) return;

        setStudySeconds(startData.review_study_seconds || 0);

        const materialResponse = await fetch(
          `${API_URL}/api/review-plans/${reviewPlanId}/review-material`
        );

        const materialData = await materialResponse.json();

        if (!materialResponse.ok) {
          throw new Error(
            materialData.detail || "Không thể tải nội dung học bổ trợ."
          );
        }

        if (cancelled) return;

        setMaterial(materialData);

        intervalId = setInterval(() => {
          recordActivity();
        }, 30000);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Đã xảy ra lỗi khi tải trang học bổ trợ."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    initializeReview();

    return () => {
      cancelled = true;

      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [reviewPlanId, recordActivity]);

  const handleStartRetake = () => {
    if (!material?.retake_quiz_id || !isEligible) {
      return;
    }

    router.push(`/quizzes/${material.retake_quiz_id}`);
  };

  const handleCompleteSupplemental = async () => {
    if (!material || requiresRetake || completing || completed) {
      return;
    }

    try {
      setCompleting(true);
      setActivityError("");

      const response = await fetch(
        `${API_URL}/api/review-plans/${reviewPlanId}/complete-supplemental`,
        {
          method: "POST",
        }
      );

      const data: ReviewResponse = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail || "Không thể hoàn thành lộ trình học bổ trợ."
        );
      }

      setCompleted(true);
    } catch (err) {
      setActivityError(
        err instanceof Error
          ? err.message
          : "Đã xảy ra lỗi khi hoàn thành lộ trình."
      );
    } finally {
      setCompleting(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-[#F3E9DF] px-6 py-16">
        <div className="mx-auto max-w-4xl rounded-3xl bg-[#FFFCF8] p-10 text-center shadow-sm">
          <p className="text-lg font-semibold text-[#1C3829]">
            Đang chuẩn bị nội dung học bổ trợ...
          </p>
          <p className="mt-2 text-sm text-gray-500">
            Vui lòng chờ trong giây lát.
          </p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-[#F3E9DF] px-6 py-16">
        <div className="mx-auto max-w-3xl rounded-3xl bg-[#FFFCF8] p-8 shadow-sm">
          <h1 className="text-xl font-bold text-[#A94F3D]">
            Không thể tải nội dung học bổ trợ
          </h1>

          <p className="mt-3 text-gray-700">{error}</p>

          <button
            onClick={() => router.back()}
            className="mt-6 rounded-xl bg-[#1C3829] px-5 py-3 font-semibold text-white"
          >
            Quay lại
          </button>
        </div>
      </main>
    );
  }

  if (!material) return null;

  const reviewItems = material.review_items || [];

  return (
    <main className="min-h-screen bg-[#F3E9DF] px-4 py-8 md:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <section className="rounded-3xl bg-[#FFFCF8] p-6 shadow-sm md:p-8">
          <button
            onClick={() => router.back()}
            className="mb-5 text-sm font-semibold text-[#5D856C] hover:underline"
          >
            ← Quay lại kết quả bài kiểm tra
          </button>

          <p className="text-sm font-semibold uppercase tracking-wider text-[#5D856C]">
            {requiresRetake ? "Khu vực ôn tập" : "Lộ trình học bổ trợ"}
          </p>

          <h1 className="mt-2 text-2xl font-bold text-[#1C3829] md:text-3xl">
            {requiresRetake
              ? "Ôn tập kiến thức chưa vững"
              : "Củng cố kiến thức"}
          </h1>

          <p className="mt-3 text-gray-600">
            {material.original_quiz_title}
          </p>

          <div className="mt-5 rounded-2xl bg-[#E2E9DF] p-4">
            <p className="text-sm font-semibold text-[#1C3829]">
              Nội dung cần củng cố
            </p>

            <p className="mt-1 text-lg font-bold text-[#1C3829]">
              {getMainTopicTitle(
                material.topic_name || "Kiến thức của bài học"
              )}
            </p>

            {material.overall_goal && (
              <p className="mt-2 text-sm leading-7 text-gray-700">
                {material.overall_goal}
              </p>
            )}
          </div>
        </section>

        {/* AI Supplemental Learning Content */}
        {reviewItems.length > 0 && (
          <section className="space-y-5">
            <div>
              <h2 className="text-xl font-bold text-[#1C3829]">
                Nội dung học bổ trợ do AI đề xuất
              </h2>

              <p className="mt-1 text-sm text-gray-500">
                Các nội dung được lựa chọn dựa trên những kiến thức bạn
                chưa trả lời chính xác trong bài kiểm tra.
              </p>
            </div>

            {reviewItems.map((item, index) => {
              const supplemental = item.supplemental_content;
              const sections = supplemental?.content_sections || [];

              return (
                <article
                  key={`${item.topic_name || "topic"}-${index}`}
                  className="rounded-3xl bg-[#FFFCF8] p-6 shadow-sm md:p-8"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-lg font-bold text-[#1C3829]">
                      {index + 1}.{" "}
                      {getMainTopicTitle(
                        item.topic_name || "Kiến thức cần củng cố"
                      )}
                    </h3>

                    {item.source_page != null && (
                      <span className="rounded-full bg-[#E2E9DF] px-3 py-1 text-xs font-medium text-[#355642]">
                        Trang {item.source_page}
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-[#54765D]">
                    {item.scheduled_date && (
                      <span className="rounded-full bg-[#E2E9DF] px-3 py-1 capitalize">
                        Ôn lại:{" "}
                        {new Date(
                          `${item.scheduled_date}T00:00:00`
                        ).toLocaleDateString("vi-VN", {
                          weekday: "long",
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                        })}
                      </span>
                    )}
                    {item.hierarchy && (
                      <span className="rounded-full bg-[#F3E9DF] px-3 py-1">
                        {item.hierarchy}
                      </span>
                    )}
                  </div>

                  {supplemental?.learning_objective && (
                    <div className="mt-4 rounded-2xl bg-[#F3E9DF] p-4">
                      <p className="text-sm font-bold text-[#1C3829]">
                        Mục tiêu học tập
                      </p>

                      <p className="mt-2 text-sm leading-7 text-gray-700">
                        {supplemental.learning_objective}
                      </p>
                    </div>
                  )}

                  {sections.length > 0 ? (
                    <div className="mt-5 space-y-5">
                      {sections.map((section, sectionIndex) => (
                        <ContentSectionView
                          key={`${section.heading}-${sectionIndex}`}
                          section={section}
                        />
                      ))}
                    </div>
                  ) : (
                    <>
                      {item.description && (
                        <p className="mt-4 text-sm leading-7 text-gray-700">
                          {item.description}
                        </p>
                      )}

                      {item.source_content && (
                        <div className="mt-4 rounded-2xl bg-[#F3E9DF] p-4">
                          <p className="text-sm font-bold text-[#1C3829]">
                            Nội dung tham khảo
                          </p>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-gray-700">
                            {item.source_content}
                          </p>
                        </div>
                      )}
                    </>
                  )}

                  {item.recommendation && (
                    <div className="mt-5 border-t border-[#E2E9DF] pt-4">
                      <p className="text-sm font-bold text-[#1C3829]">
                        Gợi ý cải thiện
                      </p>
                      <p className="mt-2 text-sm leading-7 text-gray-700">
                        {item.recommendation}
                      </p>
                    </div>
                  )}

                  {item.scheduled_date && (
                    <div className="mt-4 rounded-2xl bg-[#E8EEE4] p-4">
                      <p className="text-sm font-bold text-[#1C3829]">
                        Lịch ôn tập đề xuất
                      </p>
                      <p className="mt-1 text-sm leading-7 text-gray-700">
                        Ôn nội dung này vào ngày{" "}
                        <strong>{item.scheduled_date}</strong>, là ngày
                        đang trống trong lịch học chính của bạn.
                      </p>
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        )}

        {/* Original learning materials */}
        {material.chunks && material.chunks.length > 0 && (
          <section className="space-y-5">
            <div>
              <h2 className="text-xl font-bold text-[#1C3829]">
                Tài liệu gốc tham khảo
              </h2>

              <p className="mt-1 text-sm text-gray-500">
                Nội dung được trích xuất từ buổi học đã làm bài kiểm tra.
              </p>
            </div>

            {material.chunks.map((chunk, index) => (
              <article
                key={chunk.id}
                className="rounded-3xl bg-[#FFFCF8] p-6 shadow-sm md:p-8"
              >
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-bold text-[#1C3829]">
                    Phần {index + 1}
                  </h3>

                  <div className="flex gap-2 text-xs">
                    {chunk.page_number != null && (
                      <span className="rounded-full bg-[#E2E9DF] px-3 py-1 font-medium text-[#355642]">
                        Trang {chunk.page_number}
                      </span>
                    )}

                    <span className="rounded-full bg-[#F3E9DF] px-3 py-1 text-gray-600">
                      Nội dung {chunk.chunk_index + 1}
                    </span>
                  </div>
                </div>

                <div className="whitespace-pre-wrap break-words text-sm leading-8 text-gray-800 md:text-base">
                  {chunk.content}
                </div>
              </article>
            ))}
          </section>
        )}

        {/* Retake timer */}
        {requiresRetake && (
          <section className="rounded-3xl bg-[#FFFCF8] p-6 shadow-sm md:p-8">
            <div className="flex flex-col justify-between gap-5 md:flex-row md:items-center">
              <div>
                <h2 className="text-lg font-bold text-[#1C3829]">
                  Thời gian ôn tập
                </h2>

                <p className="mt-1 text-sm text-gray-500">
                  Bạn có thể làm bài kiểm tra lại ngay sau khi xem nội dung
                  ôn tập.
                </p>
              </div>

              <div className="text-left md:text-right">
                <p className="text-4xl font-bold tabular-nums text-[#1C3829]">
                  {formatTime(studySeconds)}
                </p>

                <p className="mt-1 text-sm text-gray-500">
                  phút đã ôn
                </p>
              </div>
            </div>

            <div className="mt-5 h-3 overflow-hidden rounded-full bg-[#E2E9DF]">
              <div
                className="h-full rounded-full bg-[#5D856C] transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>

            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-gray-500">
                {Math.round(progress)}% hoàn thành
              </span>

              <span className="font-semibold text-[#5D856C]">
                Đã sẵn sàng làm bài kiểm tra lại
              </span>
            </div>

            <p className="mt-4 text-xs leading-5 text-gray-500">
              Thời gian chỉ được ghi nhận khi trang ôn tập đang hiển thị.
              Hãy đọc và ôn lại nội dung trước khi tiếp tục.
            </p>
          </section>
        )}

        {activityError && (
          <p className="rounded-xl bg-[#FCE8E4] p-4 text-sm text-[#A94F3D]">
            {activityError}
          </p>
        )}

        {/* Completion actions */}
        <section className="rounded-3xl bg-[#FFFCF8] p-6 text-center shadow-sm md:p-8">
          {requiresRetake ? (
            isEligible ? (
              <>
                <h2 className="text-xl font-bold text-[#1C3829]">
                  Bạn đã xem nội dung ôn tập!
                </h2>

                <p className="mt-2 text-sm text-gray-600">
                  Bạn có thể tiếp tục làm bài kiểm tra lại.
                </p>

                <button
                  onClick={handleStartRetake}
                  disabled={!material.retake_quiz_id}
                  className="mt-6 rounded-2xl bg-[#1C3829] px-8 py-4 font-bold text-white transition hover:bg-[#355642] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Bắt đầu Quiz ôn tập lại →
                </button>
              </>
            ) : (
              <>
                <h2 className="text-xl font-bold text-[#1C3829]">
                  Hãy tiếp tục ôn tập nhé!
                </h2>

                <p className="mt-2 text-sm text-gray-600">
                  Bài kiểm tra lại sẽ được mở sau khi nội dung ôn tập
                  được tải xong.
                </p>

                <button
                  disabled
                  className="mt-6 cursor-not-allowed rounded-2xl bg-gray-300 px-8 py-4 font-bold text-gray-600"
                >
                  Chưa sẵn sàng
                </button>
              </>
            )
          ) : completed ? (
            <>
              <h2 className="text-xl font-bold text-[#1C3829]">
                Bạn đã hoàn thành lộ trình học bổ trợ!
              </h2>

              <p className="mt-2 text-sm text-gray-600">
                Hãy tiếp tục học các nội dung tiếp theo để củng cố kiến thức.
              </p>

              <button
                onClick={() => router.push("/quizzes")}
                className="mt-6 rounded-2xl bg-[#1C3829] px-8 py-4 font-bold text-white transition hover:bg-[#355642]"
              >
                Quay lại danh sách bài kiểm tra →
              </button>
            </>
          ) : (
            <>
              <h2 className="text-xl font-bold text-[#1C3829]">
                Hoàn thành nội dung học bổ trợ
              </h2>

              <p className="mt-2 text-sm text-gray-600">
                Sau khi đọc và nắm được các kiến thức trên, bạn có thể
                xác nhận hoàn thành lộ trình.
              </p>

              <button
                onClick={handleCompleteSupplemental}
                disabled={completing}
                className="mt-6 rounded-2xl bg-[#1C3829] px-8 py-4 font-bold text-white transition hover:bg-[#355642] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {completing
                  ? "Đang cập nhật..."
                  : "Hoàn thành học bổ trợ ✓"}
              </button>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

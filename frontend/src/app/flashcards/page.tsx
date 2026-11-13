
"use client";

import { useEffect, useState } from "react";
import { getMainTopicTitle } from "@/lib/content-titles";

const API_URL = "http://127.0.0.1:8000";

type Flashcard = {
  id: string;
  front: string;
  back: string;
  topic_id: string;
  source: string;
};

type StudyPlan = {
  id: string;
  name?: string;
  title?: string;
  course_name?: string;
  subject_name?: string;
};

type StudyMaterial = {
  id: string;
  file_name?: string;
  original_filename?: string;
  name?: string;
  title?: string;
  material_type?: string;
  processing_status?: string;
};

type Topic = {
  id: string;
  name: string;
  source_material_id: string;
};

function getFlashcardPoints(content: string): string[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean);

  if (lines.length > 1) {
    return lines.slice(0, 2);
  }

  return content
    .split(/[.!?]\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 2);
}

export default function FlashcardsPage() {
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [plans, setPlans] = useState<StudyPlan[]>([]);
  const [materials, setMaterials] = useState<StudyMaterial[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);

  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [selectedMaterialId, setSelectedMaterialId] = useState("");
  const [selectedTopicId, setSelectedTopicId] = useState("");
  const [numberOfCards, setNumberOfCards] = useState(5);

  const [showDueOnly, setShowDueOnly] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

  const [loading, setLoading] = useState(true);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [error, setError] = useState("");
  const [generationMessage, setGenerationMessage] = useState("");
  const [generationError, setGenerationError] = useState("");
  const [reviewMessage, setReviewMessage] = useState("");

  const [refreshKey, setRefreshKey] = useState(0);

  // 1. Tải danh sách kế hoạch ôn thi
  useEffect(() => {
    async function fetchPlans() {
      try {
        const response = await fetch(`${API_URL}/api/exam-plans`);

        if (!response.ok) {
          throw new Error("Không thể tải danh sách kế hoạch ôn thi.");
        }

        const result = await response.json();
        const planData = result.data || [];

        setPlans(planData);

        if (planData.length > 0) {
          setSelectedPlanId(planData[0].id);
        }
      } catch (err) {
        setGenerationError(
          err instanceof Error
            ? err.message
            : "Không thể tải kế hoạch ôn thi."
        );
      }
    }

    fetchPlans();
  }, []);

  // 2. Tải tài liệu và chủ đề theo kế hoạch được chọn
  useEffect(() => {
    if (!selectedPlanId) {
      setMaterials([]);
      setTopics([]);
      setSelectedMaterialId("");
      setSelectedTopicId("");
      return;
    }

    let cancelled = false;

    async function fetchStudyOptions() {
      setOptionsLoading(true);
      setMaterials([]);
      setTopics([]);
      setSelectedMaterialId("");
      setSelectedTopicId("");
      setGenerationError("");

      try {
        const [materialResponse, topicResponse] = await Promise.all([
          fetch(
            `${API_URL}/api/study-materials?exam_plan_id=${selectedPlanId}`
          ),
          fetch(
            `${API_URL}/api/topics?exam_plan_id=${selectedPlanId}`
          ),
        ]);

        if (!materialResponse.ok) {
          throw new Error("Không thể tải danh sách tài liệu.");
        }

        if (!topicResponse.ok) {
          throw new Error("Không thể tải danh sách chủ đề.");
        }

        const materialResult = await materialResponse.json();
        const topicResult = await topicResponse.json();

        if (cancelled) return;

        const materialData: StudyMaterial[] =
          materialResult.data || [];

        const topicData: Topic[] =
          topicResult.data || [];

        setMaterials(materialData);
        setTopics(topicData);

        const firstProcessedMaterial = materialData.find(
          (material) =>
            material.material_type === "textbook" &&
            material.processing_status === "processed"
        );

        if (firstProcessedMaterial) {
          setSelectedMaterialId(firstProcessedMaterial.id);

          const relatedTopics = topicData.filter(
            (topic) =>
              topic.source_material_id === firstProcessedMaterial.id
          );

          if (relatedTopics.length > 0) {
            setSelectedTopicId(relatedTopics[0].id);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setGenerationError(
            err instanceof Error
              ? err.message
              : "Không thể tải tài liệu và chủ đề."
          );
        }
      } finally {
        if (!cancelled) {
          setOptionsLoading(false);
        }
      }
    }

    fetchStudyOptions();

    return () => {
      cancelled = true;
    };
  }, [selectedPlanId]);

  // 3. Tải Flashcard
  useEffect(() => {
    let cancelled = false;

    async function fetchFlashcards() {
      setLoading(true);
      setError("");
      setCurrentIndex(0);
      setIsFlipped(false);

      try {
        const endpoint = showDueOnly
          ? `${API_URL}/api/flashcards/due`
          : `${API_URL}/api/flashcards`;

        const response = await fetch(endpoint);

        if (!response.ok) {
          throw new Error("Không thể tải danh sách Flashcard.");
        }

        const result = await response.json();

        if (!cancelled) {
          setFlashcards(result.data || []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Đã xảy ra lỗi khi tải Flashcard."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchFlashcards();

    return () => {
      cancelled = true;
    };
  }, [showDueOnly, refreshKey]);

  // 4. Lấy danh sách chủ đề theo tài liệu được chọn
  const availableTopics = topics.filter(
    (topic) =>
      topic.source_material_id === selectedMaterialId
  );

  const selectedMaterial = materials.find(
    (material) => material.id === selectedMaterialId
  );

  const currentCard = flashcards[currentIndex];

  function getPlanName(plan: StudyPlan) {
    return (
      plan.name ||
      plan.course_name ||
      plan.subject_name ||
      plan.title ||
      "Kế hoạch ôn thi"
    );
  }

  function getMaterialName(material: StudyMaterial) {
    return (
      material.original_filename ||
      material.file_name ||
      material.name ||
      material.title ||
      "Tài liệu học tập"
    );
  }

  // 5. Tạo Flashcard bằng AI
  async function handleGenerateFlashcards() {
    if (!selectedMaterialId || !selectedTopicId) {
      setGenerationError("Vui lòng chọn tài liệu và chủ đề.");
      return;
    }

    if (
      !selectedMaterial ||
      selectedMaterial.processing_status !== "processed"
    ) {
      setGenerationError(
        "Tài liệu chưa được xử lý hoàn tất."
      );
      return;
    }

    setGenerating(true);
    setGenerationError("");
    setGenerationMessage("");

    try {
      const response = await fetch(
        `${API_URL}/api/flashcards/generate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            material_id: selectedMaterialId,
            topic_id: selectedTopicId,
            number_of_cards: numberOfCards,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.detail || "Không thể tạo Flashcard bằng AI."
        );
      }

      setGenerationMessage(
        `Đã tạo thành công ${result.created_cards} Flashcard!`
      );

      setShowDueOnly(false);
      setCurrentIndex(0);
      setIsFlipped(false);
      setRefreshKey((prev) => prev + 1);
    } catch (err) {
      setGenerationError(
        err instanceof Error
          ? err.message
          : "Đã xảy ra lỗi khi tạo Flashcard."
      );
    } finally {
      setGenerating(false);
    }
  }

  // 6. Chuyển Flashcard
  function handleNext() {
    setIsFlipped(false);
    setCurrentIndex((prev) =>
      Math.min(prev + 1, flashcards.length - 1)
    );
    setReviewMessage("");
  }

  function handlePrevious() {
    setIsFlipped(false);
    setCurrentIndex((prev) => Math.max(prev - 1, 0));
    setReviewMessage("");
  }

  // 7. Lưu kết quả ôn tập
  async function handleReview(rating: number) {
    if (isSubmitting || !currentCard) return;

    setIsSubmitting(true);
    setReviewMessage("");

    try {
      const response = await fetch(
        `${API_URL}/api/flashcards/review`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            flashcard_id: currentCard.id,
            rating,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.detail || "Không thể lưu kết quả ôn tập."
        );
      }

      setReviewMessage("Đã lưu kết quả ôn tập thành công!");
      setIsFlipped(false);

      if (showDueOnly) {
        setRefreshKey((prev) => prev + 1);
      } else if (currentIndex < flashcards.length - 1) {
        setCurrentIndex((prev) => prev + 1);
      }
    } catch (err) {
      setReviewMessage(
        err instanceof Error
          ? err.message
          : "Đã xảy ra lỗi khi lưu kết quả."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-stone-50 px-6 py-12">
      <div className="mx-auto max-w-4xl">
        {/* Tiêu đề */}
        <div className="mb-10 text-center">
          <p className="text-sm font-semibold tracking-widest text-emerald-700 uppercase">
            StudyPilot
          </p>

          <h1 className="mt-3 text-3xl font-bold text-gray-900">
            Ôn tập Flashcard
          </h1>

          <p className="mt-3 text-gray-500">
            Học từng kiến thức nhỏ, ghi nhớ hiệu quả hơn.
          </p>
        </div>

        {/* Khu vực tạo Flashcard */}
        <section className="mb-10 rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-gray-900">
              Tạo Flashcard bằng AI
            </h2>

            <p className="mt-2 text-sm text-gray-500">
              Chọn tài liệu và chủ đề để AI tạo thẻ hỏi đáp
              dựa trên nội dung bạn đang học.
            </p>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            {/* Chọn kế hoạch */}
            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-700">
                Kế hoạch ôn thi
              </label>

              <select
                value={selectedPlanId}
                onChange={(event) =>
                  setSelectedPlanId(event.target.value)
                }
                disabled={plans.length === 0 || optionsLoading}
                className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 outline-none focus:border-emerald-700"
              >
                <option value="">Chọn kế hoạch ôn thi</option>

                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {getPlanName(plan)}
                  </option>
                ))}
              </select>
            </div>

            {/* Chọn tài liệu */}
            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-700">
                Tài liệu học tập
              </label>

              <select
                value={selectedMaterialId}
                onChange={(event) => {
                  const materialId = event.target.value;

                  setSelectedMaterialId(materialId);

                  const firstTopic = topics.find(
                    (topic) =>
                      topic.source_material_id === materialId
                  );

                  setSelectedTopicId(firstTopic?.id || "");
                  setGenerationMessage("");
                  setGenerationError("");
                }}
                disabled={optionsLoading || materials.length === 0}
                className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 outline-none focus:border-emerald-700"
              >
                <option value="">Chọn tài liệu</option>

                {materials
                  .filter(
                    (material) =>
                      material.material_type === "textbook"
                  )
                  .map((material) => (
                    <option key={material.id} value={material.id}>
                      {getMaterialName(material)}
                    </option>
                  ))}
              </select>
            </div>

            {/* Chọn chủ đề */}
            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-700">
                Chủ đề
              </label>

              <select
                value={selectedTopicId}
                onChange={(event) => {
                  setSelectedTopicId(event.target.value);
                  setGenerationMessage("");
                  setGenerationError("");
                }}
                disabled={
                  optionsLoading ||
                  !selectedMaterialId ||
                  availableTopics.length === 0
                }
                className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 outline-none focus:border-emerald-700"
              >
                <option value="">Chọn chủ đề</option>

                {availableTopics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {getMainTopicTitle(topic.name)}
                  </option>
                ))}
              </select>
            </div>

            {/* Số lượng Flashcard */}
            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-700">
                Số lượng Flashcard
              </label>

              <select
                value={numberOfCards}
                onChange={(event) =>
                  setNumberOfCards(Number(event.target.value))
                }
                className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 outline-none focus:border-emerald-700"
              >
                {[5, 10, 15, 20].map((number) => (
                  <option key={number} value={number}>
                    {number} thẻ
                  </option>
                ))}
              </select>
            </div>
          </div>

          {optionsLoading && (
            <p className="mt-4 text-sm text-gray-500">
              Đang tải tài liệu và chủ đề...
            </p>
          )}

          {!optionsLoading &&
            selectedMaterialId &&
            availableTopics.length === 0 && (
              <p className="mt-4 text-sm text-amber-700">
                Tài liệu này chưa có chủ đề được AI phân tích.
              </p>
            )}

          {!optionsLoading &&
            plans.length === 0 && (
              <p className="mt-4 text-sm text-gray-500">
                Bạn chưa có kế hoạch ôn thi. Hãy tạo kế hoạch
                và tải tài liệu trước nhé.
              </p>
            )}

          {selectedMaterial &&
            selectedMaterial.processing_status !== "processed" && (
              <p className="mt-4 text-sm text-amber-700">
                Tài liệu chưa xử lý xong. Vui lòng chờ xử lý
                tài liệu trước khi tạo Flashcard.
              </p>
            )}

          {generationError && (
            <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
              {generationError}
            </p>
          )}

          {generationMessage && (
            <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
              {generationMessage}
            </p>
          )}

          <button
            type="button"
            onClick={handleGenerateFlashcards}
            disabled={
              generating ||
              optionsLoading ||
              !selectedMaterialId ||
              !selectedTopicId ||
              selectedMaterial?.processing_status !== "processed"
            }
            className="mt-6 w-full rounded-xl bg-emerald-800 px-6 py-4 font-semibold text-white transition hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating
              ? "AI đang tạo Flashcard..."
              : "Tạo Flashcard bằng AI"}
          </button>
        </section>

        {/* Khu vực ôn tập */}
        <section>
          <div className="mb-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                setShowDueOnly(false);
                setCurrentIndex(0);
                setIsFlipped(false);
                setReviewMessage("");
              }}
              className={`rounded-xl px-5 py-3 font-medium transition ${
                !showDueOnly
                  ? "bg-emerald-800 text-white"
                  : "border border-gray-300 bg-white text-gray-700"
              }`}
            >
              Tất cả Flashcard
            </button>

            <button
              type="button"
              onClick={() => {
                setShowDueOnly(true);
                setCurrentIndex(0);
                setIsFlipped(false);
                setReviewMessage("");
              }}
              className={`rounded-xl px-5 py-3 font-medium transition ${
                showDueOnly
                  ? "bg-emerald-800 text-white"
                  : "border border-gray-300 bg-white text-gray-700"
              }`}
            >
              Cần ôn hôm nay
            </button>
          </div>

          {loading ? (
            <div className="rounded-3xl border border-stone-200 bg-white p-12 text-center">
              <p className="text-gray-600">
                Đang tải Flashcard...
              </p>
            </div>
          ) : error ? (
            <div className="rounded-3xl border border-red-200 bg-white p-8 text-center">
              <p className="text-red-600">{error}</p>
              <p className="mt-2 text-sm text-gray-500">
                Hãy kiểm tra Backend có đang chạy hay không.
              </p>
            </div>
          ) : flashcards.length === 0 ? (
            <div className="rounded-3xl border border-stone-200 bg-white p-12 text-center">
              <h3 className="text-lg font-semibold text-gray-900">
                {showDueOnly
                  ? "Bạn đã hoàn thành các thẻ cần ôn hôm nay!"
                  : "Chưa có Flashcard nào"}
              </h3>

              <p className="mt-3 text-sm text-gray-500">
                {showDueOnly
                  ? "Hãy quay lại vào ngày ôn tập tiếp theo."
                  : "Chọn tài liệu và chủ đề ở phía trên để tạo Flashcard bằng AI nhé!"}
              </p>
            </div>
          ) : currentCard ? (
            <>
              {/* Tiến độ */}
              <div className="mb-5 flex items-center justify-between text-sm text-gray-600">
                <span>Tiến độ học tập</span>
                <span>
                  {currentIndex + 1} / {flashcards.length}
                </span>
              </div>

              <div className="mb-8 h-2 w-full overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full rounded-full bg-emerald-700 transition-all duration-300"
                  style={{
                    width: `${
                      ((currentIndex + 1) / flashcards.length) * 100
                    }%`,
                  }}
                />
              </div>

              {/* Thẻ Flashcard */}
              <button
                type="button"
                onClick={() => setIsFlipped((prev) => !prev)}
                className="min-h-[320px] w-full rounded-3xl border border-stone-200 bg-white p-10 text-center shadow-sm transition-all hover:shadow-md"
              >
                <p className="mb-8 text-sm font-semibold uppercase tracking-wider text-emerald-700">
                  {isFlipped ? "Đáp án" : "Câu hỏi"}
                </p>

                <div className="flex min-h-[170px] items-center justify-center">
                  {isFlipped ? (
                    <ul className="w-full max-w-2xl space-y-3 text-left">
                      {getFlashcardPoints(currentCard.back).map(
                        (point, index) => (
                          <li
                            key={`${currentCard.id}-point-${index}`}
                            className="flex items-start gap-3 text-lg font-semibold leading-8 text-gray-900"
                          >
                            <span
                              aria-hidden="true"
                              className="mt-3 h-2 w-2 shrink-0 rounded-full bg-emerald-700"
                            />
                            <span>{point}</span>
                          </li>
                        )
                      )}
                    </ul>
                  ) : (
                    <p className="text-xl font-semibold leading-relaxed text-gray-900">
                      {currentCard.front}
                    </p>
                  )}
                </div>

                <p className="mt-6 text-sm text-gray-400">
                  Nhấn vào thẻ để{" "}
                  {isFlipped
                    ? "xem câu hỏi"
                    : "lật thẻ xem đáp án"}
                </p>
              </button>

              {/* Đánh giá mức độ ghi nhớ */}
              {isFlipped && (
                <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
                  <button
                    type="button"
                    onClick={() => handleReview(1)}
                    disabled={isSubmitting}
                    className="rounded-xl bg-red-100 px-4 py-4 font-semibold text-red-700 transition hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSubmitting ? "Đang lưu..." : "😵 Chưa nhớ"}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleReview(2)}
                    disabled={isSubmitting}
                    className="rounded-xl bg-orange-100 px-4 py-4 font-semibold text-orange-700 transition hover:bg-orange-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSubmitting ? "Đang lưu..." : "😕 Khó nhớ"}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleReview(3)}
                    disabled={isSubmitting}
                    className="rounded-xl bg-blue-100 px-4 py-4 font-semibold text-blue-700 transition hover:bg-blue-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSubmitting ? "Đang lưu..." : "🙂 Đã nhớ"}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleReview(4)}
                    disabled={isSubmitting}
                    className="rounded-xl bg-emerald-100 px-4 py-4 font-semibold text-emerald-800 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSubmitting ? "Đang lưu..." : "😎 Rất dễ"}
                  </button>
                </div>
              )}


              {reviewMessage && (
                <p className="mt-4 text-center text-sm text-gray-600">
                  {reviewMessage}
                </p>
              )}

              {/* Điều hướng */}
              <div className="mt-8 flex items-center justify-between gap-4">
                <button
                  type="button"
                  onClick={handlePrevious}
                  disabled={currentIndex === 0}
                  className="rounded-xl border border-gray-300 bg-white px-6 py-3 font-medium text-gray-700 disabled:opacity-40"
                >
                  ← Trước
                </button>

                <button
                  type="button"
                  onClick={() => setIsFlipped((prev) => !prev)}
                  className="rounded-xl bg-emerald-800 px-6 py-3 font-medium text-white transition hover:bg-emerald-900"
                >
                  {isFlipped ? "Xem câu hỏi" : "Xem đáp án"}
                </button>

                <button
                  type="button"
                  onClick={handleNext}
                  disabled={currentIndex === flashcards.length - 1}
                  className="rounded-xl border border-gray-300 bg-white px-6 py-3 font-medium text-gray-700 disabled:opacity-40"
                >
                  Tiếp theo →
                </button>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </main>
  );
}

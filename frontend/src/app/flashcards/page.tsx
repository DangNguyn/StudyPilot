"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LoadingMascot } from "@/components/loading-play";
import { getMainTopicTitle } from "@/lib/content-titles";
import {
  IconBook,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconLayers,
  IconRepeat,
  Sparkle,
} from "@/components/icons";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

type Flashcard = {
  id: string;
  front: string;
  back: string;
  topic_id: string;
  source: string;
};

type Subject = { id: string; name: string };

type ExamPlan = {
  id: string;
  title?: string;
  subject_id?: string;
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
  hierarchy?: string | null;
  source_material_id: string;
};

/* ================= Tiện ích ================= */

function getFlashcardPoints(content: string): string[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean);
  if (lines.length > 1) return lines.slice(0, 3);
  return content
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function materialName(material: StudyMaterial) {
  return material.original_filename || material.file_name || material.name || material.title || "Tài liệu học tập";
}

function chapterOf(topic?: Topic) {
  return String(topic?.hierarchy || "").split(">")[0].trim() || "Chủ đề khác";
}

async function getList<T>(url: string, fallback: string): Promise<T[]> {
  const response = await fetch(url, { cache: "no-store" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.detail || fallback);
  return Array.isArray(result?.data) ? result.data : [];
}

const RATINGS = [
  { value: 1, label: "Chưa nhớ", hint: "Ôn lại sớm", tone: "border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)] hover:border-[var(--sp-pink)]" },
  { value: 2, label: "Khó nhớ", hint: "Cần thêm lần nữa", tone: "border-[#f3dca0] bg-[var(--sp-amber-bg)] text-[var(--sp-amber-dark)] hover:border-[#E6A23C]" },
  { value: 3, label: "Đã nhớ", hint: "Giãn lịch ôn", tone: "border-[var(--sp-lav-line)] bg-[var(--sp-lav)] text-[var(--sp-peri-dark)] hover:border-[var(--sp-peri)]" },
  { value: 4, label: "Rất dễ", hint: "Lâu mới ôn lại", tone: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-400" },
] as const;

/* ================= Trang ================= */

export default function FlashcardsPage() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [plans, setPlans] = useState<ExamPlan[]>([]);
  const [materials, setMaterials] = useState<StudyMaterial[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);

  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [selectedMaterialId, setSelectedMaterialId] = useState("");
  const [selectedTopicId, setSelectedTopicId] = useState("");
  const [numberOfCards, setNumberOfCards] = useState(10);

  const [showDueOnly, setShowDueOnly] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [reviewed, setReviewed] = useState<Record<string, number>>({});

  const [loading, setLoading] = useState(true);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [error, setError] = useState("");
  const [generationMessage, setGenerationMessage] = useState("");
  const [generationError, setGenerationError] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  // 1. Môn học và kế hoạch ôn thi
  useEffect(() => {
    Promise.all([
      getList<Subject>(`${API_URL}/api/subjects`, "Không thể tải môn học.").catch(() => []),
      getList<ExamPlan>(`${API_URL}/api/exam-plans`, "Không thể tải kế hoạch ôn thi."),
    ])
      .then(([subjectList, planList]) => {
        setSubjects(subjectList);
        setPlans(planList);
        if (planList.length > 0) setSelectedPlanId(planList[0].id);
        else setOptionsLoading(false);
      })
      .catch((err) => {
        setOptionsLoading(false);
        setGenerationError(err instanceof Error ? err.message : "Không thể tải kế hoạch ôn thi.");
      });
  }, []);

  // 2. Tài liệu và chủ đề của môn đang chọn
  useEffect(() => {
    if (!selectedPlanId) return;
    let cancelled = false;

    Promise.all([
      getList<StudyMaterial>(`${API_URL}/api/study-materials?exam_plan_id=${selectedPlanId}`, "Không thể tải danh sách tài liệu."),
      getList<Topic>(`${API_URL}/api/topics?exam_plan_id=${selectedPlanId}`, "Không thể tải danh sách chủ đề."),
    ])
      .then(([materialData, topicData]) => {
        if (cancelled) return;
        setMaterials(materialData);
        setTopics(topicData);
        const firstMaterial = materialData.find(
          (material) => material.material_type === "textbook" && material.processing_status === "processed"
        );
        setSelectedMaterialId(firstMaterial?.id || "");
        setSelectedTopicId(topicData.find((topic) => topic.source_material_id === firstMaterial?.id)?.id || "");
      })
      .catch((err) => {
        if (!cancelled) setGenerationError(err instanceof Error ? err.message : "Không thể tải tài liệu và chủ đề.");
      })
      .finally(() => {
        if (!cancelled) setOptionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedPlanId]);

  // 3. Flashcard
  useEffect(() => {
    let cancelled = false;
    getList<Flashcard>(
      showDueOnly ? `${API_URL}/api/flashcards/due` : `${API_URL}/api/flashcards`,
      "Không thể tải danh sách Flashcard."
    )
      .then((data) => {
        if (!cancelled) {
          setFlashcards(data);
          setError("");
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Đã xảy ra lỗi khi tải Flashcard.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showDueOnly, refreshKey]);

  /* Chỉ hiện thẻ của môn đang chọn */
  const topicById = useMemo(() => new Map(topics.map((topic) => [topic.id, topic])), [topics]);
  const deck = useMemo(
    () => (topics.length ? flashcards.filter((card) => topicById.has(card.topic_id)) : flashcards),
    [flashcards, topicById, topics.length]
  );
  const safeIndex = Math.min(currentIndex, Math.max(0, deck.length - 1));
  const currentCard = deck[safeIndex];
  const currentTopic = currentCard ? topicById.get(currentCard.topic_id) : undefined;
  const textbookMaterials = materials.filter((material) => material.material_type === "textbook");
  const availableTopics = topics.filter((topic) => topic.source_material_id === selectedMaterialId);
  const selectedMaterial = materials.find((material) => material.id === selectedMaterialId);
  const topicGroups = useMemo(() => {
    const groups = new Map<string, Topic[]>();
    for (const topic of availableTopics) {
      const key = chapterOf(topic);
      groups.set(key, [...(groups.get(key) || []), topic]);
    }
    return Array.from(groups.entries());
  }, [availableTopics]);

  const subjectName = (plan: ExamPlan) =>
    subjects.find((subject) => subject.id === plan.subject_id)?.name || plan.title || "Môn học";
  const reviewedInDeck = deck.filter((card) => reviewed[card.id]).length;
  const rememberedInDeck = deck.filter((card) => (reviewed[card.id] || 0) >= 3).length;

  function resetStudy() {
    setCurrentIndex(0);
    setIsFlipped(false);
    setReviewError("");
  }

  const go = useCallback(
    (step: number) => {
      setIsFlipped(false);
      setReviewError("");
      setCurrentIndex((index) => Math.min(Math.max(index + step, 0), Math.max(0, deck.length - 1)));
    },
    [deck.length]
  );

  // 4. Tạo Flashcard bằng AI
  async function handleGenerateFlashcards() {
    if (!selectedMaterialId || !selectedTopicId) {
      setGenerationError("Hãy chọn tài liệu và chủ đề.");
      return;
    }
    if (selectedMaterial?.processing_status !== "processed") {
      setGenerationError("Tài liệu chưa được xử lý xong.");
      return;
    }
    setGenerating(true);
    setGenerationError("");
    setGenerationMessage("");
    try {
      const response = await fetch(`${API_URL}/api/flashcards/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          material_id: selectedMaterialId,
          topic_id: selectedTopicId,
          number_of_cards: numberOfCards,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.detail || "Không thể tạo Flashcard bằng AI.");
      setGenerationMessage(`Đã tạo ${result.created_cards} thẻ mới, xếp vào bộ thẻ bên trái.`);
      setShowDueOnly(false);
      resetStudy();
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : "Đã xảy ra lỗi khi tạo Flashcard.");
    } finally {
      setGenerating(false);
    }
  }

  // 5. Lưu mức độ ghi nhớ
  const handleReview = useCallback(
    async (rating: number) => {
      if (isSubmitting || !currentCard) return;
      setIsSubmitting(true);
      setReviewError("");
      try {
        const response = await fetch(`${API_URL}/api/flashcards/review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ flashcard_id: currentCard.id, rating }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.detail || "Không thể lưu kết quả ôn tập.");
        setReviewed((current) => ({ ...current, [currentCard.id]: rating }));
        setIsFlipped(false);
        if (showDueOnly) setRefreshKey((value) => value + 1);
        else if (safeIndex < deck.length - 1) setCurrentIndex(safeIndex + 1);
      } catch (err) {
        setReviewError(err instanceof Error ? err.message : "Đã xảy ra lỗi khi lưu kết quả.");
      } finally {
        setIsSubmitting(false);
      }
    },
    [isSubmitting, currentCard, showDueOnly, safeIndex, deck.length]
  );

  // 6. Phím tắt: Space lật thẻ, ← → chuyển thẻ, 1–4 chấm mức nhớ
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (!currentCard) return;
      if (event.code === "Space") {
        event.preventDefault();
        setIsFlipped((value) => !value);
      } else if (event.key === "ArrowRight") go(1);
      else if (event.key === "ArrowLeft") go(-1);
      else if (isFlipped && ["1", "2", "3", "4"].includes(event.key)) void handleReview(Number(event.key));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentCard, isFlipped, go, handleReview]);

  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Đầu trang */}
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--sp-muted)]">KHÔNG GIAN HỌC TẬP / FLASHCARDS</p>
          <h1 className="mt-2 flex items-end gap-3 text-[40px] leading-tight sm:text-[50px]">
            <span>
              Ôn nhanh bằng <span className="sp-squiggle">flashcard</span>
            </span>
            <Sparkle size={24} className="sp-twinkle mb-3 text-[var(--sp-yellow)]" />
          </h1>
          <p className="mt-1 text-[15px] text-[var(--sp-muted)]">
            Lật thẻ, tự trả lời trong đầu rồi chấm mức nhớ. Thẻ khó sẽ quay lại sớm hơn.
          </p>
        </div>

        {plans.length > 0 && (
          <label className="relative flex w-full items-center gap-2 rounded-2xl border-2 border-[var(--sp-line)] bg-white px-4 py-2.5 transition focus-within:border-[var(--sp-peri)] sm:w-auto sm:min-w-[240px]">
            <IconBook size={18} className="shrink-0 text-[var(--sp-ink)]" />
            <span className="sr-only">Chọn môn</span>
            <select
              value={selectedPlanId}
              onChange={(event) => {
                setSelectedPlanId(event.target.value);
                setOptionsLoading(true);
                setGenerationError("");
                setGenerationMessage("");
                resetStudy();
              }}
              className="w-full cursor-pointer appearance-none bg-transparent pr-6 text-[15px] font-bold text-[var(--sp-ink)] outline-none"
            >
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {subjectName(plan)}
                </option>
              ))}
            </select>
            <IconChevronDown size={16} className="pointer-events-none absolute right-4 text-[var(--sp-ink)]" />
          </label>
        )}
      </section>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ---------- Khu ôn tập ---------- */}
        <section className="sp-card p-5 sm:p-7">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="sp-accent text-[17px] text-[var(--sp-pink)]">
                {selectedPlan ? subjectName(selectedPlan) : "Bộ thẻ của bạn"}
              </p>
              <h2 className="text-[22px] text-[var(--sp-ink)]">Bộ thẻ ôn tập</h2>
            </div>
            <div className="flex rounded-xl bg-[var(--sp-surface-2)] p-1" role="tablist">
              {(
                [
                  [false, "Tất cả thẻ"],
                  [true, "Cần ôn hôm nay"],
                ] as const
              ).map(([due, label]) => (
                <button
                  key={label}
                  type="button"
                  role="tab"
                  aria-selected={showDueOnly === due}
                  onClick={() => {
                    if (showDueOnly !== due) setLoading(true);
                    setShowDueOnly(due);
                    resetStudy();
                  }}
                  className={`rounded-lg px-3.5 py-1.5 text-sm font-bold transition ${
                    showDueOnly === due
                      ? "bg-white text-[var(--sp-peri-dark)] shadow-sm"
                      : "text-[var(--sp-muted)] hover:text-[var(--sp-ink)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <LoadingMascot bare className="mt-6" text="Đang tải bộ thẻ…" sub="Pilot đang xếp thẻ đến hạn ôn lên trước." />
          ) : error ? (
            <div className="mt-6 rounded-[24px] bg-[var(--sp-pink-bg)] px-6 py-10 text-center">
              <p className="font-semibold text-[var(--sp-pink-dark)]">{error}</p>
              <p className="mt-1 text-sm text-[var(--sp-text-2)]">Hãy kiểm tra backend có đang chạy không.</p>
            </div>
          ) : !currentCard ? (
            <div className="mt-6 flex flex-col items-center rounded-[24px] border-2 border-dashed border-[var(--sp-lav-line)] px-6 py-14 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]">
                {showDueOnly ? <IconCheck size={26} /> : <IconLayers size={26} />}
              </span>
              <h3 className="mt-4 text-[18px] font-bold text-[var(--sp-ink)]">
                {showDueOnly ? "Bạn đã ôn hết thẻ của hôm nay" : "Môn này chưa có flashcard"}
              </h3>
              <p className="mt-1 max-w-sm text-sm text-[var(--sp-muted)]">
                {showDueOnly
                  ? "Thẻ sẽ quay lại vào ngày cần ôn tiếp theo."
                  : "Chọn một bài ở khung “Tạo thẻ bằng AI” để AI soạn thẻ hỏi đáp từ tài liệu của bạn."}
              </p>
            </div>
          ) : (
            <>
              {/* Tiến độ */}
              <div className="mt-6 flex items-center gap-4">
                <span className="text-[15px] font-extrabold text-[var(--sp-ink)]">
                  Thẻ {safeIndex + 1}
                  <span className="font-bold text-[var(--sp-muted)]"> / {deck.length}</span>
                </span>
                <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-[var(--sp-surface-2)]">
                  <div
                    className="h-full rounded-full bg-[var(--sp-peri)] transition-all duration-300"
                    style={{ width: `${((safeIndex + 1) / deck.length) * 100}%` }}
                  />
                </div>
                <span className="text-[13px] font-semibold text-[var(--sp-muted)]">Đã chấm {reviewedInDeck}</span>
              </div>

              {/* Thẻ lật */}
              <div className="relative mt-5 [perspective:1600px]">
                <span aria-hidden="true" className="absolute inset-x-6 -bottom-2.5 h-full rounded-[28px] border-2 border-[var(--sp-line)] bg-white" />
                <span aria-hidden="true" className="absolute inset-x-3 -bottom-1 h-full rounded-[28px] border-2 border-[var(--sp-line)] bg-white" />
                <button
                  type="button"
                  onClick={() => setIsFlipped((value) => !value)}
                  aria-label={isFlipped ? "Lật lại mặt câu hỏi" : "Lật thẻ xem đáp án"}
                  className={`relative grid min-h-[340px] w-full grid-cols-[minmax(0,1fr)] text-left transition-transform duration-500 [transform-style:preserve-3d] motion-reduce:transition-none ${
                    isFlipped ? "[transform:rotateY(180deg)]" : ""
                  }`}
                >
                  {/* Mặt trước */}
                  <span className="col-start-1 row-start-1 flex min-w-0 flex-col rounded-[28px] border-2 border-[var(--sp-purple-deep)] bg-white p-6 shadow-[6px_6px_0_var(--sp-peri)] [backface-visibility:hidden] sm:p-8">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="sp-chip bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]">Câu hỏi</span>
                      {currentTopic && (
                        <span className="max-w-[60%] truncate text-[13px] font-semibold text-[var(--sp-muted)]">
                          {getMainTopicTitle(currentTopic.name)}
                        </span>
                      )}
                    </span>
                    <span className="flex flex-1 items-center justify-center py-6 text-center text-[22px] font-bold leading-snug text-[var(--sp-ink)] sm:text-[26px]">
                      {currentCard.front}
                    </span>
                    <span className="flex items-center justify-center gap-2 text-[13px] text-[var(--sp-muted)]">
                      <IconRepeat size={14} />
                      Bấm vào thẻ hoặc nhấn Space để lật
                    </span>
                  </span>

                  {/* Mặt sau */}
                  <span className="col-start-1 row-start-1 flex min-w-0 flex-col rounded-[28px] border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-purple)] p-6 text-white shadow-[6px_6px_0_var(--sp-pink)] [backface-visibility:hidden] [transform:rotateY(180deg)] sm:p-8">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="sp-chip bg-[var(--sp-yellow)] text-[var(--sp-purple-deep)]">Đáp án</span>
                      <span className="max-w-[60%] truncate text-[13px] font-semibold text-white/70">{currentCard.front}</span>
                    </span>
                    <span className="flex flex-1 items-center py-6">
                      <span className="mx-auto block w-full max-w-2xl space-y-3">
                        {getFlashcardPoints(currentCard.back).map((point, index) => (
                          <span key={index} className="flex items-start gap-3 text-[18px] font-semibold leading-8 sm:text-[20px]">
                            <span aria-hidden="true" className="mt-3 h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--sp-yellow)]" />
                            <span>{point}</span>
                          </span>
                        ))}
                      </span>
                    </span>
                    <span className="text-center text-[13px] text-white/70">Bạn nhớ thẻ này tới đâu? Chấm ở bên dưới (phím 1–4)</span>
                  </span>
                </button>
              </div>

              {/* Chấm mức nhớ */}
              <div className="mt-8">
                {isFlipped ? (
                  <div className="sp-task-expand grid grid-cols-2 gap-2.5 md:grid-cols-4">
                    {RATINGS.map((rating) => (
                      <button
                        key={rating.value}
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => void handleReview(rating.value)}
                        className={`flex flex-col items-start rounded-2xl border-2 px-4 py-3 text-left transition disabled:opacity-50 ${rating.tone}`}
                      >
                        <span className="flex w-full items-center justify-between">
                          <span className="text-[15px] font-extrabold">{rating.label}</span>
                          <span className="rounded-md bg-white/70 px-1.5 text-[11px] font-bold">{rating.value}</span>
                        </span>
                        <span className="mt-0.5 text-[12px] font-semibold opacity-80">{rating.hint}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-2xl bg-[var(--sp-surface-2)] px-4 py-3 text-center text-[13px] text-[var(--sp-muted)]">
                    Tự trả lời trong đầu trước, rồi lật thẻ để so đáp án và chấm mức nhớ.
                  </p>
                )}
                {reviewError && <p className="mt-2 text-center text-sm font-medium text-[var(--sp-pink-dark)]">{reviewError}</p>}
              </div>

              {/* Điều hướng */}
              <div className="mt-6 flex items-center justify-between gap-3 border-t-2 border-dashed border-[var(--sp-line)] pt-5">
                <button
                  type="button"
                  onClick={() => go(-1)}
                  disabled={safeIndex === 0}
                  className="sp-btn sp-btn-secondary px-4 py-2.5 text-sm disabled:opacity-40"
                >
                  <IconChevronLeft size={16} />
                  <span className="hidden sm:inline">Thẻ trước</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsFlipped((value) => !value)}
                  className="sp-btn bg-[var(--sp-purple)] px-5 py-2.5 text-sm text-white hover:bg-[var(--sp-purple-deep)]"
                >
                  <IconRepeat size={15} />
                  <span className="whitespace-nowrap">{isFlipped ? "Xem câu hỏi" : "Lật thẻ"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => go(1)}
                  disabled={safeIndex >= deck.length - 1}
                  className="sp-btn sp-btn-primary px-4 py-2.5 text-sm disabled:opacity-40"
                >
                  <span className="hidden sm:inline">Thẻ sau</span>
                  <IconChevronRight size={16} />
                </button>
              </div>
              <p className="mt-3 hidden text-center text-[12px] text-[var(--sp-soft)] sm:block">
                Phím tắt: Space lật thẻ · ← → chuyển thẻ · 1–4 chấm mức nhớ
              </p>
            </>
          )}
        </section>

        {/* ---------- Cột phải ---------- */}
        <aside className="space-y-5 lg:sticky lg:top-6">
          {/* Số liệu */}
          <div className="grid grid-cols-3 gap-2.5">
            {[
              { label: "Thẻ của môn", value: deck.length, tone: "text-[var(--sp-ink)]" },
              { label: "Vừa chấm", value: reviewedInDeck, tone: "text-[var(--sp-peri-dark)]" },
              { label: "Đã nhớ", value: rememberedInDeck, tone: "text-emerald-700" },
            ].map((stat) => (
              <div key={stat.label} className="sp-card px-3 py-3 text-center">
                <p className={`text-[24px] font-black leading-none ${stat.tone}`}>{stat.value}</p>
                <p className="mt-1 text-[12px] font-semibold text-[var(--sp-muted)]">{stat.label}</p>
              </div>
            ))}
          </div>

          {/* Tạo thẻ bằng AI */}
          <section className="sp-card p-5">
            <p className="sp-accent text-[16px] text-[var(--sp-pink)]">Soạn từ tài liệu của bạn</p>
            <h2 className="flex items-center gap-2 text-[20px] text-[var(--sp-ink)]">
              Tạo thẻ bằng AI
              <Sparkle size={15} className="text-[var(--sp-yellow)]" />
            </h2>

            {plans.length === 0 && !optionsLoading ? (
              <div className="mt-4 rounded-2xl bg-[var(--sp-surface-2)] p-4 text-sm text-[var(--sp-text-2)]">
                Bạn chưa có kế hoạch ôn thi. Hãy tạo kế hoạch và tải tài liệu trước nhé.
                <Link href="/study-plans" className="sp-btn sp-btn-primary mt-3 w-full justify-center py-2 text-sm">
                  Tạo kế hoạch ôn thi
                </Link>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                {textbookMaterials.length > 1 ? (
                  <div>
                    <label htmlFor="fc-material" className="mb-1.5 block text-sm font-bold text-[var(--sp-ink)]">
                      Tài liệu
                    </label>
                    <select
                      id="fc-material"
                      value={selectedMaterialId}
                      onChange={(event) => {
                        const materialId = event.target.value;
                        setSelectedMaterialId(materialId);
                        setSelectedTopicId(topics.find((topic) => topic.source_material_id === materialId)?.id || "");
                        setGenerationMessage("");
                        setGenerationError("");
                      }}
                      disabled={optionsLoading}
                      className="w-full rounded-xl border-2 border-[var(--sp-line)] bg-white px-3 py-2.5 text-sm text-[var(--sp-ink)] outline-none focus:border-[var(--sp-peri)]"
                    >
                      {textbookMaterials.map((material) => (
                        <option key={material.id} value={material.id}>
                          {materialName(material)}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : selectedMaterial ? (
                  <p className="flex items-center gap-2 rounded-xl bg-[var(--sp-surface-2)] px-3 py-2 text-[13px] text-[var(--sp-text-2)]">
                    <IconBook size={15} className="shrink-0 text-[var(--sp-peri-dark)]" />
                    <span className="truncate">{materialName(selectedMaterial)}</span>
                  </p>
                ) : null}

                <div>
                  <label htmlFor="fc-topic" className="mb-1.5 block text-sm font-bold text-[var(--sp-ink)]">
                    Bài học
                  </label>
                  <select
                    id="fc-topic"
                    value={selectedTopicId}
                    onChange={(event) => {
                      setSelectedTopicId(event.target.value);
                      setGenerationMessage("");
                      setGenerationError("");
                    }}
                    disabled={optionsLoading || availableTopics.length === 0}
                    className="w-full rounded-xl border-2 border-[var(--sp-line)] bg-white px-3 py-2.5 text-sm text-[var(--sp-ink)] outline-none focus:border-[var(--sp-peri)] disabled:opacity-60"
                  >
                    {availableTopics.length === 0 && <option value="">Chưa có bài học</option>}
                    {topicGroups.map(([chapter, list]) => (
                      <optgroup key={chapter} label={chapter}>
                        {list.map((topic) => (
                          <option key={topic.id} value={topic.id}>
                            {getMainTopicTitle(topic.name)}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                <div>
                  <p className="mb-1.5 text-sm font-bold text-[var(--sp-ink)]">Số thẻ</p>
                  <div className="grid grid-cols-4 gap-2">
                    {[5, 10, 15, 20].map((number) => (
                      <button
                        key={number}
                        type="button"
                        aria-pressed={numberOfCards === number}
                        onClick={() => setNumberOfCards(number)}
                        className={`rounded-xl border-2 py-2 text-sm font-bold transition ${
                          numberOfCards === number
                            ? "border-[var(--sp-purple)] bg-[var(--sp-purple)] text-white shadow-[2px_2px_0_var(--sp-pink)]"
                            : "border-[var(--sp-line)] bg-white text-[var(--sp-muted)] hover:border-[var(--sp-lav-line)]"
                        }`}
                      >
                        {number}
                      </button>
                    ))}
                  </div>
                </div>

                {optionsLoading && <p className="text-sm text-[var(--sp-muted)]">Đang tải tài liệu và bài học...</p>}
                {selectedMaterial && selectedMaterial.processing_status !== "processed" && (
                  <p className="rounded-xl bg-[var(--sp-amber-bg)] px-3 py-2 text-sm text-[var(--sp-amber-dark)]">
                    Tài liệu chưa xử lý xong, vui lòng chờ thêm.
                  </p>
                )}
                {generationError && (
                  <p className="rounded-xl bg-[var(--sp-pink-bg)] px-3 py-2 text-sm text-[var(--sp-pink-dark)]">{generationError}</p>
                )}
                {generationMessage && (
                  <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">{generationMessage}</p>
                )}

                <button
                  type="button"
                  onClick={() => void handleGenerateFlashcards()}
                  disabled={
                    generating ||
                    optionsLoading ||
                    !selectedMaterialId ||
                    !selectedTopicId ||
                    selectedMaterial?.processing_status !== "processed"
                  }
                  className="sp-btn sp-btn-primary w-full justify-center py-3 text-[15px] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Sparkle size={15} className={generating ? "sp-twinkle" : ""} />
                  {generating ? "AI đang soạn thẻ..." : `Tạo ${numberOfCards} thẻ với AI`}
                </button>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

"use client";

import { currentLocale, tx } from "@/lib/i18n";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { LoadingMascot } from "@/components/loading-play";
import { getMainTopicTitle } from "@/lib/content-titles";
import {
  IconBook,
  IconCheck,
  IconChevronDown,
  IconFile,
  IconLayers,
  IconPlus,
  IconRepeat,
  IconTrash,
  IconX,
  Sparkle,
} from "@/components/icons";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

type Flashcard = {
  id: string;
  front: string;
  back: string;
  topic_id: string | null;
  deck_id?: string | null;
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

/* Bộ thẻ tự tải tài liệu lên, không thuộc kế hoạch ôn thi nào */
type UploadedDeck = {
  id: string;
  name: string;
  file_name?: string | null;
  card_count?: number;
  created_at?: string;
};

type Selection = { kind: "plan" | "deck"; id: string } | null;

/* Vuốt phải = đã nhớ (mức 3), vuốt trái = chưa nhớ (mức 1): lưu vào lịch ôn như trước */
const RATING_REMEMBERED = 3;
const RATING_FORGOT = 1;
const SWIPE_THRESHOLD = 110;
const CARD_CHOICES = [10, 20, 30];
const ACCEPTED_FILES = ".pdf,.doc,.docx,.ppt,.pptx";

/* ================= Tiện ích ================= */

function getFlashcardPoints(content: string): string[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean);
  if (lines.length > 1) return lines.slice(0, 3);
  // Một ý: vẫn bỏ "- " / "•" ở đầu, chấm tròn vàng đã thay cho gạch đầu dòng
  return (lines[0] || "")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function materialName(material: StudyMaterial) {
  return material.original_filename || material.file_name || material.name || material.title || tx("Tài liệu học tập");
}

function chapterOf(topic?: Topic) {
  return String(topic?.hierarchy || "").split(">")[0].trim() || tx("Chủ đề khác");
}

async function getList<T>(url: string, fallback: string): Promise<T[]> {
  const response = await fetch(url, { cache: "no-store" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.detail || fallback);
  return Array.isArray(result?.data) ? result.data : [];
}

function shortDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(currentLocale(), { day: "2-digit", month: "2-digit" });
}

/* ================= Trang ================= */

export default function FlashcardsPage() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [plans, setPlans] = useState<ExamPlan[]>([]);
  const [decks, setDecks] = useState<UploadedDeck[]>([]);
  const [materials, setMaterials] = useState<StudyMaterial[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);

  const [selection, setSelection] = useState<Selection>(null);
  const [selectedMaterialId, setSelectedMaterialId] = useState("");
  const [selectedTopicId, setSelectedTopicId] = useState("");
  const [numberOfCards, setNumberOfCards] = useState(10);

  const [showDueOnly, setShowDueOnly] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [reviewed, setReviewed] = useState<Record<string, number>>({});
  const [retryIds, setRetryIds] = useState<string[] | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [loading, setLoading] = useState(true);
  const [optionsReady, setOptionsReady] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [error, setError] = useState("");
  const [generationMessage, setGenerationMessage] = useState("");
  const [generationError, setGenerationError] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  // 1. Môn học, kế hoạch ôn thi và bộ thẻ tự tải lên
  useEffect(() => {
    Promise.all([
      getList<Subject>(`${API_URL}/api/subjects`, tx("Không thể tải môn học.")).catch(() => []),
      getList<ExamPlan>(`${API_URL}/api/exam-plans`, tx("Không thể tải kế hoạch ôn thi.")).catch(() => []),
      getList<UploadedDeck>(`${API_URL}/api/flashcard-decks`, tx("Không thể tải bộ thẻ.")).catch(() => []),
    ]).then(([subjectList, planList, deckList]) => {
      setSubjects(subjectList);
      setPlans(planList);
      setDecks(deckList);
      if (planList.length > 0) setSelection({ kind: "plan", id: planList[0].id });
      else if (deckList.length > 0) setSelection({ kind: "deck", id: deckList[0].id });
      setOptionsReady(true);
    });
  }, []);

  // 2. Tài liệu và chủ đề của môn đang chọn (chỉ với môn trong kế hoạch)
  const selectedPlanId = selection?.kind === "plan" ? selection.id : "";
  useEffect(() => {
    if (!selectedPlanId) return;
    let cancelled = false;

    Promise.all([
      getList<StudyMaterial>(`${API_URL}/api/study-materials?exam_plan_id=${selectedPlanId}`, tx("Không thể tải danh sách tài liệu.")),
      getList<Topic>(`${API_URL}/api/topics?exam_plan_id=${selectedPlanId}`, tx("Không thể tải danh sách chủ đề.")),
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
        if (!cancelled) setGenerationError(err instanceof Error ? err.message : tx("Không thể tải tài liệu và chủ đề."));
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
      tx("Không thể tải danh sách Flashcard.")
    )
      .then((data) => {
        if (!cancelled) {
          setFlashcards(data);
          setError("");
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : tx("Đã xảy ra lỗi khi tải Flashcard."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showDueOnly, refreshKey]);

  /* Chỉ hiện thẻ của bộ đang chọn */
  const topicById = useMemo(() => new Map(topics.map((topic) => [topic.id, topic])), [topics]);
  const deckCards = useMemo(() => {
    if (!selection) return [];
    if (selection.kind === "deck") return flashcards.filter((card) => card.deck_id === selection.id);
    return flashcards.filter((card) => !card.deck_id && (topics.length ? topicById.has(card.topic_id || "") : true));
  }, [flashcards, selection, topicById, topics.length]);
  const studyList = useMemo(
    () => (retryIds ? deckCards.filter((card) => retryIds.includes(card.id)) : deckCards),
    [deckCards, retryIds]
  );
  const finished = studyList.length > 0 && currentIndex >= studyList.length;
  const currentCard = finished ? undefined : studyList[Math.min(currentIndex, Math.max(0, studyList.length - 1))];
  const currentTopic = currentCard?.topic_id ? topicById.get(currentCard.topic_id) : undefined;

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
    subjects.find((subject) => subject.id === plan.subject_id)?.name || plan.title || tx("Môn học");
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId);
  const selectedDeck = selection?.kind === "deck" ? decks.find((deck) => deck.id === selection.id) : undefined;
  const selectionName = selectedPlan ? subjectName(selectedPlan) : selectedDeck?.name || tx("Bộ thẻ của bạn");

  const rememberedCount = studyList.filter((card) => reviewed[card.id] === RATING_REMEMBERED).length;
  const forgotCount = studyList.filter((card) => reviewed[card.id] === RATING_FORGOT).length;

  function resetStudy() {
    setCurrentIndex(0);
    setReviewError("");
    setRetryIds(null);
    setReviewed({});
  }

  function choose(next: Selection) {
    setSelection(next);
    if (next?.kind === "plan") setOptionsLoading(true);
    setGenerationError("");
    setGenerationMessage("");
    setConfirmDelete(false);
    resetStudy();
  }

  // 4. Tạo Flashcard bằng AI (môn trong kế hoạch)
  async function handleGenerateFlashcards() {
    if (!selectedMaterialId || !selectedTopicId) {
      setGenerationError(tx("Hãy chọn tài liệu và chủ đề."));
      return;
    }
    if (selectedMaterial?.processing_status !== "processed") {
      setGenerationError(tx("Tài liệu chưa được xử lý xong."));
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
      if (!response.ok) throw new Error(result.detail || tx("Không thể tạo Flashcard bằng AI."));
      setGenerationMessage(tx("Đã tạo {0} thẻ mới, xếp vào bộ thẻ bên trái.", [result.created_cards]));
      setShowDueOnly(false);
      resetStudy();
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : tx("Đã xảy ra lỗi khi tạo Flashcard."));
    } finally {
      setGenerating(false);
    }
  }

  // 5. Vuốt thẻ: lưu mức ghi nhớ rồi sang thẻ kế tiếp
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
        if (!response.ok) throw new Error(result.detail || tx("Không thể lưu kết quả ôn tập."));
        setReviewed((current) => ({ ...current, [currentCard.id]: rating }));
        if (showDueOnly) setRefreshKey((value) => value + 1);
        else setCurrentIndex((index) => index + 1);
      } catch (err) {
        setReviewError(err instanceof Error ? err.message : tx("Đã xảy ra lỗi khi lưu kết quả."));
        setAttempt((value) => value + 1); // đưa thẻ bay ra quay về chỗ cũ
      } finally {
        setIsSubmitting(false);
      }
    },
    [isSubmitting, currentCard, showDueOnly]
  );

  // 6. Bộ thẻ tự tải lên: tạo mới, xoá
  function onDeckCreated(deck: UploadedDeck) {
    setDecks((current) => [deck, ...current.filter((item) => item.id !== deck.id)]);
    setUploadOpen(false);
    setShowDueOnly(false);
    choose({ kind: "deck", id: deck.id });
    setRefreshKey((value) => value + 1);
  }

  async function deleteDeck() {
    if (!selectedDeck || deleting) return;
    setDeleting(true);
    setGenerationError("");
    try {
      const response = await fetch(`${API_URL}/api/flashcard-decks/${selectedDeck.id}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.detail || tx("Không xoá được bộ thẻ."));
      const rest = decks.filter((deck) => deck.id !== selectedDeck.id);
      setDecks(rest);
      choose(plans[0] ? { kind: "plan", id: plans[0].id } : rest[0] ? { kind: "deck", id: rest[0].id } : null);
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : tx("Không xoá được bộ thẻ."));
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const deckSizeOf = (deckId: string) =>
    flashcards.filter((card) => card.deck_id === deckId).length || decks.find((deck) => deck.id === deckId)?.card_count || 0;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Đầu trang */}
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--sp-muted)]">{tx("KHÔNG GIAN HỌC TẬP / FLASHCARDS")}</p>
          <h1 className="mt-2 flex items-end gap-3 text-[40px] leading-tight sm:text-[50px]">
            <span>
              {tx("Ôn nhanh bằng")} <span className="sp-squiggle">flashcard</span>
            </span>
            <Sparkle size={24} className="sp-twinkle mb-3 text-[var(--sp-yellow)]" />
          </h1>
          <p className="mt-1 text-[15px] text-[var(--sp-muted)]">
            {tx("Lật thẻ xem đáp án, vuốt phải nếu đã nhớ, vuốt trái nếu chưa nhớ. Thẻ chưa nhớ sẽ quay lại sớm hơn.")}
          </p>
        </div>

        {optionsReady && (
          <DeckPicker
            plans={plans}
            decks={decks}
            selection={selection}
            planName={subjectName}
            deckSize={deckSizeOf}
            onSelect={choose}
            onUpload={() => setUploadOpen(true)}
          />
        )}
      </section>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ---------- Khu ôn tập ---------- */}
        <section className="sp-card overflow-hidden p-5 sm:p-7">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="sp-accent truncate text-[17px] text-[var(--sp-pink)]">{selectionName}</p>
              <h2 className="text-[22px] text-[var(--sp-ink)]">{tx("Bộ thẻ ôn tập")}</h2>
            </div>
            <div className="flex rounded-xl bg-[var(--sp-surface-2)] p-1" role="tablist">
              {(
                [
                  [false, tx("Tất cả thẻ")],
                  [true, tx("Cần ôn hôm nay")],
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

          {loading || !optionsReady ? (
            <LoadingMascot bare className="mt-6" text={tx("Đang tải bộ thẻ…")} sub={tx("Pilot đang xếp thẻ đến hạn ôn lên trước.")} />
          ) : error ? (
            <div className="mt-6 rounded-[24px] bg-[var(--sp-pink-bg)] px-6 py-10 text-center">
              <p className="font-semibold text-[var(--sp-pink-dark)]">{error}</p>
              <p className="mt-1 text-sm text-[var(--sp-text-2)]">{tx("Hãy kiểm tra backend có đang chạy không.")}</p>
            </div>
          ) : finished ? (
            <FinishedPanel
              remembered={rememberedCount}
              forgot={forgotCount}
              onRetryForgot={() => {
                setRetryIds(studyList.filter((card) => reviewed[card.id] === RATING_FORGOT).map((card) => card.id));
                setCurrentIndex(0);
                setReviewed({});
              }}
              onRestart={resetStudy}
            />
          ) : !currentCard ? (
            <div className="mt-6 flex flex-col items-center rounded-[24px] border-2 border-dashed border-[var(--sp-lav-line)] px-6 py-14 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]">
                {showDueOnly ? <IconCheck size={26} /> : <IconLayers size={26} />}
              </span>
              <h3 className="mt-4 text-[18px] font-bold text-[var(--sp-ink)]">
                {showDueOnly
                  ? tx("Bạn đã ôn hết thẻ của hôm nay")
                  : selection
                    ? tx("Bộ này chưa có flashcard")
                    : tx("Bạn chưa có bộ thẻ nào")}
              </h3>
              <p className="mt-1 max-w-sm text-sm text-[var(--sp-muted)]">
                {showDueOnly
                  ? tx("Thẻ sẽ quay lại vào ngày cần ôn tiếp theo.")
                  : selection?.kind === "plan"
                    ? tx("Chọn một bài ở khung “Tạo thẻ bằng AI” để AI soạn thẻ hỏi đáp từ tài liệu của bạn.")
                    : tx("Tải một tài liệu lên, AI sẽ soạn thẻ hỏi đáp cho bạn. Không cần tạo kế hoạch ôn thi.")}
              </p>
              {!showDueOnly && selection?.kind !== "plan" && (
                <button type="button" onClick={() => setUploadOpen(true)} className="sp-btn sp-btn-primary mt-4 px-5 py-2.5 text-sm">
                  <IconPlus size={16} />
                  {tx("Tải tài liệu để tạo thẻ")}
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Tiến độ */}
              <div className="mt-6 flex items-center gap-4">
                <span className="text-[15px] font-extrabold text-[var(--sp-ink)]">
                  {tx("Thẻ")} {Math.min(currentIndex + 1, studyList.length)}
                  <span className="font-bold text-[var(--sp-muted)]"> / {studyList.length}</span>
                </span>
                <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-[var(--sp-surface-2)]">
                  <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${(rememberedCount / studyList.length) * 100}%` }} />
                  <div className="h-full bg-[var(--sp-pink)] transition-all duration-300" style={{ width: `${(forgotCount / studyList.length) * 100}%` }} />
                </div>
                <span className="text-[13px] font-semibold text-[var(--sp-muted)]">
                  {tx("{0} nhớ · {1} chưa", [rememberedCount, forgotCount])}
                </span>
              </div>

              <SwipeCard
                key={`${currentCard.id}-${attempt}`}
                card={currentCard}
                nextCard={studyList[currentIndex + 1]}
                topicTitle={currentTopic ? getMainTopicTitle(currentTopic.name) : selectedDeck?.name}
                nextTopicTitle={(() => {
                  const next = studyList[currentIndex + 1];
                  const topic = next?.topic_id ? topicById.get(next.topic_id) : undefined;
                  return topic ? getMainTopicTitle(topic.name) : selectedDeck?.name;
                })()}
                disabled={isSubmitting}
                onSwipe={(remembered) => void handleReview(remembered ? RATING_REMEMBERED : RATING_FORGOT)}
              />

              {reviewError && <p className="mt-3 text-center text-sm font-medium text-[var(--sp-pink-dark)]">{reviewError}</p>}
              {retryIds && (
                <p className="mt-3 text-center text-[13px] font-semibold text-[var(--sp-pink-dark)]">
                  {tx("Đang ôn lại các thẻ chưa nhớ")}
                </p>
              )}
            </>
          )}
        </section>

        {/* ---------- Cột phải ---------- */}
        <aside className="space-y-5 lg:sticky lg:top-6">
          {/* Số liệu */}
          <div className="grid grid-cols-3 gap-2.5">
            {[
              { label: tx("Thẻ trong bộ"), value: deckCards.length, tone: "text-[var(--sp-ink)]" },
              { label: tx("Đã nhớ"), value: rememberedCount, tone: "text-emerald-700" },
              { label: tx("Chưa nhớ"), value: forgotCount, tone: "text-[var(--sp-pink-dark)]" },
            ].map((stat) => (
              <div key={stat.label} className="sp-card px-3 py-3 text-center">
                <p className={`text-[24px] font-black leading-none ${stat.tone}`}>{stat.value}</p>
                <p className="mt-1 text-[12px] font-semibold text-[var(--sp-muted)]">{stat.label}</p>
              </div>
            ))}
          </div>

          {selection?.kind === "deck" && selectedDeck ? (
            /* Bộ thẻ tự tải lên */
            <section className="sp-card p-5">
              <p className="sp-accent text-[16px] text-[var(--sp-pink)]">{tx("Tài liệu tự tải lên")}</p>
              <h2 className="truncate text-[20px] text-[var(--sp-ink)]">{selectedDeck.name}</h2>
              <p className="mt-3 flex items-center gap-2 rounded-xl bg-[var(--sp-surface-2)] px-3 py-2 text-[13px] text-[var(--sp-text-2)]">
                <IconFile size={15} className="shrink-0 text-[var(--sp-peri-dark)]" />
                <span className="truncate">{selectedDeck.file_name || selectedDeck.name}</span>
              </p>
              <p className="mt-2 text-[13px] text-[var(--sp-muted)]">
                {tx("{0} thẻ · tạo ngày {1}", [deckSizeOf(selectedDeck.id), shortDate(selectedDeck.created_at)])}
              </p>

              <button type="button" onClick={() => setUploadOpen(true)} className="sp-btn sp-btn-primary mt-4 w-full justify-center py-2.5 text-sm">
                <IconPlus size={16} />
                {tx("Tải tài liệu khác để tạo thẻ")}
              </button>

              {confirmDelete ? (
                <div className="mt-3 rounded-xl border-2 border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)] p-3">
                  <p className="text-[13px] font-semibold text-[var(--sp-pink-dark)]">
                    {tx("Xoá bộ thẻ này cùng toàn bộ lịch ôn của nó?")}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => setConfirmDelete(false)} className="sp-btn sp-btn-secondary flex-1 justify-center py-2 text-sm">
                      {tx("Huỷ")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteDeck()}
                      disabled={deleting}
                      className="sp-btn flex-1 justify-center bg-[var(--sp-pink-dark)] py-2 text-sm text-white disabled:opacity-60"
                    >
                      {deleting ? tx("Đang xoá...") : tx("Xoá bộ thẻ")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2 text-[13px] font-bold text-[var(--sp-pink-dark)] hover:bg-[var(--sp-pink-bg)]"
                >
                  <IconTrash size={15} />
                  {tx("Xoá bộ thẻ")}
                </button>
              )}
              {generationError && (
                <p className="mt-3 rounded-xl bg-[var(--sp-pink-bg)] px-3 py-2 text-sm text-[var(--sp-pink-dark)]">{generationError}</p>
              )}
            </section>
          ) : (
            /* Tạo thẻ bằng AI cho môn trong kế hoạch */
            <section className="sp-card p-5">
              <p className="sp-accent text-[16px] text-[var(--sp-pink)]">{tx("Soạn từ tài liệu của bạn")}</p>
              <h2 className="flex items-center gap-2 text-[20px] text-[var(--sp-ink)]">
                {tx("Tạo thẻ bằng AI")}
                <Sparkle size={15} className="text-[var(--sp-yellow)]" />
              </h2>

              {plans.length === 0 ? (
                <div className="mt-4 space-y-3 rounded-2xl bg-[var(--sp-surface-2)] p-4 text-sm text-[var(--sp-text-2)]">
                  <p>{tx("Chưa có kế hoạch ôn thi? Bạn vẫn tạo được thẻ từ bất kỳ tài liệu nào.")}</p>
                  <button type="button" onClick={() => setUploadOpen(true)} className="sp-btn sp-btn-primary w-full justify-center py-2 text-sm">
                    <IconPlus size={16} />
                    {tx("Tải tài liệu để tạo thẻ")}
                  </button>
                  <Link href="/study-plans" className="sp-btn sp-btn-secondary w-full justify-center py-2 text-sm">
                    {tx("Tạo kế hoạch ôn thi")}
                  </Link>
                </div>
              ) : (
                <div className="mt-4 space-y-4">
                  {textbookMaterials.length > 1 ? (
                    <div>
                      <label htmlFor="fc-material" className="mb-1.5 block text-sm font-bold text-[var(--sp-ink)]">
                        {tx("Tài liệu")}
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
                      {tx("Bài học")}
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
                      {availableTopics.length === 0 && <option value="">{tx("Chưa có bài học")}</option>}
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
                    <p className="mb-1.5 text-sm font-bold text-[var(--sp-ink)]">{tx("Số thẻ")}</p>
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

                  {optionsLoading && <p className="text-sm text-[var(--sp-muted)]">{tx("Đang tải tài liệu và bài học...")}</p>}
                  {selectedMaterial && selectedMaterial.processing_status !== "processed" && (
                    <p className="rounded-xl bg-[var(--sp-amber-bg)] px-3 py-2 text-sm text-[var(--sp-amber-dark)]">
                      {tx("Tài liệu chưa xử lý xong, vui lòng chờ thêm.")}
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
                    {generating ? tx("AI đang soạn thẻ...") : tx("Tạo {0} thẻ với AI", [numberOfCards])}
                  </button>
                </div>
              )}
            </section>
          )}
        </aside>
      </div>

      {uploadOpen && <UploadDeckDialog onClose={() => setUploadOpen(false)} onCreated={onDeckCreated} />}
    </div>
  );
}

/* ================= Chọn bộ thẻ ================= */

function DeckPicker({
  plans,
  decks,
  selection,
  planName,
  deckSize,
  onSelect,
  onUpload,
}: {
  plans: ExamPlan[];
  decks: UploadedDeck[];
  selection: Selection;
  planName: (plan: ExamPlan) => string;
  deckSize: (deckId: string) => number;
  onSelect: (selection: Selection) => void;
  onUpload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const plan = selection?.kind === "plan" ? plans.find((item) => item.id === selection.id) : undefined;
  const deck = selection?.kind === "deck" ? decks.find((item) => item.id === selection.id) : undefined;
  const label = plan ? planName(plan) : deck?.name || tx("Chọn bộ thẻ");

  const item = (active: boolean) =>
    `flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14.5px] font-semibold transition ${
      active ? "bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]" : "text-[var(--sp-ink)] hover:bg-[var(--sp-surface-2)]"
    }`;

  return (
    <div ref={boxRef} className="relative w-full sm:w-auto">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-14 w-full items-center gap-3 rounded-2xl border-2 border-[var(--sp-purple-deep)] bg-white px-3 text-left shadow-[3px_3px_0_var(--sp-pink-line)] transition hover:-translate-y-px sm:min-w-[300px]"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--sp-lav)] text-[var(--sp-purple)]">
          {deck ? <IconFile size={18} /> : <IconBook size={18} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11.5px] font-semibold text-[var(--sp-muted)]">{tx("Bộ thẻ đang ôn")}</span>
          <span className="block truncate text-[15.5px] font-bold text-[var(--sp-ink)]">{label}</span>
        </span>
        <IconChevronDown size={18} className={`shrink-0 text-[var(--sp-ink)] transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="listbox"
          className="sp-fade-in absolute right-0 z-30 mt-2 max-h-[420px] w-full overflow-y-auto rounded-2xl border-2 border-[var(--sp-purple-deep)] bg-white p-2 shadow-[4px_4px_0_var(--sp-pink-line)] sm:w-[360px]"
        >
          {plans.length > 0 && (
            <>
              <p className="px-3 pb-1 pt-2 text-[11.5px] font-bold uppercase tracking-wide text-[var(--sp-muted)]">
                {tx("Môn học trong kế hoạch")}
              </p>
              {plans.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="option"
                  aria-selected={plan?.id === entry.id}
                  onClick={() => {
                    onSelect({ kind: "plan", id: entry.id });
                    setOpen(false);
                  }}
                  className={item(plan?.id === entry.id)}
                >
                  <IconBook size={17} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{planName(entry)}</span>
                </button>
              ))}
            </>
          )}

          {decks.length > 0 && (
            <>
              <p className="px-3 pb-1 pt-3 text-[11.5px] font-bold uppercase tracking-wide text-[var(--sp-muted)]">
                {tx("Tài liệu tự tải lên")}
              </p>
              {decks.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="option"
                  aria-selected={deck?.id === entry.id}
                  onClick={() => {
                    onSelect({ kind: "deck", id: entry.id });
                    setOpen(false);
                  }}
                  className={item(deck?.id === entry.id)}
                >
                  <IconFile size={17} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                  <span className="shrink-0 rounded-full bg-[var(--sp-lav)] px-2 py-0.5 text-[11px] font-bold text-[var(--sp-purple)]">
                    {tx("{0} thẻ", [deckSize(entry.id)])}
                  </span>
                </button>
              ))}
            </>
          )}

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onUpload();
            }}
            className="mt-2 flex w-full items-center gap-3 rounded-xl border-2 border-dashed border-[var(--sp-lav-line)] px-3 py-2.5 text-left text-[14.5px] font-bold text-[var(--sp-purple)] transition hover:border-[var(--sp-peri)] hover:bg-[var(--sp-lav)]"
          >
            <IconPlus size={17} className="shrink-0" />
            {tx("Tải tài liệu khác để tạo thẻ")}
          </button>
        </div>
      )}
    </div>
  );
}

/* ================= Thẻ vuốt ================= */

function SwipeCard({
  card,
  nextCard,
  topicTitle,
  nextTopicTitle,
  disabled,
  onSwipe,
}: {
  card: Flashcard;
  nextCard?: Flashcard;
  topicTitle?: string;
  nextTopicTitle?: string;
  disabled: boolean;
  onSwipe: (remembered: boolean) => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [flyout, setFlyout] = useState<0 | 1 | -1>(0);
  const start = useRef<{ x: number; id: number; moved: boolean } | null>(null);

  const release = useCallback(
    (direction: 1 | -1) => {
      if (disabled || flyout) return;
      setFlyout(direction);
      window.setTimeout(() => onSwipe(direction === 1), 260);
    },
    [disabled, flyout, onSwipe]
  );

  // Phím tắt: Space lật thẻ, ← chưa nhớ, → đã nhớ
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (event.code === "Space") {
        event.preventDefault();
        setFlipped((value) => !value);
      } else if (event.key === "ArrowRight") release(1);
      else if (event.key === "ArrowLeft") release(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [release]);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || flyout) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { x: event.clientX, id: event.pointerId, moved: false };
    setDragging(true);
  }
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = start.current;
    if (!current || current.id !== event.pointerId) return;
    const delta = event.clientX - current.x;
    if (Math.abs(delta) > 6) current.moved = true;
    setDx(delta);
  }
  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const current = start.current;
    if (!current || current.id !== event.pointerId) return;
    start.current = null;
    setDragging(false);
    if (dx > SWIPE_THRESHOLD) release(1);
    else if (dx < -SWIPE_THRESHOLD) release(-1);
    else {
      setDx(0);
      if (!current.moved) setFlipped((value) => !value);
    }
  }

  const offset = flyout ? flyout * 760 : dx;
  const rightStrength = Math.max(0, Math.min(1, (flyout === 1 ? 1 : dx) / SWIPE_THRESHOLD));
  const leftStrength = Math.max(0, Math.min(1, (flyout === -1 ? -1 : dx) / -SWIPE_THRESHOLD));
  // Thẻ kế tiếp nằm sẵn bên dưới, kéo thẻ trên càng xa thì thẻ dưới càng nổi lên
  const reveal = flyout ? 1 : Math.min(1, Math.abs(dx) / SWIPE_THRESHOLD);

  return (
    <>
      <div className="relative mt-5 [perspective:1600px]">
        {nextCard ? (
          <div
            aria-hidden="true"
            className={`absolute inset-0 flex min-w-0 flex-col rounded-[28px] border-2 border-[var(--sp-purple-deep)] bg-white p-6 shadow-[6px_6px_0_var(--sp-peri)] sm:p-8 ${
              dragging ? "" : "transition-[transform,opacity] duration-300 ease-out"
            }`}
            style={{ transform: `translateY(${14 - reveal * 14}px) scale(${0.95 + reveal * 0.05})`, opacity: 0.55 + reveal * 0.45 }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="sp-chip bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]">{tx("Câu hỏi")}</span>
              {nextTopicTitle && <span className="max-w-[60%] truncate text-[13px] font-semibold text-[var(--sp-muted)]">{nextTopicTitle}</span>}
            </div>
            <p className="flex flex-1 items-center justify-center py-6 text-center text-[22px] font-bold leading-snug text-[var(--sp-ink)] sm:text-[26px]">
              {nextCard.front}
            </p>
          </div>
        ) : (
          <span aria-hidden="true" className="absolute inset-x-4 -bottom-2 h-full rounded-[28px] border-2 border-[var(--sp-line)] bg-white" />
        )}

        <div
          role="button"
          tabIndex={0}
          aria-label={flipped ? tx("Lật lại mặt câu hỏi") : tx("Lật thẻ xem đáp án")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={(event) => {
            if (event.key === "Enter") setFlipped((value) => !value);
          }}
          className={`relative z-10 cursor-grab touch-pan-y select-none outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-[var(--sp-peri)] focus-visible:ring-offset-4 ${
            dragging ? "" : "transition-[transform,opacity] duration-300 ease-out"
          }`}
          style={{ transform: `translateX(${offset}px) rotate(${offset / 18}deg)`, opacity: flyout ? 0 : 1 }}
        >
          <div
            className={`grid min-h-[340px] w-full grid-cols-[minmax(0,1fr)] transition-transform duration-500 [transform-style:preserve-3d] motion-reduce:transition-none ${
              flipped ? "[transform:rotateY(180deg)]" : ""
            }`}
          >
            {/* Mặt trước */}
            <div className="col-start-1 row-start-1 flex min-w-0 flex-col rounded-[28px] border-2 border-[var(--sp-purple-deep)] bg-white p-6 shadow-[6px_6px_0_var(--sp-peri)] [backface-visibility:hidden] sm:p-8">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="sp-chip bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]">{tx("Câu hỏi")}</span>
                {topicTitle && <span className="max-w-[60%] truncate text-[13px] font-semibold text-[var(--sp-muted)]">{topicTitle}</span>}
              </div>
              <p className="flex flex-1 items-center justify-center py-6 text-center text-[22px] font-bold leading-snug text-[var(--sp-ink)] sm:text-[26px]">
                {card.front}
              </p>
              <p className="flex items-center justify-center gap-2 text-[13px] text-[var(--sp-muted)]">
                <IconRepeat size={14} />
                {tx("Chạm vào thẻ hoặc nhấn Space để lật")}
              </p>
            </div>

            {/* Mặt sau */}
            <div className="col-start-1 row-start-1 flex min-w-0 flex-col rounded-[28px] border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-purple)] p-6 text-white shadow-[6px_6px_0_var(--sp-pink)] [backface-visibility:hidden] [transform:rotateY(180deg)] sm:p-8">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="sp-chip bg-[var(--sp-yellow)] text-[var(--sp-purple-deep)]">{tx("Đáp án")}</span>
                <span className="max-w-[60%] truncate text-[13px] font-semibold text-white/70">{card.front}</span>
              </div>
              <div className="flex flex-1 items-center py-6">
                <div className="mx-auto w-full max-w-2xl space-y-3">
                  {getFlashcardPoints(card.back).map((point, index) => (
                    <p key={index} className="flex items-start gap-3 text-[18px] font-semibold leading-8 sm:text-[20px]">
                      <span aria-hidden="true" className="mt-3 h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--sp-yellow)]" />
                      <span>{point}</span>
                    </p>
                  ))}
                </div>
              </div>
              <p className="text-center text-[13px] text-white/70">
                {tx("Vuốt phải nếu đã nhớ · vuốt trái nếu chưa nhớ")}
              </p>
            </div>
          </div>

          {/* Con dấu hiện khi kéo */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-6 top-6 -rotate-[10deg] rounded-xl border-[3px] border-emerald-600 bg-emerald-50 px-3 py-1 text-[17px] font-black uppercase tracking-wide text-emerald-700"
            style={{ opacity: rightStrength }}
          >
            {tx("Đã nhớ")}
          </span>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-6 top-6 rotate-[10deg] rounded-xl border-[3px] border-[var(--sp-pink-dark)] bg-[var(--sp-pink-bg)] px-3 py-1 text-[17px] font-black uppercase tracking-wide text-[var(--sp-pink-dark)]"
            style={{ opacity: leftStrength }}
          >
            {tx("Chưa nhớ")}
          </span>
        </div>
      </div>

      {/* Nút cho máy tính */}
      <div className="mt-8 flex items-center justify-center gap-5">
        <button
          type="button"
          onClick={() => release(-1)}
          disabled={disabled}
          aria-label={tx("Chưa nhớ (vuốt trái)")}
          title={tx("Chưa nhớ (phím ←)")}
          className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)] shadow-[3px_3px_0_var(--sp-purple-deep)] transition hover:-translate-y-0.5 active:translate-y-0 active:shadow-none disabled:opacity-50"
        >
          <IconX size={28} />
        </button>
        <button
          type="button"
          onClick={() => setFlipped((value) => !value)}
          aria-label={flipped ? tx("Xem câu hỏi") : tx("Lật thẻ")}
          title={tx("Lật thẻ (Space)")}
          className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-[var(--sp-purple-deep)] bg-white text-[var(--sp-purple)] transition hover:-translate-y-0.5"
        >
          <IconRepeat size={20} />
        </button>
        <button
          type="button"
          onClick={() => release(1)}
          disabled={disabled}
          aria-label={tx("Đã nhớ (vuốt phải)")}
          title={tx("Đã nhớ (phím →)")}
          className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-[var(--sp-purple-deep)] bg-emerald-50 text-emerald-700 shadow-[3px_3px_0_var(--sp-purple-deep)] transition hover:-translate-y-0.5 active:translate-y-0 active:shadow-none disabled:opacity-50"
        >
          <IconCheck size={28} />
        </button>
      </div>
      <div className="mx-auto mt-4 grid max-w-xl grid-cols-3 text-[12.5px] font-semibold text-[var(--sp-muted)]">
        <span className="text-left text-[var(--sp-pink-dark)]">{tx("← Vuốt trái: chưa nhớ")}</span>
        <span className="text-center">{tx("Chạm để lật")}</span>
        <span className="text-right text-emerald-700">{tx("Vuốt phải: đã nhớ →")}</span>
      </div>
    </>
  );
}

/* ================= Hết bộ thẻ ================= */

function FinishedPanel({
  remembered,
  forgot,
  onRetryForgot,
  onRestart,
}: {
  remembered: number;
  forgot: number;
  onRetryForgot: () => void;
  onRestart: () => void;
}) {
  return (
    <div className="sp-fade-in mt-6 flex flex-col items-center rounded-[24px] border-2 border-dashed border-[var(--sp-lav-line)] px-6 py-12 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
        <IconCheck size={28} />
      </span>
      <h3 className="mt-4 text-[20px] font-bold text-[var(--sp-ink)]">{tx("Xong bộ thẻ rồi!")}</h3>
      <p className="mt-1 text-sm text-[var(--sp-muted)]">
        {tx("{0} thẻ đã nhớ · {1} thẻ chưa nhớ sẽ quay lại sớm", [remembered, forgot])}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        {forgot > 0 && (
          <button type="button" onClick={onRetryForgot} className="sp-btn sp-btn-primary px-5 py-2.5 text-sm">
            <IconRepeat size={16} />
            {tx("Ôn lại {0} thẻ chưa nhớ", [forgot])}
          </button>
        )}
        <button type="button" onClick={onRestart} className="sp-btn sp-btn-secondary px-5 py-2.5 text-sm">
          {tx("Ôn lại từ đầu")}
        </button>
      </div>
    </div>
  );
}

/* ================= Tải tài liệu để tạo bộ thẻ ================= */

function UploadDeckDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (deck: UploadedDeck) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [count, setCount] = useState(20);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [busy, onClose]);

  function pick(next: File | undefined) {
    if (!next) return;
    const extension = next.name.slice(next.name.lastIndexOf(".")).toLowerCase();
    if (!ACCEPTED_FILES.split(",").includes(extension)) {
      setError(tx("Chỉ chấp nhận file PDF, DOC, DOCX, PPT và PPTX."));
      return;
    }
    if (next.size > 50 * 1024 * 1024) {
      setError(tx("Tài liệu vượt quá giới hạn 50 MB."));
      return;
    }
    setError("");
    setFile(next);
    if (!name.trim()) setName(next.name.replace(/\.[^.]+$/, ""));
  }

  function onDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragOver(false);
    pick(event.dataTransfer.files?.[0]);
  }

  async function submit() {
    if (!file) {
      setError(tx("Chọn một tài liệu trước nhé."));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("name", name.trim());
      form.append("number_of_cards", String(count));
      const response = await fetch(`${API_URL}/api/flashcard-decks`, { method: "POST", body: form });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.detail || tx("Chưa tạo được bộ thẻ."));
      onCreated(result.data as UploadedDeck);
    } catch (err) {
      setError(err instanceof Error ? err.message : tx("Chưa tạo được bộ thẻ."));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(36,18,58,0.45)] p-4 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="deck-upload-title"
        className="sp-fade-in w-full max-w-[480px] rounded-[28px] border-2 border-[var(--sp-purple-deep)] bg-white p-6 shadow-[6px_6px_0_var(--sp-pink-line)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="deck-upload-title" className="text-[22px] font-extrabold text-[var(--sp-purple)]">
              {tx("Tạo thẻ từ tài liệu mới")}
            </h2>
            <p className="mt-1 text-[13.5px] text-[var(--sp-muted)]">
              {tx("Không cần tạo kế hoạch ôn thi. AI đọc tài liệu và soạn thẻ hỏi đáp cho bạn.")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={tx("Đóng")}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-[var(--sp-line)] text-[var(--sp-muted)] hover:text-[var(--sp-ink)] disabled:opacity-50"
          >
            <IconX size={18} />
          </button>
        </div>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          disabled={busy}
          className={`mt-5 flex w-full flex-col items-center rounded-2xl border-2 border-dashed px-4 py-6 text-center transition ${
            dragOver ? "border-[var(--sp-peri)] bg-[var(--sp-lav)]" : "border-[var(--sp-lav-line)] bg-[#faf6fd] hover:border-[var(--sp-peri)]"
          }`}
        >
          <IconFile size={26} className="text-[var(--sp-purple)]" />
          <span className="mt-2 text-[15px] font-bold text-[var(--sp-purple)]">
            {file ? file.name : tx("Kéo thả hoặc bấm để chọn tài liệu")}
          </span>
          <span className="mt-1 text-[12.5px] text-[var(--sp-muted)]">
            {file ? tx("Bấm để đổi file khác") : tx("PDF, DOCX, PPTX · tối đa 50 MB")}
          </span>
        </button>
        <input ref={inputRef} type="file" accept={ACCEPTED_FILES} className="hidden" onChange={(event) => pick(event.target.files?.[0])} />

        <label htmlFor="deck-name" className="mt-5 block text-sm font-bold text-[var(--sp-ink)]">
          {tx("Tên bộ thẻ")}
        </label>
        <input
          id="deck-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={120}
          placeholder={tx("Ví dụ: Quản trị rủi ro")}
          className="mt-1.5 h-11 w-full rounded-xl border-2 border-[var(--sp-line)] bg-white px-3 text-[15px] text-[var(--sp-ink)] outline-none focus:border-[var(--sp-peri)]"
        />

        <p className="mt-5 text-sm font-bold text-[var(--sp-ink)]">{tx("Số thẻ")}</p>
        <div className="mt-1.5 grid grid-cols-3 gap-2">
          {CARD_CHOICES.map((number) => (
            <button
              key={number}
              type="button"
              aria-pressed={count === number}
              onClick={() => setCount(number)}
              className={`rounded-xl border-2 py-2 text-sm font-bold transition ${
                count === number
                  ? "border-[var(--sp-purple)] bg-[var(--sp-purple)] text-white shadow-[2px_2px_0_var(--sp-pink)]"
                  : "border-[var(--sp-line)] bg-white text-[var(--sp-muted)] hover:border-[var(--sp-lav-line)]"
              }`}
            >
              {number}
            </button>
          ))}
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-[var(--sp-pink-bg)] px-3 py-2 text-sm font-semibold text-[var(--sp-pink-dark)]">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="sp-btn sp-btn-primary mt-5 w-full justify-center py-3 text-[15px] disabled:cursor-wait disabled:opacity-70"
        >
          <Sparkle size={15} className={busy ? "sp-twinkle" : ""} />
          {busy ? tx("AI đang đọc tài liệu và soạn thẻ...") : tx("Tạo bộ thẻ với AI")}
        </button>
        {busy && (
          <p className="mt-2 text-center text-[12.5px] text-[var(--sp-muted)]">
            {tx("Thường mất khoảng 20–60 giây, tuỳ độ dài tài liệu.")}
          </p>
        )}
      </div>
    </div>
  );
}

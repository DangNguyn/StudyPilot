"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  IconAlert,
  IconBook,
  IconBulb,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconFile,
  IconTarget,
  IconX,
  Sparkle,
} from "@/components/icons";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

export type ReviewOption = { key: string; text: string };

export type ReviewQuestion = {
  question_id: string;
  question_text: string;
  question_type?: string | null;
  options?: ReviewOption[];
  selected_answer: string | string[] | null;
  correct_answer: string | string[];
  is_correct: boolean;
  explanation: string | null;
  source_location?: {
    page_number: number | null;
    material_id: string | null;
    file_name?: string | null;
  } | null;
};

export type Mistake = { question_number: number; question_id?: string; text: string };
export type WeakHint = { question_numbers?: number[]; description?: string; topic_name?: string };

type Group = { key: string; label: string; numbers: number[] };

/* ---------- Tiện ích ---------- */

function keysOf(value: string | string[] | null | undefined) {
  if (value === null || value === undefined || value === "") return [];
  return (Array.isArray(value) ? value : [value]).map((item) => String(item).trim().toUpperCase());
}

function shortExplanation(text?: string | null) {
  const clean = String(text || "")
    .replace(/["“][^"”]{60,}["”]/g, "")
    .replace(/\(?(?:trích|nguồn|theo tài liệu)[^)]*\)?:?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  const short = sentences.slice(0, 2).join(" ");
  return short.length > 300 ? `${short.slice(0, 297).trimEnd()}…` : short;
}

function chapterShort(chapter?: string | null) {
  const match = (chapter || "").match(/^\s*(?:chương|chapter|unit|phần|part)\s*([0-9]+|[IVXLC]+)/i);
  return match ? `Chương ${match[1]}` : chapter || "";
}

/* Nhóm câu theo trang tài liệu (tối đa 4 nhóm, gộp các trang gần nhau) */
function buildGroups(results: ReviewQuestion[]): Group[] {
  const byPage = new Map<number, number[]>();
  const noPage: number[] = [];
  results.forEach((item, index) => {
    const page = item.source_location?.page_number;
    if (page) byPage.set(page, [...(byPage.get(page) || []), index + 1]);
    else noPage.push(index + 1);
  });
  const pages = Array.from(byPage.keys()).sort((a, b) => a - b);
  const groups: Group[] = [];
  const size = Math.max(1, Math.ceil(pages.length / 4));
  for (let start = 0; start < pages.length; start += size) {
    const slice = pages.slice(start, start + size);
    const label = slice.length === 1 ? `Trang ${slice[0]}` : `Trang ${slice[0]}–${slice[slice.length - 1]}`;
    groups.push({
      key: label,
      label,
      numbers: slice.flatMap((page) => byPage.get(page) || []).sort((a, b) => a - b),
    });
  }
  if (noPage.length) groups.push({ key: "other", label: groups.length ? "Phần khác" : "Toàn bài", numbers: noPage });
  return groups;
}

function barTone(ratio: number) {
  if (ratio >= 0.8) return "bg-emerald-500";
  if (ratio >= 0.5) return "bg-[#E6A23C]";
  return "bg-[var(--sp-pink)]";
}

/* ---------- Thẻ điểm + danh sách câu sai ---------- */

export function ScoreSummaryCard({
  results,
  correct,
  total,
  percent,
  levelLabel,
  levelChip,
}: {
  results: ReviewQuestion[];
  correct: number;
  total: number;
  percent: number;
  levelLabel: string;
  levelChip: string;
}) {
  const groups = buildGroups(results);
  const wrongCount = results.filter((item) => !item.is_correct).length;
  const tone = percent >= 80 ? "text-emerald-700" : percent >= 50 ? "text-[var(--sp-amber-dark)]" : "text-[var(--sp-pink-dark)]";

  return (
    <section className="sp-card p-5 sm:p-6">
      <div className="flex items-end gap-4">
        <p className="flex items-baseline leading-none">
          <span className="text-[56px] font-black text-[var(--sp-purple)]">{correct}</span>
          <span className="text-[26px] font-black text-[var(--sp-muted)]">/{total}</span>
        </p>
        <div className="min-w-0 pb-1">
          <p className={`flex flex-wrap items-center gap-2 text-[22px] font-extrabold ${tone}`}>
            Đúng {percent}%
            <span className={`sp-chip text-[12px] ${levelChip}`}>{levelLabel}</span>
          </p>
          <p className="text-[14px] text-[var(--sp-muted)]">
            {wrongCount ? `${wrongCount} câu sai, đã có giải thích` : "Không có câu sai nào"}
          </p>
        </div>
      </div>

      {groups.length > 1 && (
        <ul className="mt-5 space-y-3">
          {groups.map((group) => {
            const right = group.numbers.filter((number) => results[number - 1]?.is_correct).length;
            const ratio = group.numbers.length ? right / group.numbers.length : 0;
            return (
              <li key={group.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_44px] items-center gap-3">
                <span className="truncate text-[14px] font-semibold text-[var(--sp-ink)]">{group.label}</span>
                <span className="h-2 overflow-hidden rounded-full bg-[var(--sp-surface-2)]">
                  <span className={`block h-full rounded-full ${barTone(ratio)}`} style={{ width: `${Math.max(4, ratio * 100)}%` }} />
                </span>
                <span className="text-right text-[14px] font-extrabold text-[var(--sp-ink)]">
                  {right}/{group.numbers.length}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ---------- Toàn bộ khu xem lại câu sai ---------- */

export default function WrongAnswerReview({
  results,
  correct,
  total,
  percent,
  levelLabel,
  levelChip,
  chapter,
  weakNumbers,
  mistakes,
  weakHints,
  materialsHref,
}: {
  results: ReviewQuestion[];
  correct: number;
  total: number;
  percent: number;
  levelLabel: string;
  levelChip: string;
  chapter?: string | null;
  weakNumbers: Set<number>;
  mistakes: Mistake[];
  weakHints: WeakHint[];
  materialsHref: string;
}) {
  const groups = useMemo(() => buildGroups(results), [results]);
  const wrongNumbers = useMemo(
    () => results.map((item, index) => (item.is_correct ? 0 : index + 1)).filter(Boolean),
    [results]
  );
  const [groupFilter, setGroupFilter] = useState("all");
  const [selected, setSelected] = useState<number | null>(wrongNumbers[0] ?? null);
  const [openingSource, setOpeningSource] = useState(false);
  const [sourceError, setSourceError] = useState("");

  const groupOf = (number: number) => groups.find((group) => group.numbers.includes(number));
  const wrongGroups = groups
    .map((group) => ({ ...group, wrong: group.numbers.filter((number) => wrongNumbers.includes(number)) }))
    .filter((group) => group.wrong.length > 0);
  const visible =
    groupFilter === "all" ? wrongNumbers : wrongGroups.find((group) => group.key === groupFilter)?.wrong || [];

  const position = selected ? wrongNumbers.indexOf(selected) : -1;
  const question = selected ? results[selected - 1] : null;
  const chapterLabel = chapterShort(chapter);

  async function openSource(materialId: string, page?: number | null) {
    setOpeningSource(true);
    setSourceError("");
    // Mở cửa sổ ngay khi bấm để trình duyệt không chặn popup
    const popup = window.open("", "_blank");
    try {
      const response = await fetch(`${API_URL}/api/study-materials/${materialId}/download-url`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.signed_url) throw new Error(data?.detail || "Không mở được tài liệu gốc.");
      const url = `${data.signed_url}${page ? `#page=${page}` : ""}`;
      if (popup) popup.location.href = url;
      else window.open(url, "_blank");
    } catch (error) {
      popup?.close();
      setSourceError(error instanceof Error ? error.message : "Không mở được tài liệu gốc.");
    } finally {
      setOpeningSource(false);
    }
  }

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]">
      {/* ---------- Cột trái ---------- */}
      <div className="min-w-0 space-y-5">
        <ScoreSummaryCard
          results={results}
          correct={correct}
          total={total}
          percent={percent}
          levelLabel={levelLabel}
          levelChip={levelChip}
        />

        <section className="sp-card p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[20px] text-[var(--sp-ink)]">Câu trả lời sai</h2>
            <span className="sp-chip bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]">{wrongNumbers.length} câu</span>
          </div>

          {wrongNumbers.length === 0 ? (
            <p className="mt-4 rounded-2xl bg-emerald-50 p-5 text-center text-sm font-semibold text-emerald-800">
              Bạn trả lời đúng tất cả. Tuyệt vời!
            </p>
          ) : (
            <>
              {wrongGroups.length > 1 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {[{ key: "all", label: "Tất cả", count: 0 }, ...wrongGroups.map((group) => ({ key: group.key, label: group.label, count: group.wrong.length }))].map(
                    (chip) => (
                      <button
                        key={chip.key}
                        type="button"
                        aria-pressed={groupFilter === chip.key}
                        onClick={() => setGroupFilter(chip.key)}
                        className={`rounded-xl border-2 px-3 py-1.5 text-[13px] font-bold transition ${
                          groupFilter === chip.key
                            ? "border-[var(--sp-purple)] bg-[var(--sp-purple)] text-white"
                            : "border-[var(--sp-line)] bg-white text-[var(--sp-text-2)] hover:border-[var(--sp-lav-line)]"
                        }`}
                      >
                        {chip.label}
                        {chip.count ? ` · ${chip.count}` : ""}
                      </button>
                    )
                  )}
                </div>
              )}

              <ul className="mt-4 max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
                {visible.map((number) => {
                  const item = results[number - 1];
                  const active = number === selected;
                  const page = item.source_location?.page_number;
                  return (
                    <li key={item.question_id}>
                      <button
                        type="button"
                        onClick={() => setSelected(number)}
                        className={`flex w-full items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-left transition ${
                          active
                            ? "border-[var(--sp-purple)] bg-white shadow-[3px_3px_0_var(--sp-pink)]"
                            : "border-transparent hover:bg-[var(--sp-surface-2)]"
                        }`}
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]">
                          <IconX size={13} />
                        </span>
                        <span className="shrink-0 text-[14px] font-extrabold text-[var(--sp-ink)]">Câu {number}</span>
                        <span className="min-w-0 flex-1 truncate text-[14px] text-[var(--sp-text-2)]">{item.question_text}</span>
                        {page && <span className="shrink-0 text-[12px] font-bold text-[var(--sp-muted)]">tr.{page}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      </div>

      {/* ---------- Cột phải: chi tiết câu sai ---------- */}
      <section className="relative min-w-0 rounded-[28px] border-2 border-[var(--sp-purple-deep)] bg-white p-5 shadow-[6px_6px_0_var(--sp-peri)] sm:p-7">
        {!question || selected === null ? (
          <div className="flex flex-col items-center px-4 py-12 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
              <IconCheck size={28} />
            </span>
            <h3 className="mt-4 text-[22px] text-[var(--sp-ink)]">Không có câu sai để xem lại</h3>
            <p className="mt-1 max-w-sm text-sm text-[var(--sp-muted)]">
              Bạn đã nắm chắc bài này. Kéo xuống để xem nhận xét và gợi ý ôn tiếp.
            </p>
          </div>
        ) : (
          <QuestionDetail
            key={question.question_id}
            number={selected}
            question={question}
            chapterLabel={chapterLabel}
            chapter={chapter}
            groupLabel={groupOf(selected)?.label}
            isWeak={weakNumbers.has(selected)}
            mistake={
              mistakes.find((item) => item.question_id === question.question_id || item.question_number === selected)?.text ||
              weakHints.find((hint) => hint.question_numbers?.includes(selected))?.description ||
              ""
            }
            position={position}
            wrongTotal={wrongNumbers.length}
            onPrev={() => position > 0 && setSelected(wrongNumbers[position - 1])}
            onNext={() => setSelected(wrongNumbers[(position + 1) % wrongNumbers.length])}
            materialsHref={materialsHref}
            openingSource={openingSource}
            sourceError={sourceError}
            onOpenSource={openSource}
          />
        )}
      </section>
    </div>
  );
}

function QuestionDetail({
  number,
  question,
  chapterLabel,
  chapter,
  groupLabel,
  isWeak,
  mistake,
  position,
  wrongTotal,
  onPrev,
  onNext,
  materialsHref,
  openingSource,
  sourceError,
  onOpenSource,
}: {
  number: number;
  question: ReviewQuestion;
  chapterLabel: string;
  chapter?: string | null;
  groupLabel?: string;
  isWeak: boolean;
  mistake: string;
  position: number;
  wrongTotal: number;
  onPrev: () => void;
  onNext: () => void;
  materialsHref: string;
  openingSource: boolean;
  sourceError: string;
  onOpenSource: (materialId: string, page?: number | null) => void;
}) {
  const chosen = keysOf(question.selected_answer);
  const correctKeys = keysOf(question.correct_answer);
  const options = question.options || [];
  const isFill = question.question_type === "fill_blank" || options.length === 0;
  const correctLabel = correctKeys.join(", ");
  const explanation = shortExplanation(question.explanation);
  const page = question.source_location?.page_number;
  const fileName = question.source_location?.file_name;
  const materialId = question.source_location?.material_id;

  return (
    <div className="sp-task-expand text-justify">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="mr-1 text-[34px] font-black leading-none text-[var(--sp-pink)]">Câu {number}</h2>
        {(chapterLabel || page) && (
          <span className="sp-chip bg-[var(--sp-lav)] text-[var(--sp-purple)]">
            {[chapterLabel, page ? `trang ${page}` : groupLabel].filter(Boolean).join(" · ")}
          </span>
        )}
        {isWeak && (
          <span className="sp-chip flex items-center gap-1 bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]">
            <IconTarget size={13} />
            Phần yếu
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            aria-label="Câu sai trước"
            disabled={position <= 0}
            onClick={onPrev}
            className="flex h-9 w-9 items-center justify-center rounded-xl border-2 border-[var(--sp-line)] bg-white text-[var(--sp-ink)] transition hover:border-[var(--sp-lav-line)] disabled:opacity-40"
          >
            <IconChevronLeft size={16} />
          </button>
          <span className="text-[14px] font-bold text-[var(--sp-text-2)]">
            Câu sai {position + 1} / {wrongTotal}
          </span>
          <button
            type="button"
            aria-label="Câu sai tiếp theo"
            disabled={wrongTotal <= 1}
            onClick={onNext}
            className="flex h-9 w-9 items-center justify-center rounded-xl border-2 border-[var(--sp-line)] bg-white text-[var(--sp-ink)] transition hover:border-[var(--sp-lav-line)] disabled:opacity-40"
          >
            <IconChevronRight size={16} />
          </button>
        </div>
      </div>

      <p className="mt-4 text-[19px] font-bold leading-8 text-[var(--sp-ink)]">{question.question_text}</p>

      {/* Đáp án */}
      {isFill ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border-2 border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)] px-4 py-3">
            <p className="flex items-center gap-1 text-[12px] font-bold text-[var(--sp-pink-dark)]">
              <IconX size={13} />
              Bạn điền
            </p>
            <p className="mt-1 font-semibold text-[var(--sp-ink)]">
              {Array.isArray(question.selected_answer)
                ? question.selected_answer.join(", ")
                : question.selected_answer || "Bỏ trống"}
            </p>
          </div>
          <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 px-4 py-3 shadow-[3px_3px_0_#a7e3c4]">
            <p className="flex items-center gap-1 text-[12px] font-bold text-emerald-700">
              <IconCheck size={13} />
              Đáp án đúng
            </p>
            <p className="mt-1 font-semibold text-[var(--sp-ink)]">
              {Array.isArray(question.correct_answer) ? question.correct_answer.join(", ") : question.correct_answer}
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {options.map((option) => {
            const key = option.key.trim().toUpperCase();
            const isCorrect = correctKeys.includes(key);
            const isChosen = chosen.includes(key);
            const state = isCorrect ? "correct" : isChosen ? "wrong" : "idle";
            return (
              <div
                key={option.key}
                className={`flex items-center gap-3 rounded-2xl border-2 px-4 py-3 ${
                  state === "correct"
                    ? "border-emerald-400 bg-emerald-50 shadow-[3px_3px_0_#a7e3c4]"
                    : state === "wrong"
                      ? "border-[var(--sp-pink)] bg-[var(--sp-pink-bg)]"
                      : "border-[var(--sp-line)] bg-white"
                }`}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-extrabold ${
                    state === "correct"
                      ? "bg-emerald-600 text-white"
                      : state === "wrong"
                        ? "bg-[var(--sp-pink)] text-white"
                        : "bg-[var(--sp-surface-2)] text-[var(--sp-muted)]"
                  }`}
                >
                  {option.key}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-[15px] leading-6 ${
                      state === "idle" ? "text-[var(--sp-muted)]" : "font-semibold text-[var(--sp-ink)]"
                    }`}
                  >
                    {option.text}
                  </p>
                  {state === "correct" && (
                    <p className="mt-1.5 flex items-center gap-1 text-[12px] font-bold text-emerald-700">
                      <IconCheck size={13} />
                      {isChosen ? "Bạn chọn đúng" : "Đáp án đúng"}
                    </p>
                  )}
                  {state === "wrong" && (
                    <p className="mt-1.5 flex items-center gap-1 text-[12px] font-bold text-[var(--sp-pink-dark)]">
                      <IconX size={13} />
                      Bạn chọn
                    </p>
                  )}
                </div>
              </div>
            );
          })}
          {chosen.length === 0 && (
            <p className="text-[13px] font-semibold text-[var(--sp-pink-dark)] sm:col-span-2">Bạn đã bỏ trống câu này.</p>
          )}
        </div>
      )}

      {/* Giải thích */}
      <div className={`mt-5 grid gap-3 ${mistake ? "md:grid-cols-2" : ""}`}>
        <div className="rounded-2xl border-2 border-[var(--sp-lav-line)] bg-[var(--sp-lav)] px-5 py-4">
          <p className="flex items-center gap-2 text-[15px] font-bold text-[var(--sp-purple)]">
            <IconBulb size={17} />
            Vì sao chọn {isFill ? "đáp án này" : correctLabel}?
          </p>
          <p className="mt-2 text-[14px] leading-6 text-[var(--sp-text-2)]">
            {explanation || "Xem lại đoạn tài liệu gốc bên dưới để hiểu vì sao đây là đáp án đúng."}
          </p>
        </div>
        {mistake && (
          <div className="rounded-2xl border-2 border-[#f3dca0] bg-[var(--sp-amber-bg)] px-5 py-4">
            <p className="flex items-center gap-2 text-[15px] font-bold text-[var(--sp-amber-dark)]">
              <IconAlert size={17} />
              Bạn nhầm ở đâu?
            </p>
            <p className="mt-2 text-[14px] leading-6 text-[var(--sp-text-2)]">{mistake}</p>
          </div>
        )}
      </div>

      {/* Nguồn */}
      <div className="mt-5 flex flex-col gap-4 rounded-2xl border-2 border-[var(--sp-purple-deep)] bg-white p-4 shadow-[4px_4px_0_var(--sp-pink)] sm:flex-row sm:items-center sm:p-5">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border-2 border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)] text-[12px] font-extrabold text-[var(--sp-pink-dark)]">
          {(fileName?.split(".").pop() || "PDF").toUpperCase().slice(0, 4)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="sp-accent text-[15px] text-[var(--sp-pink)]">Nguồn trong tài liệu gốc</p>
          <p className="truncate text-[16px] font-bold text-[var(--sp-ink)]">{fileName || "Tài liệu ôn tập"}</p>
          <p className="truncate text-[13px] text-[var(--sp-muted)]">
            {[chapter, page ? `Trang ${page}` : null].filter(Boolean).join(" › ") || "Nội dung của buổi học"}
          </p>
          {sourceError && <p className="mt-1 text-[12px] font-semibold text-[var(--sp-pink-dark)]">{sourceError}</p>}
        </div>
        <div className="flex shrink-0 flex-col gap-2">
          <Link href={materialsHref} className="sp-btn sp-btn-secondary justify-center px-4 py-2 text-[13px]">
            <IconFile size={15} />
            Mở bài học
          </Link>
          {materialId && (
            <button
              type="button"
              disabled={openingSource}
              onClick={() => onOpenSource(materialId, page)}
              className="sp-btn sp-btn-secondary justify-center px-4 py-2 text-[13px] disabled:opacity-60"
            >
              <IconBook size={15} />
              {openingSource ? "Đang mở..." : "Mở tài liệu gốc"}
            </button>
          )}
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between gap-3 border-t-2 border-dashed border-[var(--sp-line)] pt-5">
        <p className="flex items-center gap-1.5 text-[13px] text-[var(--sp-muted)]">
          <Sparkle size={12} className="text-[var(--sp-yellow)]" />
          Câu sai sẽ được ưu tiên trong bài kiểm tra lại
        </p>
        {wrongTotal > 1 && (
          <button type="button" onClick={onNext} className="sp-btn sp-btn-primary px-5 py-2.5 text-sm">
            {position + 1 < wrongTotal ? "Câu sai tiếp theo" : "Về câu sai đầu tiên"}
            <IconChevronRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

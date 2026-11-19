"use client";

import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { IconBulb, IconCheck, IconFile, IconRepeat, IconX, Sparkle } from "@/components/icons";

/* Màu cho từng định dạng tài liệu */
const FILE_TYPES: Record<string, { label: string; bg: string; text: string }> = {
  pdf: { label: "PDF", bg: "bg-[var(--sp-pink)]", text: "text-white" },
  doc: { label: "DOC", bg: "bg-[var(--sp-peri)]", text: "text-white" },
  docx: { label: "DOCX", bg: "bg-[var(--sp-peri)]", text: "text-white" },
  ppt: { label: "PPT", bg: "bg-[var(--sp-yellow)]", text: "text-[var(--sp-purple-deep)]" },
  pptx: { label: "PPTX", bg: "bg-[var(--sp-yellow)]", text: "text-[var(--sp-purple-deep)]" },
};

function getType(name: string) {
  const extension = name.toLowerCase().split(".").pop() || "";
  return FILE_TYPES[extension] || { label: extension.toUpperCase() || "FILE", bg: "bg-[var(--sp-purple)]", text: "text-white" };
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MaterialDropzone({
  file,
  inputKey,
  validate,
  onChange,
  onError,
  status,
  showTips = true,
}: {
  status?: ReactNode;
  showTips?: boolean;
  file: File | null;
  inputKey: number;
  validate: (file: File) => string | null;
  onChange: (file: File | null) => void;
  onError: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState("");

  const accept = (next: File | null) => {
    if (!next) return;
    const validationError = validate(next);
    if (validationError) {
      setError(validationError);
      onError(validationError);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setError("");
    onError("");
    onChange(next);
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragging(false);
    accept(event.dataTransfer.files?.[0] || null);
  };

  const dragProps = {
    onDragOver: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      if (!isDragging) setIsDragging(true);
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDragging(false);
    },
    onDrop: handleDrop,
  };

  const fileType = file ? getType(file.name) : null;

  return (
    <div>
      <input
        key={inputKey}
        ref={inputRef}
        id="study-material"
        type="file"
        accept=".pdf,.doc,.docx,.ppt,.pptx"
        className="sr-only"
        onChange={(event) => accept(event.target.files?.[0] || null)}
      />

      {file && fileType ? (
        /* ---------- Đã chọn file ---------- */
        <div
          {...dragProps}
          className={`sp-task-expand relative overflow-hidden rounded-[22px] border-2 p-5 transition sm:p-6 ${
            isDragging
              ? "border-[var(--sp-peri)] bg-[var(--sp-lav)]"
              : "border-[var(--sp-purple)] bg-white shadow-[5px_5px_0_var(--sp-lav-line)]"
          }`}
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="relative h-[72px] w-[60px] shrink-0">
              <span className="absolute inset-0 rounded-xl border-2 border-[var(--sp-line)] bg-[var(--sp-surface-2)]" />
              <span className="absolute right-0 top-0 h-4 w-4 rounded-bl-lg border-b-2 border-l-2 border-[var(--sp-line)] bg-white" />
              <span className="absolute left-2 right-3 top-4 h-1 rounded bg-[var(--sp-line)]" />
              <span className="absolute left-2 right-5 top-7 h-1 rounded bg-[var(--sp-line)]" />
              <span
                className={`absolute -bottom-1.5 -left-2 rounded-lg px-1.5 py-0.5 text-[11px] font-extrabold ${fileType.bg} ${fileType.text}`}
              >
                {fileType.label}
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate text-[16px] font-bold text-[var(--sp-ink)]" title={file.name}>
                {file.name}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--sp-muted)]">
                <span>{formatSize(file.size)}</span>
                {status ?? (
                  <span className="flex items-center gap-1 font-semibold text-emerald-700">
                    <IconCheck size={15} />
                    Sẵn sàng để AI phân tích
                  </span>
                )}
              </p>
              <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[var(--sp-surface-2)]">
                <div className="sp-fill-bar h-full rounded-full bg-[var(--sp-peri)]" />
              </div>
            </div>

            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="sp-btn sp-btn-secondary px-4 py-2 text-sm"
              >
                <IconRepeat size={15} />
                Đổi file
              </button>
              <button
                type="button"
                aria-label="Xóa tài liệu"
                onClick={() => {
                  setError("");
                  onChange(null);
                }}
                className="sp-btn border-2 border-[var(--sp-pink-line)] bg-white px-3 py-2 text-sm text-[var(--sp-pink-dark)] hover:bg-[var(--sp-pink-bg)]"
              >
                <IconX size={15} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* ---------- Khu kéo thả ---------- */
        <label
          htmlFor="study-material"
          {...dragProps}
          className={`group relative flex cursor-pointer flex-col items-center overflow-hidden rounded-[22px] border-2 border-dashed px-5 pb-7 pt-8 text-center transition duration-200 ${
            isDragging
              ? "scale-[1.01] border-[var(--sp-peri)] bg-[var(--sp-lav)]"
              : error
                ? "border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)]/50"
                : "border-[var(--sp-lav-line)] bg-[var(--sp-surface-2)] hover:border-[var(--sp-peri)] hover:bg-[var(--sp-lav)]"
          }`}
        >
          {/* Minh hoạ: chồng tài liệu */}
          <div className="relative mb-5 h-[92px] w-[150px]" aria-hidden="true">
            <DocCard className="left-2 top-3 -rotate-[14deg] transition duration-300 group-hover:-translate-x-2 group-hover:-rotate-[20deg]" type="pdf" />
            <DocCard className="right-2 top-3 rotate-[14deg] transition duration-300 group-hover:translate-x-2 group-hover:rotate-[20deg]" type="pptx" />
            <DocCard
              className={`left-1/2 top-0 z-10 -translate-x-1/2 transition duration-300 ${
                isDragging ? "-translate-y-3" : "group-hover:-translate-y-2"
              }`}
              type="docx"
              main
            />
            <Sparkle size={18} className="sp-twinkle absolute -right-3 -top-1 text-[var(--sp-yellow)]" />
            <Sparkle size={12} className="sp-twinkle absolute -left-2 bottom-2 text-[var(--sp-pink)]" />
          </div>

          <p className="text-[17px] font-bold text-[var(--sp-ink)]">
            {isDragging ? "Thả tài liệu vào đây" : "Kéo thả tài liệu vào đây"}
          </p>
          <p className="mt-1 text-sm text-[var(--sp-muted)]">
            hoặc{" "}
            <span className="font-bold text-[var(--sp-peri-dark)] underline decoration-2 underline-offset-4">
              chọn từ thiết bị
            </span>
          </p>

          <div className="mt-4 flex flex-wrap justify-center gap-1.5">
            {["pdf", "docx", "pptx"].map((type) => {
              const style = FILE_TYPES[type];
              return (
                <span
                  key={type}
                  className={`rounded-lg px-2 py-0.5 text-[11px] font-extrabold ${style.bg} ${style.text}`}
                >
                  {style.label}
                </span>
              );
            })}
            <span className="rounded-lg bg-white px-2 py-0.5 text-[11px] font-bold text-[var(--sp-muted)]">
              DOC · PPT
            </span>
            <span className="rounded-lg bg-white px-2 py-0.5 text-[11px] font-bold text-[var(--sp-muted)]">
              Tối đa 50 MB
            </span>
          </div>
        </label>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-[var(--sp-pink-dark)]">
          {error}
        </p>
      )}

      {/* Mẹo */}
      {showTips && (
      <div className="mt-3 flex gap-3 rounded-2xl border border-[var(--sp-line)] bg-white px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--sp-amber-bg)] text-[var(--sp-amber-dark)]">
          <IconBulb size={17} />
        </span>
        <div className="text-[13px] leading-5 text-[var(--sp-text-2)]">
          <p className="font-bold text-[var(--sp-ink)]">Mẹo để AI chia bài chính xác hơn</p>
          <ul className="mt-1 grid gap-x-5 gap-y-0.5 sm:grid-cols-2">
            <li className="flex gap-1.5">
              <IconFile size={13} className="mt-1 shrink-0 text-[var(--sp-peri-dark)]" />
              Tài liệu có mục lục, tên chương rõ ràng
            </li>
            <li className="flex gap-1.5">
              <IconFile size={13} className="mt-1 shrink-0 text-[var(--sp-peri-dark)]" />
              PDF dạng chữ, không phải ảnh chụp/scan
            </li>
            <li className="flex gap-1.5">
              <IconFile size={13} className="mt-1 shrink-0 text-[var(--sp-peri-dark)]" />
              Một file gồm đủ các chương sẽ thi
            </li>
            <li className="flex gap-1.5">
              <IconFile size={13} className="mt-1 shrink-0 text-[var(--sp-peri-dark)]" />
              Bỏ bớt trang bìa, đề bài không cần học
            </li>
          </ul>
        </div>
      </div>
      )}
    </div>
  );
}

function DocCard({
  type,
  className,
  main,
}: {
  type: keyof typeof FILE_TYPES;
  className: string;
  main?: boolean;
}) {
  const style = FILE_TYPES[type];
  return (
    <span
      className={`absolute block h-[78px] w-[62px] rounded-xl border-2 bg-white ${
        main ? "border-[var(--sp-purple)] shadow-[3px_3px_0_var(--sp-lav-line)]" : "border-[var(--sp-line)]"
      } ${className}`}
    >
      <span className="absolute left-2 right-3 top-3 h-1 rounded bg-[var(--sp-line)]" />
      <span className="absolute left-2 right-5 top-5.5 h-1 rounded bg-[var(--sp-line)]" />
      <span className="absolute left-2 right-4 top-8 h-1 rounded bg-[var(--sp-line)]" />
      <span
        className={`absolute bottom-2 left-2 rounded-md px-1.5 py-0.5 text-[10px] font-extrabold ${style.bg} ${style.text}`}
      >
        {style.label}
      </span>
    </span>
  );
}

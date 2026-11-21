"use client";

import { tx } from "@/lib/i18n";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { IconCheck, IconImage, IconRepeat, IconX, Sparkle } from "@/components/icons";

/*
 * Khung căn chỉnh ảnh đại diện: kéo để di chuyển, kéo thanh trượt (hoặc lăn chuột) để phóng to,
 * xoay 90°. Bấm "Xác nhận" mới cắt ảnh thành hình vuông 256px và trả về cho trang Cài đặt lưu.
 */

const VIEW = 288; // kích thước khung xem (px)
const OUTPUT = 256; // kích thước ảnh lưu (px)
const MAX_ZOOM = 4;

type Props = {
  file: File;
  busy?: boolean;
  onCancel: () => void;
  onPickAnother: () => void;
  onConfirm: (blob: Blob) => void;
};

export default function AvatarCropper({ file, busy = false, onCancel, onPickAnother, onConfirm }: Props) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0); // 0, 90, 180, 270
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ id: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  /* Đọc ảnh */
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setUrl(objectUrl);
      setImage(img);
    };
    img.onerror = () => setError(tx("Không mở được ảnh này. Bạn thử ảnh khác nhé."));
    img.src = objectUrl;
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  /* Esc để đóng, khoá cuộn trang khi đang mở */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [busy, onCancel]);

  const rotated = rotation % 180 !== 0;
  const naturalW = image ? (rotated ? image.naturalHeight : image.naturalWidth) : 1;
  const naturalH = image ? (rotated ? image.naturalWidth : image.naturalHeight) : 1;
  const baseScale = Math.max(VIEW / naturalW, VIEW / naturalH); // vừa khít khung
  const scale = baseScale * zoom;

  /* Không cho kéo ảnh lệch ra khỏi khung (luôn phủ kín vòng tròn) */
  function clamp(next: { x: number; y: number }, nextZoom = zoom, nextRotation = rotation) {
    if (!image) return next;
    const turned = nextRotation % 180 !== 0;
    const w = turned ? image.naturalHeight : image.naturalWidth;
    const h = turned ? image.naturalWidth : image.naturalHeight;
    const s = Math.max(VIEW / w, VIEW / h) * nextZoom;
    const maxX = Math.max(0, (w * s - VIEW) / 2);
    const maxY = Math.max(0, (h * s - VIEW) / 2);
    return { x: Math.min(maxX, Math.max(-maxX, next.x)), y: Math.min(maxY, Math.max(-maxY, next.y)) };
  }

  function changeZoom(value: number) {
    const next = Math.min(MAX_ZOOM, Math.max(1, value));
    setZoom(next);
    setOffset((current) => clamp({ x: current.x * (next / zoom), y: current.y * (next / zoom) }, next));
  }

  function rotate() {
    const next = (rotation + 90) % 360;
    setRotation(next);
    setOffset((current) => clamp({ x: -current.y, y: current.x }, zoom, next));
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!image) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, baseX: offset.x, baseY: offset.y };
  }
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    setOffset(clamp({ x: current.baseX + event.clientX - current.startX, y: current.baseY + event.clientY - current.startY }));
  }
  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current?.id === event.pointerId) drag.current = null;
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 30 : 8;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[event.key]) {
      event.preventDefault();
      const [dx, dy] = moves[event.key];
      setOffset((current) => clamp({ x: current.x + dx, y: current.y + dy }));
    } else if (event.key === "+" || event.key === "=") changeZoom(zoom + 0.1);
    else if (event.key === "-") changeZoom(zoom - 0.1);
  }

  /* Cắt ảnh đúng như đang thấy trong vòng tròn */
  async function confirm() {
    if (!image) return;
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const context = canvas.getContext("2d");
    if (!context) return;
    const k = OUTPUT / VIEW;
    context.imageSmoothingQuality = "high";
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, OUTPUT, OUTPUT);
    context.translate(OUTPUT / 2 + offset.x * k, OUTPUT / 2 + offset.y * k);
    context.rotate((rotation * Math.PI) / 180);
    context.scale(scale * k, scale * k);
    context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
    const toBlob = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92));
    const blob = (await toBlob("image/webp")) || (await toBlob("image/jpeg"));
    if (blob) onConfirm(blob);
    else setError(tx("Không cắt được ảnh, bạn thử lại nhé."));
  }

  const zoomPercent = Math.round(((zoom - 1) / (MAX_ZOOM - 1)) * 100);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[rgba(36,18,58,0.45)] p-4 backdrop-blur-[2px]">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="avatar-cropper-title"
        tabIndex={-1}
        className="sp-fade-in w-full max-w-[440px] rounded-[28px] border-2 border-[var(--sp-purple-deep)] bg-white p-6 shadow-[6px_6px_0_var(--sp-pink-line)] outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="avatar-cropper-title" className="text-[22px] font-extrabold text-[var(--sp-purple)]">

              {tx("Căn chỉnh ảnh đại diện")}
            </h2>
            <p className="mt-1 text-[13.5px] text-[var(--sp-muted)]">{tx("Kéo ảnh để chọn vị trí, kéo thanh trượt để phóng to.")}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label={tx("Đóng")}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-[var(--sp-line)] text-[var(--sp-muted)] transition hover:text-[var(--sp-ink)] disabled:opacity-50"
          >
            <IconX size={18} />
          </button>
        </div>

        {/* Khung cắt */}
        <div className="mt-5 flex justify-center">
          <div
            role="application"
            aria-label={tx("Vùng căn chỉnh ảnh. Dùng phím mũi tên để di chuyển, phím cộng trừ để phóng to thu nhỏ.")}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={(event) => changeZoom(zoom - event.deltaY * 0.0015)}
            onKeyDown={onKeyDown}
            className="relative cursor-grab touch-none overflow-hidden rounded-[24px] bg-[var(--sp-surface-2)] outline-none ring-[var(--sp-peri)] ring-offset-2 focus-visible:ring-2 active:cursor-grabbing"
            style={{ width: VIEW, height: VIEW }}
          >
            {image && url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt={tx("Ảnh đang căn chỉnh")}
                draggable={false}
                className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
                style={{
                  width: image.naturalWidth,
                  height: image.naturalHeight,
                  transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg) scale(${scale})`,
                }}
              />
            )}
            {!image && !error && (
              <span className="absolute inset-0 flex items-center justify-center">
                <Sparkle size={24} className="sp-twinkle text-[var(--sp-pink)]" />
              </span>
            )}
            {/* Phần ngoài vòng tròn bị làm tối, viền tròn là phần sẽ được lưu */}
            <div
              className="pointer-events-none absolute inset-0 rounded-full"
              style={{ boxShadow: "0 0 0 999px rgba(36,18,58,0.45)", border: "3px solid #fff" }}
            />
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-2xl border-2 border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)] px-4 py-2.5 text-[13.5px] font-semibold text-[var(--sp-pink-dark)]">
            {error}
          </p>
        )}

        {/* Phóng to + xoay */}
        <div className="mt-5 flex items-center gap-3">
          <span className="text-[13px] font-bold text-[var(--sp-muted)]">{tx("Thu")}</span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(event) => changeZoom(Number(event.target.value))}
            aria-label={tx("Phóng to ảnh")}
            className="h-2 flex-1 cursor-pointer appearance-none rounded-full accent-[var(--sp-peri)]"
            style={{ background: `linear-gradient(to right, var(--sp-peri) ${zoomPercent}%, var(--sp-line) ${zoomPercent}%)` }}
          />
          <span className="text-[13px] font-bold text-[var(--sp-muted)]">{tx("Phóng")}</span>
          <button
            type="button"
            onClick={rotate}
            disabled={!image}
            title="Xoay 90°"
            aria-label={tx("Xoay ảnh 90 độ")}
            className="flex h-10 w-10 items-center justify-center rounded-xl border-2 border-[var(--sp-line)] text-[var(--sp-text-2)] transition hover:border-[var(--sp-lav-line)] hover:bg-[var(--sp-surface-2)] disabled:opacity-50"
          >
            <IconRepeat size={18} />
          </button>
        </div>

        {/* Nút */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={onPickAnother}
            disabled={busy}
            className="flex h-11 items-center gap-2 rounded-2xl px-2 text-[14.5px] font-bold text-[var(--sp-peri-dark)] underline underline-offset-4 disabled:opacity-50"
          >
            <IconImage size={17} />

            {tx("Chọn ảnh khác")}
          </button>
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="sp-btn sp-btn-secondary h-11 px-5 text-[15px]"
            >

              {tx("Huỷ")}
            </button>
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={!image || busy}
              className="sp-btn sp-btn-primary h-11 px-5 text-[15px]"
            >
              {busy ? <Sparkle size={16} className="sp-twinkle" /> : <IconCheck size={18} />}
              {busy ? tx("Đang lưu...") : tx("Xác nhận")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { tx } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import { PilotMascot } from "@/components/loading-play";
import {
  DEFAULT_OUTFIT,
  NEED_TEXT,
  WARDROBE,
  WEAR_SLOTS,
  savePilotOutfit,
  usePilotOutfit,
  wearItem,
  type PilotOutfit,
  type WearSlot,
} from "@/components/pilot-wear";
import { IconCheck, IconLock, IconMoon, IconX } from "@/components/icons";
import { isUnlocked, pilotProgress, type PilotProgress } from "@/lib/pilot-progress";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

const PRAISE = [
  tx("Hợp với mình ghê!"),
  tx("Trông mình ngầu không?"),
  tx("Mặc cái này đi học nha~"),
  tx("Xinh xỉu luôn!"),
  tx("Mình thích cái này!"),
];
const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

function todayKey() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

async function loadList<T>(path: string): Promise<T[]> {
  const response = await fetch(`${API_BASE_URL}${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(String(response.status));
  const data = await response.json();
  // API trả { data: [...] }
  const list = Array.isArray(data) ? data : data?.data;
  return Array.isArray(list) ? list : [];
}

/* Sao và điều kiện mở khoá, tính từ buổi học + bài quiz đã nộp */
function usePilotProgress(active: boolean) {
  const [progress, setProgress] = useState<PilotProgress | null>(null);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    Promise.all([
      loadList<{ status?: string }>("/api/study-sessions"),
      loadList<{ score?: number; submitted_at?: string }>("/api/quiz-attempts"),
    ])
      .then(([sessions, attempts]) => {
        if (!alive) return;
        setProgress(
          pilotProgress({
            sessionStatuses: sessions.map((session) => session.status || ""),
            attempts: attempts.map((attempt) => ({ score: Number(attempt.score) || 0, submittedAt: attempt.submitted_at })),
            todayKey: todayKey(),
          }),
        );
      })
      .catch(() => {
        // Không tải được thì chỉ khoá các món cần điều kiện, vẫn cho thay đồ thường
        if (alive) setProgress(pilotProgress({ sessionStatuses: [], attempts: [], todayKey: todayKey() }));
      });
    return () => {
      alive = false;
    };
  }, [active]);
  return progress;
}

function outfitSummary(outfit: PilotOutfit) {
  const names: string[] = [];
  for (const slot of WEAR_SLOTS) {
    const id = outfit[slot];
    if (id === "none") continue;
    const name = wearItem(slot, id)?.name || "";
    names.push(slot === "cover" ? tx("bìa {0}", [name.toLowerCase()]) : name);
  }
  return names.join(" · ");
}

export default function PilotHouse({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <PilotHouseDialog onClose={onClose} />;
}

function PilotHouseDialog({ onClose }: { onClose: () => void }) {
  const saved = usePilotOutfit();
  const progress = usePilotProgress(true);
  const [trying, setTrying] = useState<PilotOutfit>(saved);
  const [slot, setSlot] = useState<WearSlot>("hat");
  const [night, setNight] = useState(false);
  const [bubble, setBubble] = useState<{ text: string; at: number } | null>(null);
  const [hop, setHop] = useState(0);
  const [saving, setSaving] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const bubbleTimer = useRef<number | undefined>(undefined);
  const bubbleSeq = useRef(0);

  const changed = JSON.stringify(trying) !== JSON.stringify(saved);

  function say(text: string) {
    setBubble({ text, at: ++bubbleSeq.current });
    window.clearTimeout(bubbleTimer.current);
    bubbleTimer.current = window.setTimeout(() => setBubble(null), 2000);
  }
  function wear(next: PilotOutfit, line: string) {
    setTrying(next);
    setHop((n) => n + 1);
    say(line);
  }

  useEffect(() => {
    closeRef.current?.focus();
    const greet = window.setTimeout(() => say(tx("Chào mừng tới nhà mình!")), 300);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // Khoá cuộn trang phía sau khi đang mở nhà
    document.documentElement.classList.add("overflow-hidden");
    return () => {
      window.clearTimeout(greet);
      window.clearTimeout(bubbleTimer.current);
      document.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("overflow-hidden");
    };
  }, [onClose]);

  const unlocked = (rule: Parameters<typeof isUnlocked>[0]) => (progress ? isUnlocked(rule, progress) : !rule);

  function randomOutfit() {
    const next = { ...trying };
    for (const key of WEAR_SLOTS) {
      const ids = Object.entries(WARDROBE[key].items as Record<string, { need?: Parameters<typeof isUnlocked>[0] }>)
        .filter(([, item]) => unlocked(item.need))
        .map(([id]) => id);
      (next as Record<WearSlot, string>)[key] = pick(ids);
    }
    wear(next, tx("Tèn ten! Phong cách mới!"));
  }

  async function save() {
    setSaving(true);
    try {
      await savePilotOutfit(trying);
      setHop((n) => n + 1);
      say(tx("Đã lưu! Mình mặc thế này nha ✦"));
    } catch {
      say(tx("Chưa lưu được, thử lại nha…"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sp-dialog-veil fixed inset-0 z-50 flex items-center justify-center bg-[rgba(36,18,58,.45)] p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tx("Nhà của Pilot")}
        className="sp-dialog-pop grid h-[min(640px,calc(100dvh-32px))] w-[min(1060px,100%)] grid-rows-[minmax(260px,1fr)_auto] overflow-hidden rounded-[28px] border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-surface)] shadow-[6px_6px_0_var(--sp-purple-deep)] md:grid-cols-[1.1fr_1fr] md:grid-rows-1"
      >
        {/* Căn phòng */}
        <div className={`sp-house-room relative overflow-hidden border-b-2 border-[var(--sp-purple-deep)] md:border-b-0 md:border-r-2 ${night ? "is-night" : ""}`}>
          <div className="sp-house-wall" />
          <div className="sp-house-floor" />
          <div className="sp-house-window"><span /></div>
          <div className="sp-house-shelf" aria-hidden="true">
            <div className="flex items-end gap-[3px] pl-2.5">
              <i style={{ height: 34, background: "#5b7fe3" }} />
              <i style={{ height: 42, background: "#e0457b" }} />
              <i style={{ height: 30, background: "#f6c343" }} />
              <i style={{ height: 38, background: "#5b2a86" }} />
              <svg width="30" height="30" viewBox="0 0 30 30" className="ml-2.5">
                <path d="M8 4 h14 v7 q0 9 -7 9 q-7 0 -7 -9 Z" fill="#f6c343" stroke="#33094a" strokeWidth="2.5" />
                <rect x="10" y="22" width="10" height="6" rx="1" fill="#c98d4f" stroke="#33094a" strokeWidth="2.5" />
              </svg>
            </div>
            <div className="sp-house-board" />
          </div>
          <div className="sp-house-frame" aria-hidden="true">A+ ✦</div>
          <svg className="sp-house-lamp" viewBox="0 0 40 90" aria-hidden="true">
            <path d="M6 30 L34 30 L28 6 L12 6 Z" fill="#f6c343" stroke="#33094a" strokeWidth="3" strokeLinejoin="round" />
            <rect x="18" y="30" width="4" height="50" fill="#33094a" />
            <rect x="8" y="80" width="24" height="7" rx="3" fill="#33094a" />
          </svg>
          <svg className="sp-house-plant" viewBox="0 0 52 70" aria-hidden="true">
            <path d="M26 40 C10 34 6 18 12 10 C22 14 28 26 26 40 Z" fill="#3fae8c" stroke="#33094a" strokeWidth="2.5" />
            <path d="M26 40 C40 32 46 18 40 8 C30 14 24 26 26 40 Z" fill="#5cc8a3" stroke="#33094a" strokeWidth="2.5" />
            <path d="M12 40 h28 l-4 28 h-20 Z" fill="#e0457b" stroke="#33094a" strokeWidth="3" strokeLinejoin="round" />
          </svg>
          <div className="sp-house-rug" />
          <div className="sp-house-dim" />

          <button
            type="button"
            className="sp-house-stage"
            aria-label={tx("Chạm vào Pilot")}
            onClick={() => {
              setHop((n) => n + 1);
              say(pick(PRAISE));
            }}
          >
            <PilotMascot key={hop} size={230} outfit={trying} happy={hop > 0} className={hop > 0 ? "sp-pilot-jump" : ""} />
          </button>
          {bubble && (
            <p key={bubble.at} className="sp-house-bubble" role="status">
              {bubble.text}
            </p>
          )}

          <div className="absolute inset-x-4 top-4 z-[3] flex items-center justify-between gap-2">
            <span className="rounded-[14px] border-2 border-[var(--sp-purple-deep)] bg-white px-3.5 py-1 shadow-[3px_3px_0_var(--sp-purple-deep)]">
              <b className="font-[family-name:var(--font-sp-display)] text-[22px] font-normal text-[#4a1068]">{tx("Nhà của Pilot")}</b>
            </span>
            <span className="flex gap-2">
              <span
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border-2 border-[#33094a] bg-[#fff5d6] px-3 text-[13px] font-extrabold text-[#9a6400]"
                title={tx("1 sao mỗi buổi học xong, thêm 1 sao mỗi bài quiz đạt từ 80%")}
              >
                ⭐ {progress ? tx("{0} sao", [progress.stars]) : "…"}
              </span>
              <button
                type="button"
                onClick={() => {
                  setNight((value) => !value);
                  say(night ? tx("Sáng rồi, học thôi!") : tx("Buồn ngủ quá… zzz"));
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border-2 border-[#33094a] bg-white px-3 text-[13px] font-bold text-[#33094a]"
              >
                <IconMoon size={15} />
                {night ? tx("Bật đèn") : tx("Tắt đèn")}
              </button>
            </span>
          </div>
        </div>

        {/* Tủ đồ */}
        <div className="flex min-h-0 flex-col">
          <div className="flex items-start justify-between gap-3 px-6 pb-3.5 pt-5">
            <div>
              <h2 className="font-[family-name:var(--font-sp-display)] text-[28px] leading-none text-[var(--sp-purple)]">{tx("Tủ đồ")}</h2>
              <p className="mt-1.5 text-[13px] text-[var(--sp-muted)]">{tx("Chọn đồ để Pilot mặc thử. Bấm Lưu để Pilot mặc như vậy ở mọi trang.")}</p>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label={tx("Đóng")}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-[var(--sp-line)] bg-[var(--sp-surface)] text-[var(--sp-text-2)] hover:border-[var(--sp-purple-deep)]"
            >
              <IconX size={18} />
            </button>
          </div>

          <div className="grid grid-cols-5 gap-1.5 px-6" role="tablist">
            {WEAR_SLOTS.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={slot === key}
                onClick={() => setSlot(key)}
                className={`h-10 rounded-xl border-2 text-[13px] font-bold ${
                  slot === key
                    ? "border-[var(--sp-purple-deep)] bg-[var(--sp-purple)] text-white shadow-[2px_2px_0_var(--sp-pink)]"
                    : "border-[var(--sp-line)] bg-[var(--sp-surface)] text-[var(--sp-text-2)]"
                }`}
              >
                {WARDROBE[key].label}
              </button>
            ))}
          </div>

          <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-3 gap-3 overflow-y-auto px-6 py-4">
            {Object.entries(WARDROBE[slot].items as Record<string, { name: string; need?: Parameters<typeof isUnlocked>[0] }>).map(([id, item]) => {
              const on = trying[slot] === id;
              const open = unlocked(item.need);
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={on}
                  aria-disabled={!open}
                  onClick={() => (open ? wear({ ...trying, [slot]: id } as PilotOutfit, pick(PRAISE)) : say(tx("Học thêm chút nữa để mở nha!")))}
                  className={`relative rounded-[18px] border-2 px-1.5 pb-2 pt-1.5 text-center transition ${
                    on
                      ? "border-[var(--sp-purple-deep)] bg-[var(--sp-lav)] shadow-[3px_3px_0_var(--sp-peri)]"
                      : "border-[var(--sp-line)] bg-[var(--sp-surface-2)] hover:border-[var(--sp-peri)]"
                  } ${open ? "" : "cursor-not-allowed"}`}
                >
                  {on && (
                    <span className="absolute right-1.5 top-1.5 flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-peri)] text-white">
                      <IconCheck size={12} />
                    </span>
                  )}
                  <span className={`flex justify-center ${open ? "" : "opacity-30 grayscale"}`}>
                    <PilotMascot size={92} outfit={{ ...trying, [slot]: id } as PilotOutfit} className="sp-pilot-still" />
                  </span>
                  <span className="mt-0.5 block text-[12.5px] font-bold text-[var(--sp-text-2)]">{item.name}</span>
                  {!open && item.need && (
                    <span className="absolute inset-x-2 top-[38px] flex items-center justify-center gap-1 rounded-lg border border-[var(--sp-pink-line)] bg-[var(--sp-surface)] px-1 py-[3px] text-[10.5px] font-bold leading-tight text-[var(--sp-pink-dark)]">
                      <IconLock size={11} />
                      {NEED_TEXT[item.need]}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-[1fr_1fr_1.4fr] items-center gap-2 border-t-2 border-[var(--sp-line)] px-6 pb-4 pt-3">
            <p className="col-span-3 text-[12.5px] leading-snug text-[var(--sp-muted)]">
              <b className={changed ? "text-[var(--sp-pink-dark)]" : "text-[var(--sp-ink)]"}>{changed ? tx("Đang thử:") : tx("Đang mặc:")}</b>{" "}
              {outfitSummary(trying)}
            </p>
            <button type="button" onClick={randomOutfit} className="h-11 rounded-[14px] border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-surface)] text-[13.5px] font-extrabold text-[var(--sp-purple-deep)]">
              🎲 {tx("Ngẫu nhiên")}
            </button>
            <button type="button" onClick={() => wear(DEFAULT_OUTFIT, tx("Về đồ gốc nè~"))} className="h-11 rounded-[14px] border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-surface)] text-[13.5px] font-extrabold text-[var(--sp-purple-deep)]">
              {tx("Đồ gốc")}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !changed}
              className="sp-btn sp-btn-primary h-11 justify-center rounded-[14px] text-[13.5px] font-extrabold disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? tx("Đang lưu...") : changed ? tx("Lưu trang phục") : tx("Đã lưu")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

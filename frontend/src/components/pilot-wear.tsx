"use client";

import { tx } from "@/lib/i18n";
import { useAuth } from "@/components/auth-provider";
import { getAuthClient } from "@/lib/auth";
import type { UnlockRule } from "@/lib/pilot-progress";

/*
 * Tủ đồ của Pilot. Mọi lớp vẽ trên cùng hệ toạ độ thân Pilot (viewBox 200 x 200, thân ở x 48-152, y 48-174),
 * nên dùng chung cho PilotMascot (màn chờ, tạo kế hoạch) và HomePilot (trang chủ).
 * Trang phục lưu theo tài khoản ở user_metadata.sp_pilot_outfit.
 */

const D = "#33094a";

export type PilotOutfit = { hat: HatId; glasses: GlassesId; scarf: ScarfId; held: HeldId; cover: CoverId };
type HatId = "pilot" | "none" | "beanie" | "bow" | "grad" | "crown";
type GlassesId = "none" | "round" | "sun" | "star";
type ScarfId = "pink" | "none" | "blue" | "yellow" | "stripe";
type HeldId = "page" | "none" | "pencil" | "mug" | "trophy";
type CoverId = "purple" | "blue" | "pink" | "mint" | "sun";

export const DEFAULT_OUTFIT: PilotOutfit = { hat: "pilot", glasses: "none", scarf: "pink", held: "page", cover: "purple" };

export type WearItem = { name: string; need?: UnlockRule };

export const NEED_TEXT: Record<UnlockRule, string> = {
  streak5: tx("Học 5 ngày liền"),
  streak7: tx("Học 7 ngày liền"),
  good3: tx("3 bài quiz ≥ 80%"),
  perfect1: tx("1 bài quiz 100%"),
  sessions10: tx("Xong 10 buổi học"),
};

export const WARDROBE = {
  hat: {
    label: tx("Mũ"),
    items: {
      pilot: { name: tx("Mũ phi công") },
      none: { name: tx("Không đội") },
      beanie: { name: tx("Mũ len") },
      bow: { name: tx("Nơ xinh") },
      grad: { name: tx("Mũ tốt nghiệp"), need: "good3" },
      crown: { name: tx("Vương miện"), need: "sessions10" },
    } satisfies Record<HatId, WearItem>,
  },
  glasses: {
    label: tx("Kính"),
    items: {
      none: { name: tx("Không đeo") },
      round: { name: tx("Kính tròn") },
      sun: { name: tx("Kính râm") },
      star: { name: tx("Kính ngôi sao"), need: "streak7" },
    } satisfies Record<GlassesId, WearItem>,
  },
  scarf: {
    label: tx("Khăn"),
    items: {
      pink: { name: tx("Khăn hồng") },
      none: { name: tx("Không quàng") },
      blue: { name: tx("Khăn xanh") },
      yellow: { name: tx("Khăn vàng") },
      stripe: { name: tx("Khăn sọc") },
    } satisfies Record<ScarfId, WearItem>,
  },
  held: {
    label: tx("Cầm tay"),
    items: {
      page: { name: tx("Trang sách") },
      none: { name: tx("Không cầm") },
      pencil: { name: tx("Bút chì") },
      mug: { name: tx("Cốc ca cao") },
      trophy: { name: tx("Cúp vàng"), need: "perfect1" },
    } satisfies Record<HeldId, WearItem>,
  },
  cover: {
    label: tx("Màu bìa"),
    items: {
      purple: { name: tx("Tím gốc") },
      blue: { name: tx("Xanh biển") },
      pink: { name: tx("Hồng dâu") },
      mint: { name: tx("Bạc hà") },
      sun: { name: tx("Cam nắng"), need: "streak5" },
    } satisfies Record<CoverId, WearItem>,
  },
} as const;

export type WearSlot = keyof PilotOutfit;
export const WEAR_SLOTS: WearSlot[] = ["hat", "glasses", "scarf", "held", "cover"];

export function wearItem(slot: WearSlot, id: string): WearItem | undefined {
  return (WARDROBE[slot].items as Record<string, WearItem>)[id];
}

/* Đọc trang phục đã lưu; món lạ hoặc thiếu thì dùng đồ gốc */
export function normalizeOutfit(value: unknown): PilotOutfit {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const outfit = { ...DEFAULT_OUTFIT };
  for (const slot of WEAR_SLOTS) {
    const id = raw[slot];
    if (typeof id === "string" && wearItem(slot, id)) (outfit as Record<WearSlot, string>)[slot] = id;
  }
  return outfit;
}

export function usePilotOutfit(): PilotOutfit {
  const { user } = useAuth();
  return normalizeOutfit(user?.user_metadata?.sp_pilot_outfit);
}

export async function savePilotOutfit(outfit: PilotOutfit) {
  const client = getAuthClient();
  if (!client) throw new Error(tx("Chưa kết nối Supabase"));
  const { error } = await client.auth.updateUser({ data: { sp_pilot_outfit: outfit } });
  if (error) throw error;
}

const COVERS: Record<CoverId, { main: string; spine: string }> = {
  purple: { main: "#5b2a86", spine: "#4a1068" },
  blue: { main: "#5b7fe3", spine: "#4566d1" },
  pink: { main: "#e0699a", spine: "#c42a63" },
  mint: { main: "#3fae8c", spine: "#2b8a6d" },
  sun: { main: "#f0954a", spine: "#cf7228" },
};

export function coverColors(outfit: PilotOutfit) {
  return COVERS[outfit.cover];
}

/* ===== Các lớp vẽ ===== */

export function PilotHat({ outfit }: { outfit: PilotOutfit }) {
  switch (outfit.hat) {
    case "pilot":
      return (
        <>
          <path d="M62 54 Q100 14 140 54 Z" fill="#e0457b" stroke={D} strokeWidth="4" strokeLinejoin="round" />
          <rect x="80" y="40" width="40" height="13" rx="6.5" fill="#bfe3ff" stroke={D} strokeWidth="3.5" />
        </>
      );
    case "beanie":
      return (
        <>
          <path d="M60 56 Q100 6 140 56 Z" fill="#5b7fe3" stroke={D} strokeWidth="4" strokeLinejoin="round" />
          <rect x="56" y="46" width="88" height="13" rx="6.5" fill="#fff" stroke={D} strokeWidth="3.5" />
          <circle cx="100" cy="16" r="10" fill="#fff" stroke={D} strokeWidth="3.5" />
        </>
      );
    case "bow":
      return (
        <>
          <path d="M128 44 L148 30 L150 58 Z" fill="#ff8fb6" stroke={D} strokeWidth="3.5" strokeLinejoin="round" />
          <path d="M128 44 L108 30 L106 58 Z" fill="#ff8fb6" stroke={D} strokeWidth="3.5" strokeLinejoin="round" />
          <circle cx="128" cy="44" r="7" fill="#e0457b" stroke={D} strokeWidth="3" />
        </>
      );
    case "grad":
      return (
        <>
          <rect x="74" y="34" width="52" height="18" rx="4" fill="#24123a" stroke={D} strokeWidth="3" />
          <polygon points="100,14 154,30 100,46 46,30" fill="#3a2350" stroke={D} strokeWidth="3.5" strokeLinejoin="round" />
          <path d="M100 30 L142 36 L142 58" fill="none" stroke="#f6c343" strokeWidth="3" />
          <circle cx="142" cy="60" r="5" fill="#f6c343" stroke={D} strokeWidth="2" />
        </>
      );
    case "crown":
      return (
        <>
          <polygon points="66,54 66,22 83,38 100,14 117,38 134,22 134,54" fill="#f6c343" stroke={D} strokeWidth="4" strokeLinejoin="round" />
          <circle cx="100" cy="42" r="5" fill="#e0457b" stroke={D} strokeWidth="2" />
          <circle cx="80" cy="46" r="3.5" fill="#5b7fe3" />
          <circle cx="120" cy="46" r="3.5" fill="#5b7fe3" />
        </>
      );
    default:
      return null;
  }
}

function starPoints(cx: number, cy: number, r: number) {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const radius = i % 2 ? r * 0.5 : r;
    points.push(`${(cx + radius * Math.cos(angle)).toFixed(1)},${(cy + radius * Math.sin(angle)).toFixed(1)}`);
  }
  return points.join(" ");
}

export function PilotGlasses({ outfit }: { outfit: PilotOutfit }) {
  switch (outfit.glasses) {
    case "round":
      return (
        <>
          <circle cx="88" cy="87" r="15" fill="rgba(255,255,255,.15)" stroke={D} strokeWidth="3.5" />
          <circle cx="122" cy="87" r="15" fill="rgba(255,255,255,.15)" stroke={D} strokeWidth="3.5" />
          <path d="M103 86 Q105 82 107 86" fill="none" stroke={D} strokeWidth="3" />
        </>
      );
    case "sun":
      return (
        <>
          <rect x="72" y="76" width="31" height="22" rx="8" fill="#24123a" stroke={D} strokeWidth="3" />
          <rect x="107" y="76" width="31" height="22" rx="8" fill="#24123a" stroke={D} strokeWidth="3" />
          <path d="M103 84 h4" stroke={D} strokeWidth="3" />
          <path d="M78 81 l8 0 M113 81 l8 0" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" opacity=".6" />
        </>
      );
    case "star":
      return (
        <>
          <polygon points={starPoints(88, 87, 17)} fill="#ff8fb6" fillOpacity=".85" stroke={D} strokeWidth="3" strokeLinejoin="round" />
          <polygon points={starPoints(122, 87, 17)} fill="#ff8fb6" fillOpacity=".85" stroke={D} strokeWidth="3" strokeLinejoin="round" />
          <path d="M103 87 h4" stroke={D} strokeWidth="3" />
        </>
      );
    default:
      return null;
  }
}

const SCARF_COLORS: Record<ScarfId, string | null> = { pink: "#e0457b", none: null, blue: "#5b7fe3", yellow: "#f6c343", stripe: "stripe" };

export function PilotScarf({ outfit, uid }: { outfit: PilotOutfit; uid: string }) {
  const color = SCARF_COLORS[outfit.scarf];
  if (!color) return null;
  const patternId = `sp-stripe-${uid}`;
  const fill = color === "stripe" ? `url(#${patternId})` : color;
  return (
    <>
      {color === "stripe" && (
        <defs>
          <pattern id={patternId} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="10" height="10" fill="#e0457b" />
            <rect width="5" height="10" fill="#fff" />
          </pattern>
        </defs>
      )}
      <path d="M66 118 Q105 132 146 118 L146 128 Q105 142 66 128 Z" fill={fill} stroke={D} strokeWidth="3.5" strokeLinejoin="round" />
      <path d="M136 126 l16 22 l-14 -2 z" fill={fill} stroke={D} strokeWidth="3" strokeLinejoin="round" />
    </>
  );
}

/* Món cầm tay. Trang sách nhận className để giữ hiệu ứng lật trang của từng chỗ dùng. */
export function PilotHeld({ outfit, pageClassName }: { outfit: PilotOutfit; pageClassName?: string }) {
  switch (outfit.held) {
    case "page":
      return (
        <g className={pageClassName}>
          <rect x="80" y="134" width="40" height="30" rx="4" fill="#fff" stroke={D} strokeWidth="3" />
          <path d="M86 143 h28 M86 150 h22 M86 157 h26" stroke="#d5ddf8" strokeWidth="3" strokeLinecap="round" />
        </g>
      );
    case "pencil":
      return (
        <g transform="rotate(-30 100 150)">
          <rect x="70" y="142" width="54" height="14" rx="3" fill="#f6c343" stroke={D} strokeWidth="3" />
          <path d="M124 142 L140 149 L124 156 Z" fill="#fde2b8" stroke={D} strokeWidth="3" strokeLinejoin="round" />
          <rect x="62" y="142" width="10" height="14" rx="2" fill="#ff8fb6" stroke={D} strokeWidth="3" />
        </g>
      );
    case "mug":
      return (
        <>
          <rect x="84" y="138" width="30" height="26" rx="5" fill="#fff" stroke={D} strokeWidth="3" />
          <path d="M114 144 q10 0 10 7 q0 7 -10 7" fill="none" stroke={D} strokeWidth="3" />
          <rect x="88" y="142" width="22" height="6" fill="#a0673c" />
          <path d="M93 132 q-4 -6 0 -10 M103 132 q-4 -6 0 -10" fill="none" stroke="#a39db3" strokeWidth="2.5" strokeLinecap="round" />
        </>
      );
    case "trophy":
      return (
        <>
          <path d="M86 134 h28 v10 q0 14 -14 14 q-14 0 -14 -14 Z" fill="#f6c343" stroke={D} strokeWidth="3" strokeLinejoin="round" />
          <path d="M86 138 q-9 0 -9 7 q0 6 9 6 M114 138 q9 0 9 7 q0 6 -9 6" fill="none" stroke={D} strokeWidth="3" />
          <rect x="92" y="158" width="16" height="8" rx="2" fill="#c98d4f" stroke={D} strokeWidth="3" />
        </>
      );
    default:
      return null;
  }
}

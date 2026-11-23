"use client";

import { tx } from "@/lib/i18n";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { PilotGlasses, PilotHat, PilotHeld, PilotScarf, coverColors, usePilotOutfit, type PilotOutfit } from "@/components/pilot-wear";
import { IconBook, IconCheck, IconPlay } from "@/components/icons";

/*
 * Màn chờ có linh vật Pilot (quyển vở tím đội mũ phi công) và mini-game
 * "Pilot chạy deadline" để người dùng giải trí khi tải lâu.
 * - LoadingMascot: màn chờ ngắn, chỉ có Pilot.
 * - LoadingPlay: màn chờ dài, có thanh tiến độ ước lượng, 4 bước, Pilot nói chuyện và game.
 */

const SAY = [
  tx("Chào bạn! Mình đang đọc giáo trình giúp bạn đây…"),
  tx("Ồ, chương này nhiều ý hay quá, để mình đánh dấu lại."),
  tx("Mình đang chia thành từng buổi học ngắn cho dễ nhớ."),
  tx("Sắp xong rồi, đang soạn câu hỏi lồng trong tóm tắt…"),
  tx("Chờ lâu quá? Bấm \"Chơi trong lúc chờ\" để chạy cùng mình nhé!"),
];
const POKE = [
  tx("Hihi, nhột quá!"),
  tx("Bay lên nào! ✈️"),
  tx("Bạn học chăm thật đó!"),
  tx("Bấm nữa là mình chóng mặt đó nha…"),
  tx("Đếm ngược tới ngày thi, cố lên!"),
];
const TIPS = [
  tx("Mẹo: học 25 phút rồi nghỉ 5 phút giúp nhớ lâu hơn."),
  tx("Mẹo: trả lời câu hỏi lồng trước khi xem đáp án giúp nhớ gấp đôi."),
  tx("Mẹo: ôn lại phần sai sau 1–2 ngày hiệu quả hơn ôn ngay."),
  tx("Mẹo: tự giảng lại cho bạn bè là cách kiểm tra hiểu bài tốt nhất."),
];

/* ================= Linh vật ================= */

export function PilotMascot({
  size = 200,
  interactive = false,
  onPoke,
  outfit: outfitOverride,
  happy = false,
  className = "",
}: {
  size?: number;
  interactive?: boolean;
  onPoke?: (event: React.MouseEvent<SVGSVGElement>) => void;
  /* Bộ đồ để mặc thử (Nhà của Pilot); bỏ trống thì mặc bộ đã lưu của tài khoản */
  outfit?: PilotOutfit;
  happy?: boolean;
  className?: string;
}) {
  const savedOutfit = usePilotOutfit();
  const outfit = outfitOverride ?? savedOutfit;
  const cover = coverColors(outfit);
  const uid = useId().replace(/:/g, "");
  const ref = useRef<SVGSVGElement>(null);
  const [eye, setEye] = useState({ x: 0, y: 0 });
  const [jumping, setJumping] = useState(false);

  // Mắt nhìn theo con trỏ chuột
  useEffect(() => {
    if (!interactive) return;
    const move = (event: MouseEvent) => {
      const box = ref.current?.getBoundingClientRect();
      if (!box?.width) return;
      const clamp = (value: number) => Math.max(-3, Math.min(3, value));
      setEye({
        x: clamp((event.clientX - (box.left + box.width / 2)) / 60),
        y: clamp((event.clientY - (box.top + box.height * 0.43)) / 60),
      });
    };
    document.addEventListener("mousemove", move);
    return () => document.removeEventListener("mousemove", move);
  }, [interactive]);

  return (
    <svg
      ref={ref}
      viewBox="0 0 200 200"
      width={size}
      height={size}
      role={interactive ? "button" : "img"}
      aria-label={interactive ? tx("Pilot, linh vật StudyPilot. Bấm để Pilot nhảy") : tx("Pilot, linh vật StudyPilot")}
      className={`sp-pilot ${interactive ? "cursor-pointer" : ""} ${jumping ? "sp-pilot-jump" : ""} ${className}`}
      onClick={(event) => {
        if (!interactive) return;
        setJumping(false);
        requestAnimationFrame(() => setJumping(true));
        window.setTimeout(() => setJumping(false), 700);
        onPoke?.(event);
      }}
    >
      <ellipse cx="100" cy="186" rx="56" ry="8" fill="#33094a" opacity=".12" />
      <g className="sp-pilot-body">
        <rect x="48" y="48" width="104" height="126" rx="22" fill={cover.main} stroke="#33094a" strokeWidth="4" />
        <rect x="48" y="48" width="18" height="126" rx="9" fill={cover.spine} stroke="#33094a" strokeWidth="4" />
        {[72, 100, 128, 156].map((y) => (
          <circle key={y} cx="57" cy={y} r="3.5" fill="#f6c343" />
        ))}
        <PilotHat outfit={outfit} />
        <g className="sp-pilot-blink">
          <ellipse cx="88" cy="86" rx="11" ry="13" fill="#fff" stroke="#33094a" strokeWidth="3" />
          <ellipse cx="122" cy="86" rx="11" ry="13" fill="#fff" stroke="#33094a" strokeWidth="3" />
          <circle cx={90 + eye.x} cy={89 + eye.y} r="5.5" fill="#24123a" />
          <circle cx={124 + eye.x} cy={89 + eye.y} r="5.5" fill="#24123a" />
        </g>
        <ellipse cx="78" cy="106" rx="7" ry="4" fill="#ff8fb6" opacity=".7" />
        <ellipse cx="132" cy="106" rx="7" ry="4" fill="#ff8fb6" opacity=".7" />
        {jumping || happy ? (
          <path d="M94 102 Q105 118 116 102 Z" fill="#33094a" />
        ) : (
          <path d="M96 104 Q105 112 114 104" fill="none" stroke="#33094a" strokeWidth="3.5" strokeLinecap="round" />
        )}
        <PilotGlasses outfit={outfit} />
        <PilotScarf outfit={outfit} uid={uid} />
        <PilotHeld outfit={outfit} pageClassName="sp-pilot-page" />
      </g>
    </svg>
  );
}

/* Màn chờ ngắn: Pilot nhỏ cạnh dòng chữ */
export function LoadingMascot({
  text,
  sub = tx("Pilot đang lật từng trang, chờ mình xíu nhé!"),
  className = "max-w-5xl",
  bare = false,
}: {
  text: string;
  sub?: string;
  className?: string;
  /* bare: không viền/bóng, dùng bên trong một thẻ đã có sẵn */
  bare?: boolean;
}) {
  return (
    <div
      className={`grid grid-cols-[96px_minmax(0,1fr)] items-center gap-5 ${
        bare
          ? "rounded-2xl bg-[var(--sp-surface-2)] px-5 py-4"
          : "mx-auto rounded-[24px] border-2 border-[var(--sp-purple-deep)] bg-white px-6 py-5 shadow-[6px_6px_0_var(--sp-lav-line)]"
      } ${className}`}
      role="status"
    >
      <PilotMascot size={96} />
      <div>
        <p className="text-base font-extrabold text-[var(--sp-ink)]">{text}</p>
        <p className="mt-0.5 text-sm text-[var(--sp-muted)]">{sub}</p>
      </div>
    </div>
  );
}

/* ================= Màn chờ hai chặng ================= */

const WAIT_SAYS = [
  tx("Mình vẫn đang làm nè, sắp xong rồi!"),
  tx("Mạng hơi chậm, để mình chạy nhanh hơn chút…"),
  tx("Chơi một ván đi, xong là mình gọi liền!"),
];
const SWITCH_AFTER_MS = 3000;
const SMART_EXPECTED_S = 12;

/*
 * 3 giây đầu: màn chờ ngắn (Pilot nhỏ + câu chữ của trang).
 * Quá 3 giây: thẻ nở ra, Pilot nhảy vào khung game "Pilot chạy deadline".
 * Tải xong: chưa chơi thì tự vào trang; đang chơi thì dừng game, chờ người dùng bấm.
 * Trang hiển thị: if (loading || hold) return <SmartLoading done={!loading} onHoldChange={setHold} … />
 */
export function SmartLoading({
  text,
  sub = tx("Pilot đang lật từng trang, chờ mình xíu nhé!"),
  stages,
  continueLabel = "Xem ngay",
  done = false,
  onHoldChange,
}: {
  text: string;
  sub?: string;
  /* 4 bước hiện ở màn chờ dài */
  stages: string[];
  continueLabel?: string;
  done?: boolean;
  /* true khi đã sang màn game: trang giữ màn chờ tới khi gọi lại false */
  onHoldChange?: (hold: boolean) => void;
}) {
  const [long, setLong] = useState(false);
  const [played, setPlayed] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const miniRef = useRef<HTMLDivElement>(null);
  const before = useRef<{ height: number; pilot: DOMRect | null; svg: string }>({ height: 0, pilot: null, svg: "" });
  const holdRef = useRef(onHoldChange);
  useEffect(() => {
    holdRef.current = onHoldChange;
  }, [onHoldChange]);

  useEffect(() => {
    if (done || long) return;
    const id = window.setTimeout(() => {
      const pilot = miniRef.current?.querySelector("svg");
      before.current = {
        height: wrapRef.current?.offsetHeight || 0,
        pilot: pilot?.getBoundingClientRect() || null,
        svg: pilot?.outerHTML || "",
      };
      setLong(true);
      holdRef.current?.(true);
    }, SWITCH_AFTER_MS);
    return () => window.clearTimeout(id);
  }, [done, long]);

  // Tải xong mà chưa bấm chơi: báo xong một nhịp rồi tự vào trang
  useEffect(() => {
    if (!long || !done || played) return;
    const id = window.setTimeout(() => holdRef.current?.(false), 700);
    return () => window.clearTimeout(id);
  }, [long, done, played]);

  // Bỏ giữ nếu màn chờ bị gỡ giữa chừng
  useEffect(() => () => holdRef.current?.(false), []);

  // Chuyển cảnh: thẻ nở chiều cao, Pilot bay vòng cung vào chỗ xuất phát trong game
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!long || !wrap) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const { height, pilot, svg } = before.current;
    const target = wrap.scrollHeight;
    wrap.style.height = `${height}px`;
    void wrap.offsetHeight;
    wrap.style.height = `${target}px`;
    const clear = window.setTimeout(() => (wrap.style.height = ""), 600);

    let clone: HTMLDivElement | null = null;
    const canvas = wrap.querySelector("canvas");
    if (pilot && svg && canvas) {
      clone = document.createElement("div");
      clone.innerHTML = svg;
      clone.className = "pointer-events-none fixed z-50 [&>svg]:h-full [&>svg]:w-full";
      document.body.appendChild(clone);
      const box = canvas.getBoundingClientRect();
      // nội dung bên trong đã ở vị trí cuối, chỉ khung ngoài đang nở chiều cao
      // khớp vị trí xuất phát của Pilot trong RunnerGame (p.x = 64, cao 40)
      const size = PILOT_RUN_SIZE;
      const toLeft = box.left + 64 - size * 0.24;
      const toTop = box.top + (box.height - 38) - 40 - size * 0.24;
      const peak = Math.min(pilot.top, toTop) - 70;
      const mid = (pilot.width + size) / 2;
      clone.animate(
        [
          { left: `${pilot.left}px`, top: `${pilot.top}px`, width: `${pilot.width}px`, height: `${pilot.height}px`, transform: "rotate(0deg)" },
          { left: `${(pilot.left + toLeft) / 2}px`, top: `${peak}px`, width: `${mid}px`, height: `${mid}px`, transform: "rotate(-12deg)", offset: 0.5 },
          { left: `${toLeft}px`, top: `${toTop}px`, width: `${size}px`, height: `${size}px`, transform: "rotate(0deg)" },
        ],
        { duration: 900, easing: "cubic-bezier(.35,0,.25,1)", fill: "forwards" }
      ).onfinish = () => {
        clone?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: "forwards" }).finished.then(() => clone?.remove());
      };
    }
    return () => {
      window.clearTimeout(clear);
      clone?.remove();
    };
  }, [long]);

  return (
    <div ref={wrapRef} className={`mx-auto max-w-[908px] overflow-hidden pb-2 pr-2 transition-[height] duration-500 ease-[cubic-bezier(.3,1.1,.4,1)] ${long ? "sp-smart-long" : ""}`}>
      {long ? (
        <LoadingPlay
          kicker={done ? tx("Cảm ơn bạn đã chờ") : tx("Hơi lâu một chút… chạy cùng Pilot nhé!")}
          title={text}
          doneTitle={tx("Xong rồi!")}
          stages={stages}
          expectedSeconds={SMART_EXPECTED_S}
          startAt={SWITCH_AFTER_MS / 1000}
          startInGame
          says={WAIT_SAYS}
          doneNote={tx("Đã xong!")}
          done={done}
          continueLabel={continueLabel}
          onGameStart={() => setPlayed(true)}
          onContinue={() => holdRef.current?.(false)}
        />
      ) : (
        <div
          className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-5 rounded-[24px] border-2 border-[var(--sp-purple-deep)] bg-white px-6 py-5 shadow-[6px_6px_0_var(--sp-lav-line)]"
          role="status"
        >
          <div ref={miniRef}>
            <PilotMascot size={96} />
          </div>
          <div className="min-w-0">
            <p className="text-base font-extrabold text-[var(--sp-ink)]">
              {text}
              <span className="sp-wait-dots ml-1 inline-flex gap-[3px] align-middle" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </p>
            <p className="mt-0.5 text-sm text-[var(--sp-muted)]">{sub}</p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--sp-surface-2)]">
              <span
                className="sp-thin-fill block h-full rounded-full bg-[var(--sp-peri)]"
                style={{ "--to": `${95 * (1 - Math.exp(-(SWITCH_AFTER_MS / 1000) / (SMART_EXPECTED_S / 2.5)))}%` } as React.CSSProperties}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================= Màn chờ dài ================= */

export function LoadingPlay({
  kicker = tx("AI đang chia nhỏ giáo trình cho bạn"),
  title,
  doneTitle = tx("Tài liệu đã sẵn sàng"),
  stages,
  stage,
  expectedSeconds = 30,
  done = false,
  continueLabel = tx("Vào học ngay"),
  onContinue,
  onPlayingChange,
  startInGame = false,
  startAt = 0,
  says = SAY,
  doneNote = tx("Tài liệu đã sẵn sàng!"),
  onGameStart,
}: {
  kicker?: string;
  title: string;
  doneTitle?: string;
  stages: string[];
  /* Bước thật đang chạy (nếu trang biết); không có thì ước lượng theo thời gian */
  stage?: number;
  expectedSeconds?: number;
  done?: boolean;
  continueLabel?: string;
  onContinue?: () => void;
  onPlayingChange?: (playing: boolean) => void;
  /* mở thẳng khung game thay vì khung Pilot nói chuyện */
  startInGame?: boolean;
  /* số giây đã chờ trước đó, để thanh tiến độ chạy tiếp chứ không về 0 */
  startAt?: number;
  says?: string[];
  doneNote?: string;
  /* người dùng bấm bắt đầu một ván */
  onGameStart?: () => void;
}) {
  const [progress, setProgress] = useState(0);
  const [sayIndex, setSayIndex] = useState(0);
  const [pokeText, setPokeText] = useState<string | null>(null);
  const [tipIndex, setTipIndex] = useState(0);
  const [playing, setPlaying] = useState(startInGame);
  const [sparks, setSparks] = useState<{ id: number; x: number; y: number; dx: number; dy: number }[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const stageStart = useRef<{ stage: number | undefined; at: number }>({ stage: undefined, at: 0 });
  const pokeCount = useRef(0);

  // Tiến độ ước lượng: tiến dần tới 95% rồi chờ backend xong mới lên 100%.
  useEffect(() => {
    if (done) return;
    const started = performance.now() - startAt * 1000;
    const timer = window.setInterval(() => {
      const now = performance.now();
      if (stage === undefined) {
        setProgress(95 * (1 - Math.exp(-(now - started) / 1000 / (expectedSeconds / 2.5))));
        return;
      }
      if (stageStart.current.stage !== stage) stageStart.current = { stage, at: now };
      const inStage = (now - stageStart.current.at) / 1000;
      const span = 100 / stages.length;
      setProgress(Math.min(95, stage * span + (span - 2) * (1 - Math.exp(-inStage / (expectedSeconds / stages.length)))));
    }, 200);
    return () => window.clearInterval(timer);
  }, [done, stage, stages.length, expectedSeconds, startAt]);

  useEffect(() => {
    const talk = window.setInterval(() => {
      setPokeText(null);
      setSayIndex((value) => (value + 1) % says.length);
    }, 6000);
    const tip = window.setInterval(() => setTipIndex((value) => (value + 1) % TIPS.length), 8000);
    return () => {
      window.clearInterval(talk);
      window.clearInterval(tip);
    };
  }, [says.length]);

  const shown = done ? 100 : progress;
  const current = done ? stages.length : stage ?? Math.min(stages.length - 1, Math.floor(shown / (100 / stages.length)));
  const speech = done ? tx("Xong rồi! Vào thôi nào 🎉") : pokeText ?? says[sayIndex % says.length];

  const togglePlaying = () => {
    const next = !playing;
    setPlaying(next);
    onPlayingChange?.(next);
  };

  const poke = (event: React.MouseEvent<SVGSVGElement>) => {
    setPokeText(POKE[pokeCount.current++ % POKE.length]);
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    const fresh = Array.from({ length: 7 }, (_, index) => ({
      id: Date.now() + index,
      x: event.clientX - box.left,
      y: event.clientY - box.top,
      dx: Math.random() * 120 - 60,
      dy: -Math.random() * 90 - 20,
    }));
    setSparks((list) => [...list, ...fresh]);
    window.setTimeout(() => setSparks((list) => list.filter((spark) => !fresh.includes(spark))), 900);
  };

  return (
    <section
      className="mx-auto max-w-[900px] rounded-[24px] border-2 border-[var(--sp-purple-deep)] bg-white px-5 py-6 shadow-[6px_6px_0_var(--sp-lav-line)] sm:px-7"
      role="status"
      aria-live="polite"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div>
          <p className="sp-accent text-[17px] text-[var(--sp-pink)]">{kicker}</p>
          <h2 className="text-[22px] text-[var(--sp-ink)]">{done ? doneTitle : title}</h2>
        </div>
        <p className="text-[26px] font-extrabold text-[var(--sp-purple)]">{Math.floor(shown)}%</p>
      </div>

      <div className="relative mt-3.5 h-3.5 overflow-hidden rounded-full border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-surface-2)]">
        <span className="sp-loading-stripes absolute inset-y-0 left-0 transition-[width] duration-300" style={{ width: `${shown}%` }} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stages.map((label, index) => (
          <p
            key={label}
            className={`grid grid-cols-[16px_minmax(0,1fr)] items-center gap-1.5 text-[12.5px] font-bold ${
              index < current ? "text-emerald-600" : index === current ? "text-[var(--sp-peri-dark)]" : "text-[var(--sp-soft)]"
            }`}
          >
            {index < current ? (
              <IconCheck size={15} />
            ) : (
              <span className={`h-2.5 w-2.5 justify-self-center rounded-full ${index === current ? "sp-twinkle bg-[var(--sp-peri)]" : "bg-[var(--sp-line)]"}`} />
            )}
            {label}
          </p>
        ))}
      </div>

      <div
        ref={boxRef}
        className="sp-loading-box relative mt-5 h-[300px] overflow-hidden rounded-[20px] border-2 border-dashed border-[var(--sp-lav-line)] sm:h-[260px]"
      >
        {playing ? (
          <RunnerGame paused={done} onStart={onGameStart} pauseText={tx("{0} Bấm để chơi tiếp hoặc vào ngay.", [doneNote])} />
        ) : (
          <div className="grid h-full grid-cols-1 items-center gap-1.5 p-3 sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-6 sm:px-7">
            <div className="justify-self-center">
              <PilotMascot size={170} interactive onPoke={poke} />
            </div>
            <div>
              <div className="sp-loading-bubble relative rounded-[18px] border-2 border-[var(--sp-purple-deep)] bg-white px-4 py-3.5 shadow-[4px_4px_0_var(--sp-pink-line)]">
                <span className="block text-[12px] font-extrabold uppercase tracking-wide text-[var(--sp-pink)]">Pilot</span>
                <span className="text-[15px] font-semibold leading-relaxed text-[var(--sp-ink)]">{speech}</span>
              </div>
              <p className="mt-3.5 grid grid-cols-[18px_minmax(0,1fr)] gap-2 text-[13px] text-[var(--sp-muted)]">
                <span className="text-[var(--sp-yellow)]">✦</span>
                {TIPS[tipIndex]}
              </p>
            </div>
          </div>
        )}
        {sparks.map((spark) => (
          <span
            key={spark.id}
            className="sp-spark pointer-events-none absolute text-[18px] text-[var(--sp-yellow)]"
            style={{ left: spark.x, top: spark.y, "--dx": `${spark.dx}px`, "--dy": `${spark.dy}px` } as React.CSSProperties}
          >
            ★
          </span>
        ))}
      </div>

      {done && (
        <p className="mt-3.5 grid grid-cols-[22px_minmax(0,1fr)] items-center gap-2.5 rounded-[14px] border-2 border-[#a7e3c4] bg-emerald-50 px-3.5 py-3 text-sm font-bold text-emerald-700">
          <IconCheck size={20} />
          {playing ? tx("{0} Game đã tạm dừng, bạn có thể vào ngay hoặc chơi tiếp.", [doneNote]) : doneNote}
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <button type="button" onClick={togglePlaying} className="sp-btn sp-btn-secondary h-[46px] text-sm">
          {playing ? tx("☺ Quay lại xem Pilot") : tx("🎮 Chơi trong lúc chờ")}
        </button>
        <button
          type="button"
          disabled={!done}
          onClick={onContinue}
          className={`sp-btn sp-btn-primary h-[46px] text-sm ${done ? "!bg-emerald-500" : ""}`}
        >
          <IconBook size={16} />
          {continueLabel}
        </button>
      </div>
    </section>
  );
}

/* ================= Game "Pilot chạy deadline" ================= */

type Obstacle = { kind: "books" | "clock" | "grade"; x: number; w: number; h: number };
type Star = { x: number; y: number; got?: boolean };

const BEST_KEY = "sp-runner-best";
const PILOT_RUN_SIZE = 66;
const readBest = () => {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
};
const saveBest = (value: number) => {
  try {
    localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // trình duyệt chặn lưu trữ: bỏ qua, chỉ mất kỷ lục
  }
};

function RunnerGame({
  paused,
  onStart,
  pauseText = tx("Tài liệu đã sẵn sàng. Bấm để chơi tiếp hoặc vào học ngay."),
}: {
  paused: boolean;
  onStart?: () => void;
  pauseText?: string;
}) {
  const hooks = useRef({ onStart, pauseText });
  useEffect(() => {
    hooks.current = { onStart, pauseText };
  }, [onStart, pauseText]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runnerRef = useRef<HTMLDivElement>(null);
  const scoreRef = useRef<HTMLSpanElement>(null);
  const [best, setBest] = useState(readBest);
  const [overlay, setOverlay] = useState<{ title: string; text: string; label: string } | null>({
    title: tx("Pilot chạy deadline"),
    text: tx("Nhảy qua chồng sách và đồng hồ, nhặt ngôi sao vàng."),
    label: tx("Bắt đầu"),
  });
  const engine = useRef<{ start: () => void; pause: () => void; jump: () => void; running: () => boolean } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let W = 0;
    let H = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      W = rect.width;
      H = rect.height;
      canvas.width = W * ratio;
      canvas.height = H * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    let running = false;
    let raf = 0;
    let last = 0;
    let p = { x: 64, y: 0, vy: 0, w: 34, h: 40, onGround: true, leg: 0 };
    let obstacles: Obstacle[] = [];
    let stars: Star[] = [];
    let speed = 300;
    let score = 0;
    let spawn = 1.1;
    let starTimer = 2;
    let t = 0;
    let alive = true;

    const reset = () => {
      p = { x: 64, y: 0, vy: 0, w: 34, h: 40, onGround: true, leg: 0 };
      obstacles = [];
      stars = [];
      speed = 300;
      score = 0;
      spawn = 1.1;
      starTimer = 2;
      t = 0;
      alive = true;
      if (scoreRef.current) scoreRef.current.textContent = "0";
    };
    const ground = () => H - 38;

    const box = (x: number, y: number, w: number, h: number, r: number, fill: string) => {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#33094a";
      ctx.stroke();
    };
    // Pilot là SVG thật (mặc bộ đồ đã lưu) đặt đè lên canvas; thân sách 104 đơn vị khớp hộp va chạm p.w
    const drawPilot = (g: number) => {
      const runner = runnerRef.current;
      if (!runner) return;
      const k = PILOT_RUN_SIZE / 200;
      const bounce = p.onGround ? -Math.abs(Math.sin(p.leg)) * 3 : 0;
      const tilt = p.onGround ? Math.sin(p.leg) * 4 : -8;
      runner.style.visibility = alive ? "visible" : "hidden";
      runner.style.transform = `translate(${p.x - 48 * k}px, ${g - p.h + p.y - 48 * k + bounce}px) rotate(${tilt}deg)`;
    };
    const drawObstacle = (o: Obstacle, g: number) => {
      const y = g - o.h;
      if (o.kind === "books") {
        const colors = ["#5b7fe3", "#f6c343", "#e0457b", "#10b981"];
        const n = Math.round(o.h / 13);
        for (let i = 0; i < n; i++) box(o.x + (i % 2 ? 3 : 0), g - (i + 1) * (o.h / n), o.w - 3, o.h / n, 3, colors[i % 4]);
      } else if (o.kind === "clock") {
        ctx.beginPath();
        ctx.arc(o.x + 15, y + 16, 14, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = "#33094a";
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(o.x + 15, y + 16);
        ctx.lineTo(o.x + 15, y + 8);
        ctx.moveTo(o.x + 15, y + 16);
        ctx.lineTo(o.x + 21, y + 18);
        ctx.stroke();
        ctx.fillStyle = "#e0457b";
        ctx.beginPath();
        ctx.arc(o.x + 5, y + 3, 5, 0, Math.PI * 2);
        ctx.arc(o.x + 25, y + 3, 5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        box(o.x, y, o.w, o.h, 4, "#fff");
        ctx.fillStyle = "#d93a3a";
        ctx.font = "800 22px 'Be Vietnam Pro', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("F", o.x + o.w / 2, y + 26);
      }
    };
    const drawStar = (x: number, y: number) => {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const angle = -Math.PI / 2 + (i * Math.PI) / 5;
        const radius = i % 2 ? 4 : 9;
        ctx.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
      }
      ctx.closePath();
      ctx.fillStyle = "#f6c343";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#33094a";
      ctx.stroke();
    };
    const draw = () => {
      const g = ground();
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = "#33094a";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, g + 1);
      ctx.lineTo(W, g + 1);
      ctx.stroke();
      ctx.strokeStyle = "#d5ddf8";
      ctx.setLineDash([8, 14]);
      ctx.lineDashOffset = (t * speed) % 22;
      ctx.beginPath();
      ctx.moveTo(0, g + 14);
      ctx.lineTo(W, g + 14);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const star of stars) drawStar(star.x, g - star.y);
      for (const obstacle of obstacles) drawObstacle(obstacle, g);
      drawPilot(g);
    };

    const gameOver = () => {
      running = false;
      alive = false;
      cancelAnimationFrame(raf);
      const final = Math.floor(score);
      const previous = readBest();
      if (final > previous) {
        saveBest(final);
        setBest(final);
      }
      setOverlay({
        title: tx("Ối, vấp rồi!"),
        text: tx("Bạn được {0} điểm{1}", [final, final > previous ? tx(" · kỷ lục mới!") : ""]),
        label: tx("Chơi lại"),
      });
    };

    const update = (dt: number) => {
      const g = ground();
      t += dt;
      speed += dt * 6;
      score += (dt * speed) / 30;
      p.vy += 1800 * dt;
      p.y += p.vy * dt;
      if (p.y >= 0) {
        p.y = 0;
        p.vy = 0;
        p.onGround = true;
      }
      p.leg += (dt * speed) / 22;
      spawn -= dt;
      if (spawn <= 0) {
        const kind = (["books", "clock", "grade"] as const)[Math.floor(Math.random() * 3)];
        const size =
          kind === "books"
            ? { w: 30, h: 26 + Math.floor(Math.random() * 2) * 14 }
            : kind === "clock"
              ? { w: 30, h: 30 }
              : { w: 28, h: 36 };
        obstacles.push({ kind, x: W + 20, ...size });
        spawn = 0.9 + Math.random() * 0.9 - Math.min(0.4, t / 120);
      }
      starTimer -= dt;
      if (starTimer <= 0) {
        stars.push({ x: W + 20, y: 70 + Math.random() * 50 });
        starTimer = 2.5 + Math.random() * 2;
      }
      for (const obstacle of obstacles) obstacle.x -= speed * dt;
      for (const star of stars) star.x -= speed * dt;
      obstacles = obstacles.filter((obstacle) => obstacle.x > -50);
      stars = stars.filter((star) => star.x > -30 && !star.got);
      const px = p.x + 6;
      const py = g - p.h + p.y + 4;
      const pw = p.w - 12;
      const ph = p.h - 6;
      for (const obstacle of obstacles) {
        if (px < obstacle.x + obstacle.w - 4 && px + pw > obstacle.x + 4 && py + ph > g - obstacle.h + 4) {
          gameOver();
          return;
        }
      }
      for (const star of stars) {
        if (Math.abs(px + pw / 2 - star.x) < 22 && Math.abs(py + ph / 2 - (g - star.y)) < 28) {
          star.got = true;
          score += 25;
        }
      }
      if (scoreRef.current) scoreRef.current.textContent = String(Math.floor(score));
    };

    const loop = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      update(dt);
      draw();
      if (running) raf = requestAnimationFrame(loop);
    };

    engine.current = {
      start: () => {
        if (!alive) reset();
        running = true;
        hooks.current.onStart?.();
        setOverlay(null);
        last = performance.now();
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(loop);
      },
      pause: () => {
        if (!running) return;
        running = false;
        cancelAnimationFrame(raf);
        setOverlay({ title: tx("Tạm dừng"), text: hooks.current.pauseText, label: tx("Chơi tiếp") });
      },
      jump: () => {
        if (running && p.onGround) {
          p.vy = -620;
          p.onGround = false;
        }
      },
      running: () => running,
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space" && event.code !== "ArrowUp") return;
      event.preventDefault();
      if (engine.current?.running()) engine.current.jump();
      else engine.current?.start();
    };
    document.addEventListener("keydown", onKey);
    reset();
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("keydown", onKey);
      engine.current = null;
    };
  }, []);

  // Tải xong khi đang chơi: tạm dừng, không tự đóng game
  useEffect(() => {
    if (paused) engine.current?.pause();
  }, [paused]);

  return (
    <div className="absolute inset-0">
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-pointer touch-manipulation"
        onPointerDown={() => engine.current?.jump()}
        aria-label={tx("Game Pilot chạy deadline: bấm hoặc nhấn phím cách để nhảy")}
      />
      <div ref={runnerRef} className="pointer-events-none absolute left-0 top-0 origin-[50%_85%] will-change-transform" aria-hidden="true">
        <PilotMascot size={PILOT_RUN_SIZE} className="sp-pilot-still" />
      </div>
      <div className="absolute right-3.5 top-3 flex gap-2">
        <span className="rounded-full border-2 border-[var(--sp-purple-deep)] bg-white px-3 py-0.5 text-[13px] font-extrabold shadow-[2px_2px_0_var(--sp-purple-deep)]">
          <span ref={scoreRef}>0</span>
        </span>
        <span className="rounded-full border-2 border-[var(--sp-purple-deep)] bg-white px-3 py-0.5 text-[13px] font-extrabold shadow-[2px_2px_0_var(--sp-purple-deep)]">
          {tx("Kỷ lục {0}", [best])}
        </span>
      </div>
      {overlay && (
        <div className="sp-game-overlay absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-[rgba(251,248,241,0.85)] px-4 text-center">
          <p className="font-display text-[30px] text-[var(--sp-purple)]">{overlay.title}</p>
          <p className="text-sm text-[var(--sp-text-2)]">{overlay.text}</p>
          <p className="text-sm text-[var(--sp-text-2)]">
            <span className="rounded-lg border-2 border-b-4 border-[var(--sp-purple-deep)] bg-white px-2 text-xs font-extrabold">Space</span>{" "}

            {tx("hoặc chạm / bấm vào khung để nhảy")}
          </p>
          <button type="button" onClick={() => engine.current?.start()} className="sp-btn sp-btn-primary mt-1.5 h-[46px] w-[200px] text-sm">
            <IconPlay size={16} />
            {overlay.label}
          </button>
        </div>
      )}
    </div>
  );
}

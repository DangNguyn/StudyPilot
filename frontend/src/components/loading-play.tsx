"use client";

import { useEffect, useRef, useState } from "react";
import { IconBook, IconCheck, IconPlay } from "@/components/icons";

/*
 * Màn chờ có linh vật Pilot (quyển vở tím đội mũ phi công) và mini-game
 * "Pilot chạy deadline" để người dùng giải trí khi tải lâu.
 * - LoadingMascot: màn chờ ngắn, chỉ có Pilot.
 * - LoadingPlay: màn chờ dài, có thanh tiến độ ước lượng, 4 bước, Pilot nói chuyện và game.
 */

const SAY = [
  "Chào bạn! Mình đang đọc giáo trình giúp bạn đây…",
  "Ồ, chương này nhiều ý hay quá, để mình đánh dấu lại.",
  "Mình đang chia thành từng buổi học ngắn cho dễ nhớ.",
  "Sắp xong rồi, đang soạn câu hỏi lồng trong tóm tắt…",
  "Chờ lâu quá? Bấm \"Chơi trong lúc chờ\" để chạy cùng mình nhé!",
];
const POKE = [
  "Hihi, nhột quá!",
  "Bay lên nào! ✈️",
  "Bạn học chăm thật đó!",
  "Bấm nữa là mình chóng mặt đó nha…",
  "Đếm ngược tới ngày thi, cố lên!",
];
const TIPS = [
  "Mẹo: học 25 phút rồi nghỉ 5 phút giúp nhớ lâu hơn.",
  "Mẹo: trả lời câu hỏi lồng trước khi xem đáp án giúp nhớ gấp đôi.",
  "Mẹo: ôn lại phần sai sau 1–2 ngày hiệu quả hơn ôn ngay.",
  "Mẹo: tự giảng lại cho bạn bè là cách kiểm tra hiểu bài tốt nhất.",
];

/* ================= Linh vật ================= */

export function PilotMascot({
  size = 200,
  interactive = false,
  onPoke,
}: {
  size?: number;
  interactive?: boolean;
  onPoke?: (event: React.MouseEvent<SVGSVGElement>) => void;
}) {
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
      aria-label={interactive ? "Pilot, linh vật StudyPilot. Bấm để Pilot nhảy" : "Pilot, linh vật StudyPilot"}
      className={`sp-pilot ${interactive ? "cursor-pointer" : ""} ${jumping ? "sp-pilot-jump" : ""}`}
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
        <rect x="48" y="48" width="104" height="126" rx="22" fill="#5b2a86" stroke="#33094a" strokeWidth="4" />
        <rect x="48" y="48" width="18" height="126" rx="9" fill="#4a1068" stroke="#33094a" strokeWidth="4" />
        {[72, 100, 128, 156].map((y) => (
          <circle key={y} cx="57" cy={y} r="3.5" fill="#f6c343" />
        ))}
        <path d="M62 54 Q100 14 140 54 Z" fill="#e0457b" stroke="#33094a" strokeWidth="4" strokeLinejoin="round" />
        <rect x="80" y="40" width="40" height="13" rx="6.5" fill="#bfe3ff" stroke="#33094a" strokeWidth="3.5" />
        <g className="sp-pilot-blink">
          <ellipse cx="88" cy="86" rx="11" ry="13" fill="#fff" stroke="#33094a" strokeWidth="3" />
          <ellipse cx="122" cy="86" rx="11" ry="13" fill="#fff" stroke="#33094a" strokeWidth="3" />
          <circle cx={90 + eye.x} cy={89 + eye.y} r="5.5" fill="#24123a" />
          <circle cx={124 + eye.x} cy={89 + eye.y} r="5.5" fill="#24123a" />
        </g>
        <ellipse cx="78" cy="106" rx="7" ry="4" fill="#ff8fb6" opacity=".7" />
        <ellipse cx="132" cy="106" rx="7" ry="4" fill="#ff8fb6" opacity=".7" />
        {jumping ? (
          <path d="M94 102 Q105 118 116 102 Z" fill="#33094a" />
        ) : (
          <path d="M96 104 Q105 112 114 104" fill="none" stroke="#33094a" strokeWidth="3.5" strokeLinecap="round" />
        )}
        <path d="M66 118 Q105 132 146 118 L146 128 Q105 142 66 128 Z" fill="#e0457b" stroke="#33094a" strokeWidth="3.5" strokeLinejoin="round" />
        <path d="M136 126 l16 22 l-14 -2 z" fill="#e0457b" stroke="#33094a" strokeWidth="3" strokeLinejoin="round" />
        <g className="sp-pilot-page">
          <rect x="80" y="134" width="40" height="30" rx="4" fill="#fff" stroke="#33094a" strokeWidth="3" />
          <path d="M86 143 h28 M86 150 h22 M86 157 h26" stroke="#d5ddf8" strokeWidth="3" strokeLinecap="round" />
        </g>
      </g>
    </svg>
  );
}

/* Màn chờ ngắn: Pilot nhỏ cạnh dòng chữ */
export function LoadingMascot({
  text,
  sub = "Pilot đang lật từng trang, chờ mình xíu nhé!",
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

/* ================= Màn chờ dài ================= */

export function LoadingPlay({
  kicker = "AI đang chia nhỏ giáo trình cho bạn",
  title,
  doneTitle = "Tài liệu đã sẵn sàng",
  stages,
  stage,
  expectedSeconds = 30,
  done = false,
  continueLabel = "Vào học ngay",
  onContinue,
  onPlayingChange,
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
}) {
  const [progress, setProgress] = useState(0);
  const [sayIndex, setSayIndex] = useState(0);
  const [pokeText, setPokeText] = useState<string | null>(null);
  const [tipIndex, setTipIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sparks, setSparks] = useState<{ id: number; x: number; y: number; dx: number; dy: number }[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const stageStart = useRef<{ stage: number | undefined; at: number }>({ stage: undefined, at: 0 });
  const pokeCount = useRef(0);

  // Tiến độ ước lượng: tiến dần tới 95% rồi chờ backend xong mới lên 100%.
  useEffect(() => {
    if (done) return;
    const started = performance.now();
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
  }, [done, stage, stages.length, expectedSeconds]);

  useEffect(() => {
    const talk = window.setInterval(() => {
      setPokeText(null);
      setSayIndex((value) => (value + 1) % SAY.length);
    }, 6000);
    const tip = window.setInterval(() => setTipIndex((value) => (value + 1) % TIPS.length), 8000);
    return () => {
      window.clearInterval(talk);
      window.clearInterval(tip);
    };
  }, []);

  const shown = done ? 100 : progress;
  const current = done ? stages.length : stage ?? Math.min(stages.length - 1, Math.floor(shown / (100 / stages.length)));
  const speech = done ? "Xong rồi! Vào học thôi nào 🎉" : pokeText ?? SAY[sayIndex];

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
          <RunnerGame paused={done} />
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
          {playing ? "Tài liệu đã sẵn sàng! Game đã tạm dừng, bạn có thể vào học hoặc chơi tiếp." : "Tài liệu đã sẵn sàng!"}
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <button type="button" onClick={togglePlaying} className="sp-btn sp-btn-secondary h-[46px] text-sm">
          {playing ? "☺ Quay lại xem Pilot" : "🎮 Chơi trong lúc chờ"}
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

function RunnerGame({ paused }: { paused: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scoreRef = useRef<HTMLSpanElement>(null);
  const [best, setBest] = useState(readBest);
  const [overlay, setOverlay] = useState<{ title: string; text: string; label: string } | null>({
    title: "Pilot chạy deadline",
    text: "Nhảy qua chồng sách và đồng hồ, nhặt ngôi sao vàng.",
    label: "Bắt đầu",
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
    const drawPilot = (g: number) => {
      const x = p.x;
      const y = g - p.h + p.y;
      const step = p.onGround ? Math.sin(p.leg) * 5 : 3;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#33094a";
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x + 11, y + p.h - 3);
      ctx.lineTo(x + 11 + step, y + p.h + 6);
      ctx.moveTo(x + 23, y + p.h - 3);
      ctx.lineTo(x + 23 - step, y + p.h + 6);
      ctx.stroke();
      box(x, y, p.w, p.h - 2, 8, "#5b2a86");
      box(x, y, 7, p.h - 2, 4, "#4a1068");
      ctx.beginPath();
      ctx.moveTo(x + 4, y + 2);
      ctx.quadraticCurveTo(x + 17, y - 14, x + 31, y + 2);
      ctx.closePath();
      ctx.fillStyle = "#e0457b";
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.ellipse(x + 15, y + 13, 4.5, 5.5, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 26, y + 13, 4.5, 5.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.fillStyle = "#24123a";
      ctx.beginPath();
      ctx.arc(x + 16.5, y + 14, 2.2, 0, Math.PI * 2);
      ctx.arc(x + 27.5, y + 14, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#e0457b";
      ctx.fillRect(x + 7, y + 24, p.w - 7, 5);
      ctx.beginPath();
      ctx.moveTo(x + 7, y + 26);
      ctx.lineTo(x - 8, y + 22 + Math.sin(p.leg * 1.5) * 3);
      ctx.lineTo(x - 6, y + 31);
      ctx.closePath();
      ctx.fill();
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
      if (alive) drawPilot(g);
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
        title: "Ối, vấp rồi!",
        text: `Bạn được ${final} điểm${final > previous ? " · kỷ lục mới!" : ""}`,
        label: "Chơi lại",
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
        setOverlay(null);
        last = performance.now();
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(loop);
      },
      pause: () => {
        if (!running) return;
        running = false;
        cancelAnimationFrame(raf);
        setOverlay({ title: "Tạm dừng", text: "Tài liệu đã sẵn sàng. Bấm để chơi tiếp hoặc vào học ngay.", label: "Chơi tiếp" });
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
        aria-label="Game Pilot chạy deadline: bấm hoặc nhấn phím cách để nhảy"
      />
      <div className="absolute right-3.5 top-3 flex gap-2">
        <span className="rounded-full border-2 border-[var(--sp-purple-deep)] bg-white px-3 py-0.5 text-[13px] font-extrabold shadow-[2px_2px_0_var(--sp-purple-deep)]">
          <span ref={scoreRef}>0</span>
        </span>
        <span className="rounded-full border-2 border-[var(--sp-purple-deep)] bg-white px-3 py-0.5 text-[13px] font-extrabold shadow-[2px_2px_0_var(--sp-purple-deep)]">
          Kỷ lục {best}
        </span>
      </div>
      {overlay && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-[rgba(251,248,241,0.85)] px-4 text-center">
          <p className="font-display text-[30px] text-[var(--sp-purple)]">{overlay.title}</p>
          <p className="text-sm text-[var(--sp-text-2)]">{overlay.text}</p>
          <p className="text-sm text-[var(--sp-text-2)]">
            <span className="rounded-lg border-2 border-b-4 border-[var(--sp-purple-deep)] bg-white px-2 text-xs font-extrabold">Space</span>{" "}
            hoặc chạm / bấm vào khung để nhảy
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

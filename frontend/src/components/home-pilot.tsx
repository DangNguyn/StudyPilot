"use client";

import { tx } from "@/lib/i18n";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { PilotGlasses, PilotHat, PilotHeld, PilotScarf, coverColors, usePilotOutfit } from "@/components/pilot-wear";

/*
 * Pilot ở trang chủ: đậu ở các ô có data-pilot-perch, tự bay sang chỗ khác,
 * đổi biểu cảm khi chạm. Vị trí tính theo phần tử cha gần nhất có position.
 */

export type PilotPerch = "sign" | "hero" | "today" | "read";
type Mood = "idle" | "shy" | "pout" | "happy" | "tease" | "dizzy" | "sleep" | "worried";
type Pose = "sign" | "sit" | "point" | "read" | "fly";

const POSE: Record<PilotPerch, Pose> = { sign: "sign", hero: "sit", today: "point", read: "read" };
const W = 110;
const H = 121;
const SLEEP_AFTER_MS = 60_000;

const MOOD_LINES: Partial<Record<Mood, string[]>> = {
  shy: [tx("Ơ… đừng nhìn mình chằm chằm thế…"), tx("Hihi, ngại quá à…")],
  pout: [tx("Học với mình một bài thôi mà~"), tx("Hứ, bạn chưa ôn bài kìa~")],
  happy: [tx("Yay! Bạn giỏi lắm!"), tx("Cố lên, mình ở đây nè!")],
  tease: [tx("Hì, không bắt được đâu!"), tx("Né nè~")],
  dizzy: [tx("Choáng quá… đừng chọc nữa…")],
};

const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

/* ----- Cho Pilot nghỉ: nhớ trên trình duyệt ----- */
const REST_KEY = "sp-pilot-rest";
let restMemory = false;
function readRest() {
  try {
    return localStorage.getItem(REST_KEY) === "1";
  } catch {
    return restMemory;
  }
}
function subscribeRest(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(REST_KEY, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(REST_KEY, callback);
  };
}
export function usePilotRest() {
  const rest = useSyncExternalStore(subscribeRest, readRest, () => false);
  const setRest = useCallback((value: boolean) => {
    restMemory = value;
    try {
      localStorage.setItem(REST_KEY, value ? "1" : "");
    } catch {}
    window.dispatchEvent(new Event(REST_KEY));
  }, []);
  return [rest, setRest] as const;
}

export function HomePilot({
  sign,
  lines,
  alert,
  celebrate,
  hidden,
}: {
  /* chữ trên biển Pilot cầm ở chỗ đậu đầu tiên */
  sign: string;
  /* câu Pilot nói khi đáp xuống từng chỗ */
  lines: Record<PilotPerch, string[]>;
  /* có bài quá hạn: Pilot lo lắng khi đáp xuống */
  alert?: string | null;
  /* vừa xong hết việc hôm nay */
  celebrate?: boolean;
  hidden: boolean;
}) {
  const outfit = usePilotOutfit();
  const cover = coverColors(outfit);
  const uid = useId().replace(/:/g, "");
  const rootRef = useRef<HTMLDivElement>(null);
  const moveRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pupilRefs = useRef<(SVGCircleElement | null)[]>([]);
  const [mood, setMoodState] = useState<Mood>("idle");
  const [pose, setPose] = useState<Pose>("sign");
  const [bubble, setBubble] = useState({ text: "", on: false });

  const state = useRef({
    perch: "sign" as PilotPerch,
    pos: { x: 0, y: 0 },
    flying: false,
    placed: false,
    mood: "idle" as Mood,
    lastActive: 0,
    dodgeAt: 0,
    taps: [] as number[],
    last: { x: 0, y: 0, t: 0 },
  });
  const timers = useRef<{ mood?: number; say?: number }>({});
  const props = useRef({ lines, alert, hidden });
  useEffect(() => {
    props.current = { lines, alert, hidden };
  }, [lines, alert, hidden]);

  const say = useCallback((text: string | undefined, ms = 3200) => {
    if (!text) return;
    setBubble({ text, on: true });
    window.clearTimeout(timers.current.say);
    timers.current.say = window.setTimeout(() => setBubble((value) => ({ ...value, on: false })), ms);
  }, []);

  const setMood = useCallback(
    (next: Mood, ms = 2600, speak = true) => {
      state.current.mood = next;
      setMoodState(next);
      if (speak) say(pick(MOOD_LINES[next] || [""]));
      window.clearTimeout(timers.current.mood);
      if (ms) {
        timers.current.mood = window.setTimeout(() => {
          state.current.mood = "idle";
          setMoodState("idle");
        }, ms);
      }
    },
    [say]
  );

  const origin = () => (rootRef.current?.offsetParent as HTMLElement | null)?.getBoundingClientRect();
  const perchEl = (name: PilotPerch) => {
    const el = document.querySelector<HTMLElement>(`[data-pilot-perch="${name}"]`);
    return el && el.getClientRects().length > 0 ? el : null;
  };
  const anchor = (name: PilotPerch) => {
    const el = perchEl(name);
    const base = origin();
    if (!el || !base) return null;
    const box = el.getBoundingClientRect();
    // tâm ngang theo ô, chân chạm đáy ô
    return { x: box.left - base.left + box.width / 2, y: box.bottom - base.top - H / 2 };
  };
  const place = (point: { x: number; y: number }) => {
    state.current.pos = point;
    if (rootRef.current) rootRef.current.style.transform = `translate(${point.x - W / 2}px, ${point.y - H / 2}px)`;
  };
  const wide = () => window.matchMedia("(min-width: 1024px)").matches;
  const reduce = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const land = useCallback(
    (name: PilotPerch) => {
      state.current.perch = name;
      setPose(POSE[name]);
      const { alert: overdue, lines: current } = props.current;
      if (overdue && name === "today") {
        setMood("worried", 4000, false);
        say(overdue, 4000);
      } else {
        say(pick(current[name]));
      }
    },
    [say, setMood]
  );

  const flyTo = useCallback(
    (name: PilotPerch) => {
      const s = state.current;
      const to = anchor(name);
      if (!to || s.flying || props.current.hidden) return;
      if (reduce()) {
        place(to);
        land(name);
        return;
      }
      const from = { ...s.pos };
      const base = rootRef.current?.offsetParent as HTMLElement | null;
      s.flying = true;
      setPose("fly");
      setBubble((value) => ({ ...value, on: false }));
      const control = {
        x: (from.x + to.x) / 2 + (Math.random() * 160 - 80),
        y: Math.min(from.y, to.y) - 140 - Math.random() * 80,
      };
      const duration = 1500 + Math.hypot(to.x - from.x, to.y - from.y) * 0.6;
      const start = performance.now();
      let lastStar = 0;
      const step = (now: number) => {
        const k = Math.min(1, (now - start) / duration);
        const t = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        const u = 1 - t;
        const x = u * u * from.x + 2 * u * t * control.x + t * t * to.x;
        const y = u * u * from.y + 2 * u * t * control.y + t * t * to.y;
        const dx = 2 * u * (control.x - from.x) + 2 * t * (to.x - control.x);
        place({ x, y: y + Math.sin(k * 18) * 6 });
        if (moveRef.current) moveRef.current.style.transform = `rotate(${Math.max(-18, Math.min(18, dx / 40))}deg)`;
        if (base && now - lastStar > 70) {
          lastStar = now;
          const star = document.createElement("span");
          star.className = "sp-buddy-trail";
          star.textContent = "✦";
          star.style.left = `${x - 10}px`;
          star.style.top = `${y + 30}px`;
          base.appendChild(star);
          window.setTimeout(() => star.remove(), 900);
        }
        if (k < 1) {
          requestAnimationFrame(step);
          return;
        }
        if (moveRef.current) moveRef.current.style.transform = "";
        s.flying = false;
        land(name);
      };
      requestAnimationFrame(step);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [land]
  );

  const dodge = useCallback(
    (dir = Math.random() < 0.5 ? 1 : -1) => {
      state.current.dodgeAt = performance.now();
      if (moveRef.current) moveRef.current.style.transform = `translate(${dir * 80}px, -24px) rotate(${dir * 14}deg)`;
      setMood("tease", 1800);
      window.setTimeout(() => {
        if (!state.current.flying && moveRef.current) moveRef.current.style.transform = "";
      }, 1500);
    },
    [setMood]
  );

  // Đặt chỗ ban đầu, giữ đúng chỗ khi bố cục đổi (dữ liệu tải xong, đổi cỡ cửa sổ)
  useEffect(() => {
    const parent = rootRef.current?.offsetParent as HTMLElement | null;
    if (!parent) return;
    const replace = () => {
      const s = state.current;
      if (s.flying) return;
      if (!wide() || !perchEl(s.perch)) {
        s.perch = "sign";
        setPose("sign");
      }
      const point = anchor(s.perch);
      if (point) place(point);
      s.placed = Boolean(point);
    };
    replace();
    const observer = new ResizeObserver(replace);
    observer.observe(parent);
    window.addEventListener("resize", replace);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", replace);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lời chào lần đầu
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (!props.current.hidden) say(tx("Chào bạn! Chạm vào mình thử xem~"), 3800);
    }, 700);
    return () => window.clearTimeout(id);
  }, [say]);

  // Xong hết việc hôm nay: bay về biển và mừng
  useEffect(() => {
    if (!celebrate || hidden) return;
    const id = window.setTimeout(() => {
      setMood("happy", 3500, false);
      say(tx("Xong hết rồi! Tối nay nghỉ ngơi nhé."), 4000);
    }, 400);
    return () => window.clearTimeout(id);
  }, [celebrate, hidden, say, setMood]);

  // Mắt nhìn theo chuột, né khi chuột lao tới nhanh, ngủ gật khi để yên
  useEffect(() => {
    const s = state.current;
    s.lastActive = Date.now();
    const wake = () => {
      s.lastActive = Date.now();
      if (s.mood === "sleep") {
        setMood("idle", 0, false);
        say(tx("Ơ, mình có ngủ đâu!"));
      }
    };
    const move = (event: MouseEvent) => {
      wake();
      const box = svgRef.current?.getBoundingClientRect();
      if (!box?.width) return;
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height * 0.4;
      const clamp = (value: number) => Math.max(-3, Math.min(3, value));
      const ex = clamp((event.clientX - cx) / 60);
      const ey = clamp((event.clientY - cy) / 60);
      pupilRefs.current.forEach((pupil) => pupil?.setAttribute("transform", `translate(${ex} ${ey})`));
      const now = performance.now();
      const speed = Math.hypot(event.clientX - s.last.x, event.clientY - s.last.y) / Math.max(1, now - s.last.t);
      s.last = { x: event.clientX, y: event.clientY, t: now };
      if (
        !s.flying &&
        !props.current.hidden &&
        !reduce() &&
        Math.hypot(event.clientX - cx, event.clientY - cy) < 90 &&
        speed > 1.6 &&
        now - s.dodgeAt > 6000
      ) {
        dodge(event.clientX < cx ? 1 : -1);
      }
    };
    const idle = window.setInterval(() => {
      if (!s.flying && !props.current.hidden && s.mood === "idle" && Date.now() - s.lastActive > SLEEP_AFTER_MS) {
        setMood("sleep", 0, false);
      }
    }, 1000);
    document.addEventListener("mousemove", move);
    document.addEventListener("scroll", wake, { passive: true });
    document.addEventListener("keydown", wake);
    return () => {
      window.clearInterval(idle);
      document.removeEventListener("mousemove", move);
      document.removeEventListener("scroll", wake);
      document.removeEventListener("keydown", wake);
    };
  }, [dodge, say, setMood]);

  // Đi tuần: bay sang chỗ khác mỗi 15–25 giây (chỉ màn hình rộng)
  useEffect(() => {
    let id = 0;
    const patrol = () => {
      id = window.setTimeout(() => {
        const s = state.current;
        if (wide() && s.mood === "idle" && !document.hidden) {
          const options = (Object.keys(POSE) as PilotPerch[]).filter((name) => name !== s.perch && perchEl(name));
          if (options.length) flyTo(pick(options));
        }
        patrol();
      }, 15_000 + Math.random() * 10_000);
    };
    patrol();
    return () => window.clearTimeout(id);
  }, [flyTo]);

  useEffect(() => {
    const current = timers.current;
    return () => {
      window.clearTimeout(current.mood);
      window.clearTimeout(current.say);
    };
  }, []);

  const poke = () => {
    const s = state.current;
    if (s.flying) return;
    s.lastActive = Date.now();
    const now = Date.now();
    s.taps = s.taps.filter((time) => now - time < 1800);
    s.taps.push(now);
    if (s.mood === "sleep") {
      setMood("happy", 2000, false);
      say(tx("Ơ, mình có ngủ đâu!"));
      return;
    }
    if (s.taps.length >= 5) {
      s.taps = [];
      setMood("dizzy", 3000);
      return;
    }
    const roll = Math.random();
    if (roll < 0.25 && !reduce()) {
      dodge();
      return;
    }
    const options = (["shy", "pout", "happy"] as Mood[]).filter((item) => item !== s.mood);
    setMood(roll < 0.55 ? options[0] : roll < 0.85 ? options[1] : "happy", 2800);
  };

  const stroke = { stroke: "#33094a", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  return (
    <div ref={rootRef} className={`sp-buddy ${hidden ? "is-gone" : ""}`} data-mood={mood} data-pose={pose} aria-hidden={hidden}>
      <div ref={moveRef} className="sp-buddy-move">
        <svg
          ref={svgRef}
          viewBox="0 0 200 220"
          role="button"
          tabIndex={hidden ? -1 : 0}
          aria-label={tx("Pilot, linh vật StudyPilot. Chạm để xem biểu cảm")}
          onClick={poke}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              poke();
            }
          }}
        >
          <ellipse cx="100" cy="212" rx="50" ry="7" fill="#33094a" opacity=".12" />
          <path className="b-wing-l" d="M52 92 C18 66 6 96 22 112 C10 124 30 136 52 120 Z" fill="#fff" strokeWidth="4" {...stroke} />
          <path className="b-wing-r" d="M148 92 C182 66 194 96 178 112 C190 124 170 136 148 120 Z" fill="#fff" strokeWidth="4" {...stroke} />
          <g className="b-legs" fill="none" strokeWidth="6" {...stroke}>
            <path className="b-leg" d="M84 172 v24 h-8" />
            <path className="b-leg" d="M116 172 v24 h8" />
          </g>
          <g className="b-body">
            <rect x="48" y="48" width="104" height="126" rx="22" fill={cover.main} stroke="#33094a" strokeWidth="4" />
            <rect x="48" y="48" width="18" height="126" rx="9" fill={cover.spine} stroke="#33094a" strokeWidth="4" />
            {[72, 100, 128, 156].map((y) => (
              <circle key={y} cx="57" cy={y} r="3.5" fill="#f6c343" />
            ))}
            <PilotHat outfit={outfit} />

            {/* Mắt */}
            <g className="mv m-idle m-shy m-pout m-worried">
              <ellipse cx="88" cy="86" rx="11" ry="13" fill="#fff" stroke="#33094a" strokeWidth="3" />
              <circle ref={(el) => { pupilRefs.current[0] = el; }} cx="90" cy="89" r="5.5" fill="#24123a" />
            </g>
            <g className="mv m-idle m-shy m-pout m-worried m-tease">
              <ellipse cx="122" cy="86" rx="11" ry="13" fill="#fff" stroke="#33094a" strokeWidth="3" />
              <circle ref={(el) => { pupilRefs.current[1] = el; }} cx="124" cy="89" r="5.5" fill="#24123a" />
            </g>
            <path className="mv m-happy m-tease" d="M78 90 Q88 76 98 90" fill="none" strokeWidth="4" {...stroke} />
            <path className="mv m-happy" d="M112 90 Q122 76 132 90" fill="none" strokeWidth="4" {...stroke} />
            <path className="mv m-sleep" d="M78 88 Q88 95 98 88 M112 88 Q122 95 132 88" fill="none" strokeWidth="4" {...stroke} />
            <g className="mv m-dizzy" fill="none" strokeWidth="3" {...stroke}>
              <path className="b-spiral" d="M88 86 a3 3 0 1 1 3 3 a6 6 0 1 1 -6 -6 a9 9 0 1 1 9 9" />
              <path className="b-spiral" d="M122 86 a3 3 0 1 1 3 3 a6 6 0 1 1 -6 -6 a9 9 0 1 1 9 9" />
            </g>
            <path className="mv m-worried" d="M76 70 l20 6 M134 70 l-20 6" strokeWidth="4" {...stroke} />
            <path className="mv m-worried" d="M146 66 q6 10 0 14 q-6 -4 0 -14z" fill="#bfe3ff" stroke="#33094a" strokeWidth="2" />

            {/* Má */}
            <ellipse className="b-cheek" cx="78" cy="106" rx="7" ry="4" fill="#ff8fb6" opacity=".7" />
            <ellipse className="b-cheek" cx="132" cy="106" rx="7" ry="4" fill="#ff8fb6" opacity=".7" />

            {/* Miệng */}
            <path className="mv m-idle" d="M96 104 Q105 112 114 104" fill="none" strokeWidth="3.5" {...stroke} />
            <path className="mv m-happy" d="M93 101 Q105 120 117 101 Z" fill="#33094a" />
            <path className="mv m-shy m-worried m-dizzy" d="M95 108 q5 -5 10 0 q5 5 10 0" fill="none" strokeWidth="3.5" {...stroke} />
            <path className="mv m-pout" d="M102 100 q6 3 0 6 q6 3 0 6" fill="none" strokeWidth="3.5" {...stroke} />
            <ellipse className="mv m-sleep" cx="105" cy="107" rx="4" ry="5" fill="#33094a" />
            <g className="mv m-tease">
              <path d="M95 103 Q105 110 115 103" fill="none" strokeWidth="3.5" {...stroke} />
              <path d="M101 106 q4 12 9 0" fill="#ff8fb6" stroke="#33094a" strokeWidth="2.5" />
            </g>

            <PilotGlasses outfit={outfit} />
            <PilotScarf outfit={outfit} uid={uid} />

            <g className="b-page">
              <PilotHeld outfit={outfit} pageClassName="b-page-flip" />
            </g>
            <g className="b-arm">
              <path d="M150 120 q22 8 26 30" fill="none" strokeWidth="6" {...stroke} />
              <circle cx="176" cy="152" r="6" fill="#fff" stroke="#33094a" strokeWidth="3" />
            </g>
            <g className="b-sign">
              <path d="M78 150 v-14 M122 150 v-14" strokeWidth="5" {...stroke} />
              <rect x="46" y="146" width="108" height="42" rx="9" fill="#f6c343" stroke="#33094a" strokeWidth="3.5" />
              <text x="100" y="174" textAnchor="middle" fontWeight="800" fontSize="21" fill="#33094a" style={{ fontFamily: "inherit" }}>
                {sign}
              </text>
            </g>
          </g>
          <g className="mv m-sleep b-zz" fontWeight="800" fill="#4566d1">
            <text x="150" y="50" fontSize="18">z</text>
            <text x="156" y="40" fontSize="14">z</text>
            <text x="162" y="32" fontSize="11">z</text>
          </g>
          <g className="mv m-pout">
            <path className="b-heart" d="M160 60 c-6 -8 -16 0 -8 8 l8 7 l8 -7 c8 -8 -2 -16 -8 -8z" fill="#e0457b" stroke="#33094a" strokeWidth="2" />
            <path className="b-heart" d="M30 52 c-4 -6 -12 0 -6 6 l6 5 l6 -5 c6 -6 -2 -12 -6 -6z" fill="#ff8fb6" stroke="#33094a" strokeWidth="2" />
          </g>
        </svg>
      </div>
      <p className={`sp-buddy-bubble ${bubble.on && !hidden ? "is-on" : ""}`} role="status">
        {bubble.text}
      </p>
    </div>
  );
}

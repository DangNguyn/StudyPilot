"use client";

import { currentLocale, tx } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/*
 * Nền chuyển động của web:
 *  A. "Bàn học trôi": lưới chấm trôi chậm, đồ dùng học tập lơ lửng mờ (mọi trang)
 *  C. "Đường bay tới ngày thi": dải chân màn hình, mỗi chấm là một buổi học của kế hoạch đang học,
 *     máy bay đậu ở buổi đang học tới, cuối đường là cờ ngày thi (chỉ màn hình rộng, khi có kế hoạch)
 * Tắt được ở Cài đặt; máy bật "giảm chuyển động" thì đứng yên (CSS).
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

const DOODLES = [
  <svg key="book" width="38" height="30" viewBox="0 0 38 30"><path d="M3 4 h14 q2 0 2 2 v22 q0 -2 -2 -2 h-14 Z M35 4 h-14 q-2 0 -2 2 v22 q0 -2 2 -2 h14 Z" fill="#eef1fd" stroke="#a9b7ef" strokeWidth="2.5" strokeLinejoin="round" /></svg>,
  <svg key="pencil" width="44" height="14" viewBox="0 0 44 14"><rect x="6" y="2" width="30" height="10" rx="2" fill="#fff5d6" stroke="#e6c36a" strokeWidth="2.5" /><path d="M36 2 L43 7 L36 12 Z" fill="#fde2b8" stroke="#e6c36a" strokeWidth="2.5" strokeLinejoin="round" /><rect x="1" y="2" width="6" height="10" rx="2" fill="#fbd0df" stroke="#e6c36a" strokeWidth="2.5" /></svg>,
  <svg key="star" width="26" height="26" viewBox="0 0 26 26"><path d="M13 1 L16 10 L25 13 L16 16 L13 25 L10 16 L1 13 L10 10 Z" fill="#fde7f0" stroke="#f2a9c3" strokeWidth="2.2" strokeLinejoin="round" /></svg>,
  <svg key="tick" width="28" height="28" viewBox="0 0 28 28"><circle cx="14" cy="14" r="12" fill="#eaf8f1" stroke="#9fd8bd" strokeWidth="2.5" /><path d="M8 14 l4 4 l8 -9" fill="none" stroke="#5fb990" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  <svg key="plane" width="32" height="26" viewBox="0 0 32 26"><path d="M2 14 L30 2 L21 24 L15 16 Z" fill="#fff" stroke="#c7bde0" strokeWidth="2.2" strokeLinejoin="round" /></svg>,
];
const CHIPS = [tx("Cố lên!"), tx("+1 buổi ✓"), tx("Ôn đúng hẹn"), "A+ ✦", tx("Sắp tới đích!")];
const CHIP_SPOTS = [
  { left: "8%", top: "22%", r: -6 },
  { left: "27%", top: "64%", r: 4 },
  { left: "46%", top: "38%", r: -3 },
  { left: "65%", top: "82%", r: 6 },
  { left: "84%", top: "14%", r: -4 },
];

function FloatingDesk() {
  return (
    <div className="sp-bg-desk" aria-hidden="true">
      {Array.from({ length: 26 }, (_, i) => (
        <span
          key={i}
          className="sp-bg-doodle"
          style={{
            left: `${(i * 37 + 11) % 96}%`,
            top: `${(i * 53 + 7) % 92}%`,
            ["--d" as string]: `${16 + (i % 7) * 3}s`,
            ["--dl" as string]: `-${(i * 1.3).toFixed(1)}s`,
            ["--r" as string]: `${((i * 29) % 40) - 20}deg`,
          }}
        >
          {DOODLES[i % DOODLES.length]}
        </span>
      ))}
      {CHIPS.map((text, i) => (
        <span
          key={text}
          className="sp-bg-chip"
          style={{ left: CHIP_SPOTS[i].left, top: CHIP_SPOTS[i].top, ["--r" as string]: `${CHIP_SPOTS[i].r}deg`, ["--dl" as string]: `-${i * 4}s` }}
        >
          {text}
        </span>
      ))}
    </div>
  );
}

/* ===== C. Đường bay tới ngày thi ===== */

type Route = { total: number; done: number; examDate: string | null };

const todayKey = () => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

async function loadList<T>(path: string): Promise<T[]> {
  const response = await fetch(`${API_BASE_URL}${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(String(response.status));
  const data = await response.json();
  // API trả { data: [...] }
  const list = Array.isArray(data) ? data : data?.data;
  return Array.isArray(list) ? list : [];
}

/* Kế hoạch đang học: ngày thi gần nhất chưa qua (giống trang chủ). Tải lại khi chuyển trang. */
function useActiveRoute(): Route | null {
  const pathname = usePathname();
  const [route, setRoute] = useState<Route | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([
      loadList<{ id: string; exam_date?: string }>("/api/exam-plans"),
      loadList<{ id: string; exam_plan_id?: string }>("/api/topics"),
      loadList<{ topic_id?: string; status?: string }>("/api/study-sessions"),
    ])
      .then(([plans, topics, sessions]) => {
        if (!alive) return;
        const today = todayKey();
        const upcoming = plans
          .filter((plan) => !plan.exam_date || plan.exam_date.slice(0, 10) >= today)
          .sort((a, b) => String(a.exam_date || "9999").localeCompare(String(b.exam_date || "9999")));
        const plan = upcoming[0];
        if (!plan) return setRoute(null);
        const topicIds = new Set(topics.filter((topic) => topic.exam_plan_id === plan.id).map((topic) => topic.id));
        const planSessions = sessions.filter((session) => session.topic_id && topicIds.has(session.topic_id));
        if (planSessions.length === 0) return setRoute(null);
        setRoute({
          total: planSessions.length,
          done: planSessions.filter((session) => session.status === "completed").length,
          examDate: plan.exam_date ? plan.exam_date.slice(0, 10) : null,
        });
      })
      .catch(() => alive && setRoute(null));
    return () => {
      alive = false;
    };
  }, [pathname]);
  return route;
}

function smoothPath(points: [number, number][]) {
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const mx = (x0 + x1) / 2;
    d += ` C${mx} ${y0} ${mx} ${y1} ${x1} ${y1}`;
  }
  return d;
}

function FlightStrip({ route }: { route: Route }) {
  const ref = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const { total, done, examDate } = route;
  const points: [number, number][] = [];
  if (width > 0) {
    for (let i = 0; i <= total; i++) {
      const t = i / total;
      points.push([40 + t * (width - 200), 56 - Math.sin(t * Math.PI * 3) * 12]);
    }
  }
  const at = Math.min(done, total - 1);
  const examText = examDate
    ? tx("Thi {0}", [new Date(`${examDate}T00:00:00`).toLocaleDateString(currentLocale(), { day: "numeric", month: "numeric" })])
    : tx("Ngày thi");

  return (
    <div className="sp-bg-strip" aria-hidden="true">
      <svg ref={ref} width="100%" height="88">
        {points.length > 1 && (
          <>
            <path className="sp-route" d={smoothPath(points)} />
            {done > 0 && <path className="sp-route-done" d={smoothPath(points.slice(0, done + 1))} />}
            {points.slice(0, total).map(([x, y], i) => (
              <circle key={i} className={`sp-route-cp ${i < done ? "is-done" : ""}`} cx={x} cy={y} r={i < done ? 6 : 5} />
            ))}
            <g transform={`translate(${points[total][0]} ${points[total][1]})`}>
              <circle className="sp-route-cp is-exam" r="10" />
              <path d="M0 -10 V-40" stroke="#33094a" strokeWidth="3" />
              <path d="M0 -40 L26 -33 L0 -26 Z" fill="#e0457b" stroke="#33094a" strokeWidth="2.5" strokeLinejoin="round" />
              <text className="sp-route-flag" x="16" y="-6">{examText}</text>
            </g>
            {done < total && (
              <g
                transform={`translate(${points[at][0]} ${points[at][1]}) rotate(${(Math.atan2(points[at + 1][1] - points[at][1], points[at + 1][0] - points[at][0]) * 180) / Math.PI})`}
              >
                <g className="sp-route-plane">
                  <path d="M-20 4 L22 -10 L8 16 L0 6 Z" fill="#fff" stroke="#33094a" strokeWidth="2.5" strokeLinejoin="round" />
                  <path d="M0 6 L22 -10" stroke="#33094a" strokeWidth="2" />
                </g>
              </g>
            )}
            <text className="sp-route-label" x={Math.max(8, points[at][0] - 40)} y={points[at][1] - 18}>
              {done >= total ? tx("Đã học xong cả kế hoạch!") : tx("Bạn ở đây · {0}/{1} buổi", [done, total])}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}

export default function StudyBackdrop({ onStrip }: { onStrip?: (shown: boolean) => void }) {
  const route = useActiveRoute();
  const shown = Boolean(route);
  useEffect(() => onStrip?.(shown), [shown, onStrip]);
  return (
    <>
      <FloatingDesk />
      {route && <FlightStrip route={route} />}
    </>
  );
}

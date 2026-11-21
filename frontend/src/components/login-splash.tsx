"use client";

import { tx } from "@/lib/i18n";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { IconCheck, Sparkle } from "@/components/icons";
import { useCurrentUserName } from "@/lib/current-user";

/*
 * Màn hình chào sau khi đăng nhập:
 * logo nảy ra → lời chào + việc hôm nay → logo bay về đúng chỗ logo ở thanh menu → trang học hiện ra.
 * Chỉ chạy khi vừa bấm đăng nhập (startLoginSplash), mở lại web khi đã đăng nhập thì không chạy.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

/* ---------- Bộ nhớ nhỏ để trang đăng nhập bật màn hình chào ---------- */
let splashActive = false;
const listeners = new Set<() => void>();

export function startLoginSplash() {
  splashActive = true;
  listeners.forEach((listener) => listener());
}

function stopLoginSplash() {
  splashActive = false;
  listeners.forEach((listener) => listener());
}

function useSplashActive() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => splashActive,
    () => false
  );
}

/* ---------- Việc hôm nay ---------- */
type Session = { scheduled_start?: string; status?: string };
type Quiz = { id: string; is_unlocked?: boolean };
type Attempt = { quiz_id: string };
type Plan = { exam_date?: string };

const vnDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
const toKey = (value: string | Date) => vnDate.format(new Date(value));

async function fetchList<T>(path: string): Promise<T[]> {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, { cache: "no-store" });
    if (!response.ok) return [];
    const result = await response.json();
    return Array.isArray(result?.data) ? result.data : [];
  } catch {
    return [];
  }
}

async function loadTodayLines(): Promise<string[]> {
  const [sessions, quizzes, attempts, plans] = await Promise.all([
    fetchList<Session>("/api/study-sessions"),
    fetchList<Quiz>("/api/quizzes"),
    fetchList<Attempt>("/api/quiz-attempts"),
    fetchList<Plan>("/api/exam-plans"),
  ]);
  const today = toKey(new Date());
  const lines: string[] = [];

  const todaySessions = sessions.filter((s) => s.scheduled_start && toKey(s.scheduled_start) === today);
  const left = todaySessions.filter((s) => s.status !== "completed").length;
  if (todaySessions.length > 0) {
    lines.push(left > 0 ? tx("Hôm nay có {0} buổi học đang chờ", [left]) : tx("Đã học xong các buổi hôm nay"));
  }

  const done = new Set(attempts.map((a) => String(a.quiz_id)));
  const waiting = quizzes.filter((q) => q.is_unlocked !== false && !done.has(String(q.id))).length;
  if (waiting > 0) lines.push(tx("{0} bài kiểm tra đang chờ bạn", [waiting]));

  const nextExam = plans
    .map((p) => p.exam_date?.slice(0, 10))
    .filter((d): d is string => Boolean(d) && (d as string) >= today)
    .sort()[0];
  if (nextExam) {
    const days = Math.round((Date.parse(`${nextExam}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
    lines.push(days === 0 ? tx("Hôm nay là ngày thi, cố lên!") : tx("Còn {0} ngày tới kỳ thi", [days]));
  }

  return lines.slice(0, 3);
}

function greetingWord() {
  const hour = new Date().getHours();
  if (hour < 11) return tx("Chào buổi sáng");
  if (hour < 13) return tx("Chào buổi trưa");
  if (hour < 18) return tx("Chào buổi chiều");
  return tx("Chào buổi tối");
}

/* Logo thật đang hiện (thanh menu trên máy tính hoặc đầu trang trên điện thoại) */
function findDockTarget(): DOMRect | null {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-sp-logo]"));
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return rect;
  }
  return null;
}

type Stage = "logo" | "greet" | "dock" | "done";
const LOGO_SIZE = 84;

export default function LoginSplash() {
  const active = useSplashActive();
  if (!active) return null;
  return <SplashOverlay />;
}

function SplashOverlay() {
  const name = useCurrentUserName();
  const [stage, setStage] = useState<Stage>("logo");
  const [popped, setPopped] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [shown, setShown] = useState(0);
  const [dock, setDock] = useState<DOMRect | null>(null);
  const runId = useRef(0);
  const [greeting] = useState(greetingWord);

  function wait(ms: number, id: number) {
    return new Promise<boolean>((resolve) => window.setTimeout(() => resolve(runId.current === id), ms));
  }

  async function goDock(id: number) {
    if (runId.current !== id) return;
    runId.current += 1;
    const next = runId.current;
    // đợi trang học dựng xong thanh menu rồi mới đo vị trí logo
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve(null)));
    setDock(findDockTarget());
    setStage("dock");
    if (!(await wait(700, next))) return;
    setStage("done");
    stopLoginSplash();
  }

  useEffect(() => {
    const id = ++runId.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const linesPromise = loadTodayLines();

    (async () => {
      await new Promise((resolve) => window.requestAnimationFrame(() => resolve(null)));
      setPopped(true);
      if (!(await wait(reduce ? 0 : 420, id))) return;
      setStage("greet");
      // Chờ dữ liệu tối đa 1,2 giây; chậm hơn thì bỏ qua các dòng việc hôm nay
      const loaded = await Promise.race([linesPromise, new Promise<string[]>((r) => window.setTimeout(() => r([]), 1200))]);
      if (runId.current !== id) return;
      setLines(loaded);
      for (let index = 1; index <= loaded.length; index += 1) {
        if (!(await wait(reduce ? 0 : 350, id))) return;
        setShown(index);
      }
      // giữ lời chào lâu hơn một chút cho người dùng kịp đọc
      if (!(await wait(reduce ? 300 : loaded.length ? 1700 : 1800, id))) return;
      await goDock(id);
    })();

    return () => {
      runId.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (stage === "done") return null;

  const docking = stage === "dock";
  const logoStyle: CSSProperties =
    docking && dock
      ? { left: dock.left, top: dock.top, width: dock.width, height: dock.height, transform: "none", borderRadius: 14 }
      : {
          left: "50%",
          top: "40%",
          width: LOGO_SIZE,
          height: LOGO_SIZE,
          transform: `translate(-50%, -50%) scale(${popped && !docking ? 1 : docking ? 0.4 : 0})`,
          opacity: docking ? 0 : 1,
        };

  return (
    <div className="fixed inset-0 z-[100]" role="status" aria-live="polite">
      {/* Nền giấy chấm của web, mờ dần khi logo bay về menu */}
      <div
        className="sp-splash-bg absolute inset-0 transition-opacity duration-500"
        style={{ opacity: docking ? 0 : 1 }}
      />

      {/* Logo S */}
      <span
        className="fixed z-10 flex items-center justify-center border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-peri)] text-white"
        style={{
          ...logoStyle,
          borderRadius: docking && dock ? 14 : 24,
          boxShadow: docking ? "2px 2px 0 var(--sp-purple-deep)" : "5px 5px 0 var(--sp-purple-deep)",
          transition: docking
            ? "left .65s cubic-bezier(.6,0,.2,1), top .65s cubic-bezier(.6,0,.2,1), width .65s cubic-bezier(.6,0,.2,1), height .65s cubic-bezier(.6,0,.2,1), border-radius .65s, box-shadow .65s, transform .65s, opacity .4s"
            : "transform .45s cubic-bezier(.3,1.5,.5,1)",
        }}
      >
        <span
          className="font-[family-name:var(--font-sp-display)] leading-none transition-[font-size] duration-[650ms]"
          style={{ fontSize: docking && dock ? 20 : 44 }}
        >
          S
        </span>
        <Sparkle size={docking ? 14 : 22} className="sp-twinkle absolute -right-2.5 -top-2.5 text-[var(--sp-pink)]" />
      </span>

      {/* Lời chào + việc hôm nay */}
      <div
        className="absolute inset-x-0 top-[calc(40%+70px)] px-6 text-center transition-all duration-300"
        style={{
          opacity: stage === "greet" ? 1 : 0,
          transform: stage === "greet" ? "none" : "translateY(10px)",
        }}
      >
        <p className="text-[34px] leading-tight text-[var(--sp-purple)] sm:text-[42px]" style={{ fontFamily: "var(--font-sp-display), Impact, sans-serif" }}>
          {greeting},{" "}
          <span className="whitespace-nowrap">
            <span className="sp-squiggle">{name}</span>
            <Sparkle size={24} className="sp-twinkle ml-2 inline-block align-top text-[var(--sp-yellow)]" />
          </span>
        </p>

        <ul className="mx-auto mt-5 flex w-fit flex-col gap-2.5 text-left">
          {(lines.length ? lines : [tx("Sẵn sàng cho buổi học hôm nay")]).map((line, index) => {
            const visible = lines.length ? index < shown : stage === "greet";
            return (
              <li
                key={line}
                className="flex items-center gap-3 text-[16px] font-semibold text-[var(--sp-text-2)] transition-all duration-300"
                style={{ opacity: visible ? 1 : 0, transform: visible ? "none" : "translateX(-10px)" }}
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-white">
                  <IconCheck size={14} />
                </span>
                {line}
              </li>
            );
          })}
        </ul>
      </div>

    </div>
  );
}

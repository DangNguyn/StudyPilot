"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { IconArrowRight, IconBook, IconLock, Sparkle } from "@/components/icons";
import { getMainTopicTitle } from "@/lib/content-titles";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

type Branch = {
  title: string;
  summary: string;
  points: string[];
  topic_ids: string[];
  pages: number[];
};

type MindmapData = {
  central: string;
  summary: string;
  branches: Branch[];
  links: { from: [number, number]; to: [number, number]; label: string }[];
};

type Lesson = { id: string; name: string; pages: number[] };

type Response = {
  locked: boolean;
  can_switch?: boolean;
  lessons: Lesson[];
  data?: MindmapData;
};

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; response: Response };

const CHAPTER_PREFIX = /^\s*(?:chương|chapter|unit|phần|part)\s*([0-9]+|[ivxlc]+)\s*[:.\-–—]?\s*/i;

function chapterParts(chapter: string) {
  const match = chapter.match(CHAPTER_PREFIX);
  return {
    label: match ? `Chương ${match[1].toUpperCase()}` : "Chương",
    title: chapter.replace(CHAPTER_PREFIX, "").trim() || chapter,
  };
}

function pageLabel(pages: number[]) {
  if (!pages.length) return "";
  return pages[0] === pages[pages.length - 1] ? `Trang ${pages[0]}` : `Trang ${pages[0]}–${pages[pages.length - 1]}`;
}

/* E_D → E<sub>D</sub> */
function plainMath(text: string): ReactNode {
  return text.split(/(?<=[A-Za-zΔ|)])_([A-Za-z0-9]{1,4})/g).map((part, index) =>
    index % 2 === 1 ? (
      <sub key={index} className="text-[0.72em]">
        {part}
      </sub>
    ) : (
      <Fragment key={index}>{part.replace(/\*\*/g, "")}</Fragment>
    )
  );
}

/* ================= Thẻ mindmap cuối chương ================= */

export default function ChapterMindmap({
  planId,
  chapter,
  onOpenTopic,
}: {
  planId: string;
  chapter: string;
  onOpenTopic?: (topicId: string) => void;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const { label, title } = chapterParts(chapter);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/exam-plans/${planId}/chapter-mindmap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapter }),
    })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result?.detail || "Chưa tải được mindmap.");
        if (!cancelled) setState({ status: "ready", response: result });
      })
      .catch((error) => {
        if (!cancelled) {
          setState({ status: "error", message: error instanceof Error ? error.message : "Chưa tải được mindmap." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [planId, chapter, reloadKey]);

  return (
    <section
      id={`mindmap-${planId}-${encodeURIComponent(chapter)}`}
      className="mt-6 scroll-mt-6 rounded-[24px] border-2 border-[var(--sp-purple-deep)] bg-white p-4 shadow-[5px_5px_0_var(--sp-peri)] sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="sp-accent text-[17px] text-[var(--sp-pink)]">Tổng kết {label.toLowerCase()}</p>
          <h3 className="flex items-center gap-2 text-[22px] text-[var(--sp-ink)]">
            Mindmap: {title}
            <Sparkle size={16} className="sp-twinkle text-[var(--sp-yellow)]" />
          </h3>
        </div>
        <span className="sp-chip flex items-center gap-1 border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-yellow)] text-[var(--sp-purple-deep)]">
          <Sparkle size={11} />
          Pro
        </span>
      </div>

      {state.status === "loading" && (
        <div className="mt-5 rounded-2xl bg-[var(--sp-surface-2)] px-5 py-10 text-center text-sm text-[var(--sp-muted)]">
          <Sparkle size={20} className="sp-twinkle mx-auto mb-2 text-[var(--sp-pink)]" />
          Đang chuẩn bị mindmap của chương… Lần đầu AI cần khoảng 10–20 giây.
        </div>
      )}

      {state.status === "error" && (
        <div className="mt-5 rounded-2xl bg-[var(--sp-pink-bg)] px-5 py-4 text-sm text-[var(--sp-pink-dark)]">
          {state.message}{" "}
          <button
            type="button"
            onClick={() => {
              setState({ status: "loading" });
              setReloadKey((value) => value + 1);
            }}
            className="font-bold underline underline-offset-2"
          >
            Thử lại
          </button>
        </div>
      )}

      {state.status === "ready" &&
        (state.response.locked || !state.response.data ? (
          <LockedMindmap
            chapterTitle={title}
            lessons={state.response.lessons}
            canSwitch={Boolean(state.response.can_switch)}
            onUnlocked={() => {
              setState({ status: "loading" });
              setReloadKey((value) => value + 1);
            }}
          />
        ) : (
          <MindmapView data={state.response.data} lessons={state.response.lessons} onOpenTopic={onOpenTopic} />
        ))}
    </section>
  );
}

/* ================= Bản đầy đủ (gói Pro) ================= */

function MindmapView({
  data,
  lessons,
  onOpenTopic,
}: {
  data: MindmapData;
  lessons: Lesson[];
  onOpenTopic?: (topicId: string) => void;
}) {
  const [selected, setSelected] = useState(0);
  const [hoverLink, setHoverLink] = useState<number | null>(null);
  const linkedPoints = new Map<string, number[]>();
  data.links.forEach((link, index) => {
    for (const [branch, point] of [link.from, link.to]) {
      const key = `${branch}-${point}`;
      linkedPoints.set(key, [...(linkedPoints.get(key) || []), index]);
    }
  });
  const branch = data.branches[selected];
  const lessonNames = (branch?.topic_ids || [])
    .map((id) => lessons.find((lesson) => lesson.id === id)?.name)
    .filter(Boolean)
    .map((name) => getMainTopicTitle(String(name)));

  return (
    <div className="mt-4">
      {data.summary && <p className="mb-4 text-[14px] leading-6 text-[var(--sp-text-2)]">{data.summary}</p>}

      <MindmapTree
        central={data.central}
        branches={data.branches}
        links={data.links}
        selected={selected}
        onSelect={setSelected}
        hoverLink={hoverLink}
        linkedPoints={linkedPoints}
      />

      {/* Liên kết giữa các ý */}
      {data.links.length > 0 && (
        <div className="mt-5">
          <p className="text-[13px] font-bold uppercase tracking-wide text-[var(--sp-muted)]">Liên kết giữa các ý</p>
          <ul className="mt-2 space-y-2">
            {data.links.map((link, index) => {
              const from = data.branches[link.from[0]]?.points[link.from[1]];
              const to = data.branches[link.to[0]]?.points[link.to[1]];
              return (
                <li
                  key={index}
                  onMouseEnter={() => setHoverLink(index)}
                  onMouseLeave={() => setHoverLink(null)}
                  className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border-2 px-3 py-2 text-[13px] transition ${
                    hoverLink === index
                      ? "border-[var(--sp-pink)] bg-[var(--sp-pink-bg)]"
                      : "border-dashed border-[var(--sp-pink-line)] bg-white"
                  }`}
                >
                  <span className="font-semibold text-[var(--sp-ink)]">{plainMath(from || "")}</span>
                  <span className="text-[var(--sp-pink)]">⟷</span>
                  <span className="font-semibold text-[var(--sp-ink)]">{plainMath(to || "")}</span>
                  {link.label && <span className="text-[var(--sp-muted)]">· {link.label}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Chi tiết nhánh đang chọn */}
      {branch && (
        <div className="sp-task-expand mt-5 flex flex-col gap-3 rounded-2xl bg-[var(--sp-lav)] px-5 py-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="font-bold text-[var(--sp-purple)]">
              {branch.title}
              {pageLabel(branch.pages) && (
                <span className="ml-2 text-[13px] font-semibold text-[var(--sp-muted)]">{pageLabel(branch.pages)}</span>
              )}
            </p>
            {branch.summary && <p className="mt-1 text-[14px] leading-6 text-[var(--sp-text-2)]">{plainMath(branch.summary)}</p>}
            {lessonNames.length > 1 && (
              <p className="mt-1 text-[12px] text-[var(--sp-muted)]">Gồm: {lessonNames.join(" · ")}</p>
            )}
          </div>
          {onOpenTopic && branch.topic_ids[0] && (
            <button
              type="button"
              onClick={() => onOpenTopic(branch.topic_ids[0])}
              className="sp-btn sp-btn-secondary shrink-0 px-4 py-2 text-sm"
            >
              <IconBook size={15} />
              Mở bài học
              <IconArrowRight size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ================= Cây mindmap (dùng chung cho bản đầy đủ và bản khóa) ================= */

type Path = { d: string; kind: "trunk" | "leaf" | "link"; index?: number };

function MindmapTree({
  central,
  branches,
  links,
  selected,
  onSelect,
  hoverLink,
  linkedPoints,
  placeholder = false,
}: {
  central: string;
  branches: { title: string; pages: number[]; points: string[] }[];
  links: MindmapData["links"];
  selected?: number;
  onSelect?: (index: number) => void;
  hoverLink?: number | null;
  linkedPoints?: Map<string, number[]>;
  placeholder?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const branchRefs = useRef<(HTMLButtonElement | HTMLDivElement | null)[]>([]);
  const pointRefs = useRef<(HTMLDivElement | null)[][]>([]);
  const [paths, setPaths] = useState<Path[]>([]);
  const [wide, setWide] = useState(true);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const measure = useCallback(() => {
    const container = containerRef.current;
    const root = rootRef.current;
    if (!container || !root) return;
    const isWide = container.clientWidth >= 620;
    setWide(isWide);
    if (!isWide) {
      setPaths([]);
      return;
    }
    const base = container.getBoundingClientRect();
    const box = (element: Element | null | undefined) => {
      const rect = element?.getBoundingClientRect();
      return rect
        ? { left: rect.left - base.left, right: rect.right - base.left, mid: rect.top - base.top + rect.height / 2 }
        : null;
    };
    const curve = (x1: number, y1: number, x2: number, y2: number) => {
      const bend = (x2 - x1) / 2;
      return `M${x1} ${y1} C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`;
    };
    const next: Path[] = [];
    const rootBox = box(root);
    branches.forEach((_, branchIndex) => {
      const branchBox = box(branchRefs.current[branchIndex]);
      if (!rootBox || !branchBox) return;
      next.push({ d: curve(rootBox.right, rootBox.mid, branchBox.left, branchBox.mid), kind: "trunk" });
      (pointRefs.current[branchIndex] || []).forEach((point) => {
        const pointBox = box(point);
        if (pointBox) next.push({ d: curve(branchBox.right, branchBox.mid, pointBox.left, pointBox.mid), kind: "leaf" });
      });
    });
    links.forEach((link, index) => {
      const a = box(pointRefs.current[link.from[0]]?.[link.from[1]]);
      const b = box(pointRefs.current[link.to[0]]?.[link.to[1]]);
      if (!a || !b) return;
      const x = Math.max(a.right, b.right) + 22;
      next.push({ d: `M${a.right} ${a.mid} C${x} ${a.mid} ${x} ${b.mid} ${b.right} ${b.mid}`, kind: "link", index });
    });
    setPaths(next);
    setSize({ width: container.clientWidth, height: container.clientHeight });
  }, [branches, links]);

  useLayoutEffect(() => {
    measure();
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(container);
    return () => observer.disconnect();
  }, [measure]);

  const pointClass = (branchIndex: number, pointIndex: number) => {
    const linkIds = linkedPoints?.get(`${branchIndex}-${pointIndex}`) || [];
    const active = hoverLink !== null && hoverLink !== undefined && linkIds.includes(hoverLink);
    return `relative rounded-xl border-2 px-3 py-1.5 text-[13px] leading-5 transition ${
      active
        ? "border-[var(--sp-pink)] bg-[var(--sp-pink-bg)] text-[var(--sp-ink)]"
        : "border-[var(--sp-line)] bg-white text-[var(--sp-text-2)]"
    }`;
  };

  const rootNode = (
    <div
      ref={rootRef}
      className="flex flex-col justify-center rounded-2xl border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-purple)] px-4 py-4 text-white shadow-[3px_3px_0_var(--sp-pink)]"
    >
      <span className="text-[11px] font-bold uppercase tracking-wide text-white/70">Chương</span>
      <span className="mt-0.5 text-[16px] font-extrabold leading-snug">{central}</span>
    </div>
  );

  return (
    <div
      ref={containerRef}
      className={`relative ${
        wide
          ? "grid grid-cols-[150px_minmax(0,210px)_minmax(0,1fr)] items-center gap-x-10 gap-y-4 pr-8"
          : "space-y-3"
      }`}
    >
      {wide && size.width > 0 && (
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          width={size.width}
          height={size.height}
          viewBox={`0 0 ${size.width} ${size.height}`}
        >
          {paths.map((path, index) => (
            <path
              key={index}
              d={path.d}
              fill="none"
              stroke={path.kind === "link" ? "var(--sp-pink)" : path.kind === "trunk" ? "var(--sp-peri)" : "var(--sp-lav-line)"}
              strokeWidth={path.kind === "trunk" ? 2.5 : path.kind === "link" ? (hoverLink === path.index ? 2.5 : 1.5) : 2}
              strokeDasharray={path.kind === "link" ? "5 4" : undefined}
              strokeLinecap="round"
            />
          ))}
        </svg>
      )}

      {wide ? (
        <div style={{ gridRow: `1 / span ${Math.max(1, branches.length)}`, gridColumn: 1 }} className="relative self-center">
          {rootNode}
        </div>
      ) : (
        rootNode
      )}

      {branches.map((branch, branchIndex) => {
        const active = selected === branchIndex;
        const branchInner = (
          <>
            <span className="block text-[14px] font-bold leading-snug text-[var(--sp-ink)]">{plainMath(branch.title)}</span>
            {pageLabel(branch.pages) && (
              <span className="mt-0.5 block text-[12px] font-semibold text-[var(--sp-muted)]">{pageLabel(branch.pages)}</span>
            )}
          </>
        );
        const branchClass = `relative w-full rounded-2xl border-2 px-3.5 py-2.5 text-left transition ${
          active
            ? "border-[var(--sp-purple)] bg-[var(--sp-lav)] shadow-[3px_3px_0_var(--sp-peri)]"
            : "border-[var(--sp-lav-line)] bg-[var(--sp-lav)] hover:border-[var(--sp-peri)]"
        }`;
        const points = (
          <div className={wide ? "flex flex-col gap-2" : "mt-2 flex flex-wrap gap-2 pl-3"}>
            {branch.points.map((point, pointIndex) => (
              <div
                key={pointIndex}
                ref={(element) => {
                  pointRefs.current[branchIndex] = pointRefs.current[branchIndex] || [];
                  pointRefs.current[branchIndex][pointIndex] = element;
                }}
                className={pointClass(branchIndex, pointIndex)}
              >
                {placeholder ? <span className="block h-3 w-40 rounded bg-[var(--sp-line)]" /> : plainMath(point)}
                {linkedPoints?.has(`${branchIndex}-${pointIndex}`) && (
                  <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-[var(--sp-pink)]" />
                )}
              </div>
            ))}
          </div>
        );

        if (!wide) {
          return (
            <div key={branchIndex} className="border-l-2 border-[var(--sp-lav-line)] pl-3">
              {onSelect ? (
                <button
                  type="button"
                  ref={(element) => {
                    branchRefs.current[branchIndex] = element;
                  }}
                  onClick={() => onSelect(branchIndex)}
                  aria-pressed={active}
                  className={branchClass}
                >
                  {branchInner}
                </button>
              ) : (
                <div className={branchClass}>{branchInner}</div>
              )}
              {points}
            </div>
          );
        }

        return (
          <Fragment key={branchIndex}>
            <div style={{ gridRow: branchIndex + 1, gridColumn: 2 }} className="relative">
              {onSelect ? (
                <button
                  type="button"
                  ref={(element) => {
                    branchRefs.current[branchIndex] = element;
                  }}
                  onClick={() => onSelect(branchIndex)}
                  aria-pressed={active}
                  className={branchClass}
                >
                  {branchInner}
                </button>
              ) : (
                <div
                  ref={(element) => {
                    branchRefs.current[branchIndex] = element;
                  }}
                  className={branchClass}
                >
                  {branchInner}
                </div>
              )}
            </div>
            <div style={{ gridRow: branchIndex + 1, gridColumn: 3 }} className="relative">
              {points}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

/* ================= Bản bị khóa (gói miễn phí) ================= */

function LockedMindmap({
  chapterTitle,
  lessons,
  canSwitch,
  onUnlocked,
}: {
  chapterTitle: string;
  lessons: Lesson[];
  canSwitch: boolean;
  onUnlocked: () => void;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  // Khung làm mờ dựng từ tên bài có sẵn, không gọi AI
  const skeleton = lessons.slice(0, 7).map((lesson, index) => ({
    title: getMainTopicTitle(lesson.name),
    pages: lesson.pages,
    points: Array.from({ length: 2 + (index % 2) }, () => ""),
  }));

  async function upgrade() {
    if (!canSwitch) {
      setMessage("Thanh toán gói Pro sẽ sớm được mở. Hẹn bạn quay lại nhé!");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`${API_URL}/api/account/plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "pro" }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.detail || "Chưa nâng cấp được.");
      onUnlocked();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Chưa nâng cấp được.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative mt-4 flex min-h-[360px] items-center overflow-hidden rounded-2xl">
      <div aria-hidden="true" className="pointer-events-none w-full select-none p-1 opacity-70 blur-[6px]">
        <MindmapTree central={chapterTitle} branches={skeleton} links={[]} placeholder />
      </div>
      <div className="absolute inset-0 flex items-center justify-center bg-white/35 p-4">
        <div className="w-full max-w-[360px] rounded-[22px] border-2 border-[var(--sp-purple-deep)] bg-white px-6 py-6 text-center shadow-[5px_5px_0_var(--sp-pink)]">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]">
            <IconLock size={22} />
          </span>
          <p className="mt-3 text-[18px] font-extrabold text-[var(--sp-ink)]">Mindmap có trong gói Pro</p>
          <p className="mt-1.5 text-[14px] leading-6 text-[var(--sp-text-2)]">
            Chương này có {lessons.length} bài. Nâng cấp để xem sơ đồ kiến thức nối các ý chính giữa các bài, ôn
            lại cả chương chỉ trong vài phút.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void upgrade()}
            className="sp-btn sp-btn-primary mt-4 w-full justify-center py-2.5 text-sm disabled:opacity-60"
          >
            <Sparkle size={14} />
            {busy ? "Đang nâng cấp…" : canSwitch ? "Nâng cấp lên Pro (chế độ thử)" : "Nâng cấp lên Pro"}
          </button>
          {message && <p className="mt-2 text-[12px] font-semibold text-[var(--sp-pink-dark)]">{message}</p>}
        </div>
      </div>
    </div>
  );
}

"use client";

import { Fragment, useEffect, useMemo, useRef, useState, Suspense } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getMainTopicTitle, stripOutlineNumbers } from "@/lib/content-titles";
import {
  IconArrowRight,
  IconBook,
  IconBulb,
  IconLock,
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconFile,
  IconFlag,
  IconPlus,
  Sparkle,
} from "@/components/icons";
import PracticeQuizPanel, {
  Highlightable,
  HighlightProvider,
  type DayPracticeQuestion,
  type PracticeHighlight,
  type PracticeQuestion,
  type UnlockState,
} from "@/components/practice-quiz-panel";
import StudyTimer from "@/components/study-timer";
import ChapterMindmap from "@/components/chapter-mindmap";
import {
  SessionModeBanner,
  parseSessionMode,
  useSessionQuizResult,
  type SessionMode,
} from "@/components/session-mode";

const REVIEW_KEY = "tong-on";
// shortcut: bản demo mở sẵn buổi Tổng ôn dù chưa học xong mọi ngày; đặt false khi chạy thật
const DEMO_PREVIEW_REVIEW = true;

/* Bộ sinh số ngẫu nhiên có hạt giống: cùng hạt giống → cùng bộ câu hỏi trong một lần mở trang */
function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

/* ================= Kiểu dữ liệu ================= */

type Subject = {
  id: string;
  name: string;
  created_at?: string;
};

type ExamPlan = {
  id: string;
  subject_id?: string;
  title?: string;
  exam_date?: string;
  created_at?: string;
  total_topics?: number;
  total_sessions?: number;
};

type Formula = {
  expression?: string;
  explanation?: string;
};

type SectionTable = {
  headers?: string[];
  rows?: string[][];
};

type ContentSection = {
  heading?: string;
  content?: string;
  key_points?: string[];
  formulas?: Formula[];
  table?: SectionTable | null;
  subsections?: ContentSection[];
};

type Topic = {
  id: string;
  name: string;
  hierarchy?: string | null;
  description?: string | null;
  estimated_minutes?: number;
  source_material_id?: string | null;
  source_chunk_ids?: string[] | null;
  content_sections?: ContentSection[] | null;
};

type StudySession = {
  id: string;
  topic_id: string;
  status: string;
  scheduled_start?: string;
  duration_minutes?: number;
  source_chunk_ids?: string[] | null;
};

type StudyMaterial = {
  id: string;
  file_name: string;
};

type Chunk = {
  id: string;
  chunk_index: number;
  page_number?: number | null;
  content: string;
};

type DayPart = {
  session: StudySession;
  topic: Topic | undefined;
  sections: ContentSection[];
  /* Vị trí của mục đầu tiên trong content_sections của chủ đề */
  offset: number;
  part: number;
  partCount: number;
};

type StudyDay = {
  dateKey: string;
  number: number;
  parts: DayPart[];
  minutes: number;
  status: "done" | "progress" | "none";
};

/* ================= Tiện ích ================= */

async function getJson<T>(url: string): Promise<T[]> {
  const response = await fetch(url, { cache: "no-store" });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result?.detail || "Không thể tải dữ liệu.");
  }

  return Array.isArray(result?.data) ? result.data : [];
}

function formatDate(value?: string) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh",
});

function toDateKey(value: string | Date) {
  return dateKeyFormatter.format(new Date(value));
}

function dayMonth(dateKey: string) {
  const [, month, day] = dateKey.split("-");
  return `${day}/${month}`;
}

function weekdayShort(dateKey: string) {
  const day = new Date(`${dateKey}T00:00:00`).getDay();
  return day === 0 ? "CN" : `T${day + 1}`;
}

function weekdayLong(dateKey: string) {
  const label = new Date(`${dateKey}T00:00:00`).toLocaleDateString("vi-VN", {
    weekday: "long",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function getChapterRoot(topic: Topic | undefined) {
  return String(topic?.hierarchy || "")
    .split(">")[0]
    .trim();
}

const CHAPTER_PREFIX =
  /^(?:chương|chapter|unit|phần|part|bài|lesson)\s*([0-9ivxlc]+)\s*[:.\-–—]?\s*/i;

function getChapterShortTitle(topic: Topic | undefined) {
  const root = getChapterRoot(topic);
  return root.replace(CHAPTER_PREFIX, "").trim() || root;
}

/*
 * Ghép lịch học thành từng ngày. Một bài bị chia sang nhiều ngày thì các
 * mục tóm tắt của bài được chia theo tỷ lệ số đoạn giáo trình của mỗi ngày,
 * để các ngày không lặp lại cùng một nội dung.
 */
function buildStudyDays(sessions: StudySession[], topics: Topic[]): StudyDay[] {
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  const ordered = [...sessions].sort(
    (a, b) =>
      new Date(a.scheduled_start || 0).getTime() -
      new Date(b.scheduled_start || 0).getTime()
  );

  const sessionsByTopic = new Map<string, StudySession[]>();
  for (const session of ordered) {
    const list = sessionsByTopic.get(session.topic_id) || [];
    list.push(session);
    sessionsByTopic.set(session.topic_id, list);
  }

  const partBySession = new Map<string, DayPart>();

  for (const [topicId, topicSessions] of sessionsByTopic) {
    const topic = topicById.get(topicId);
    const sections = topic?.content_sections || [];
    const count = topicSessions.length;
    const weights = topicSessions.map((session) =>
      Math.max(1, (session.source_chunk_ids || []).length)
    );
    const total = weights.reduce((sum, value) => sum + value, 0);

    const bounds = [0];
    let cumulative = 0;
    for (let index = 0; index < count; index += 1) {
      cumulative += weights[index];
      let bound = Math.round((cumulative / total) * sections.length);
      if (sections.length >= count) {
        bound = Math.max(bound, bounds[index] + 1);
        bound = Math.min(bound, sections.length - (count - index - 1));
      }
      bounds.push(index === count - 1 ? sections.length : bound);
    }

    topicSessions.forEach((session, index) => {
      partBySession.set(session.id, {
        session,
        topic,
        sections: sections.slice(bounds[index], bounds[index + 1]),
        offset: bounds[index],
        part: index + 1,
        partCount: count,
      });
    });
  }

  const days: StudyDay[] = [];
  for (const session of ordered) {
    const dateKey = toDateKey(session.scheduled_start || new Date());
    let day = days.find((item) => item.dateKey === dateKey);
    if (!day) {
      day = { dateKey, number: days.length + 1, parts: [], minutes: 0, status: "none" };
      days.push(day);
    }
    const part = partBySession.get(session.id);
    if (part) day.parts.push(part);
    day.minutes += Number(session.duration_minutes || 0);
  }

  for (const day of days) {
    // Phần tiếp nối của bài hôm trước được học trước bài mới.
    day.parts.sort((a, b) => Number(b.part > 1) - Number(a.part > 1));

    const statuses = day.parts.map((part) => part.session.status);
    if (statuses.length > 0 && statuses.every((status) => status === "completed")) {
      day.status = "done";
    } else if (statuses.some((status) => status === "completed" || status === "in_progress")) {
      day.status = "progress";
    }
  }

  return days;
}

function getDayTitle(day: StudyDay) {
  const titles = Array.from(
    new Set(
      day.parts
        .map((part) => getChapterShortTitle(part.topic) || (part.topic ? getMainTopicTitle(part.topic.name) : ""))
        .filter(Boolean)
    )
  );
  if (titles.length === 0) return `Ngày ${day.number}`;
  if (titles.length <= 2) return titles.join(" & ");
  return `${titles.slice(0, 2).join(" & ")} +${titles.length - 2}`;
}

/* Chữ đậm dạng **...** */
function renderRich(text: string) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, index) =>
    index % 2 === 1 ? (
      <strong
        key={index}
        className="font-bold text-[var(--sp-purple)] [background:linear-gradient(transparent_62%,#fbd3e2_62%)]"
      >
        {part}
      </strong>
    ) : (
      <Fragment key={index}>{renderMath(part)}</Fragment>
    )
  );
}

/* Chỉ số dưới dạng E_D → E<sub>D</sub> */
function renderMath(text: string) {
  return text.split(/(?<=[A-Za-zΔ|)])_([A-Za-z0-9]{1,4})/g).map((part, index) =>
    index % 2 === 1 ? (
      <sub key={index} className="text-[0.7em]">
        {part}
      </sub>
    ) : (
      <Fragment key={index}>{part.replace(/\*\*/g, "")}</Fragment>
    )
  );
}

/* Một dòng nội dung trông giống công thức (ví dụ "TR = P × Q") */
function looksLikeFormula(line: string) {
  return (
    /\s[=≈]\s/.test(line) &&
    line.length <= 90 &&
    line.trim().split(/\s+/).length <= 10 &&
    !/[.!?]$/.test(line.trim())
  );
}

function getContentLines(content?: string) {
  return String(content || "")
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
}

/* ================= Trang ================= */

function StudyMaterialsPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const subjectId = searchParams.get("subject");

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [plans, setPlans] = useState<ExamPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setIsLoading(true);
        setError("");
        const [subjectList, planList] = await Promise.all([
          getJson<Subject>(`${API_URL}/api/subjects`),
          getJson<ExamPlan>(`${API_URL}/api/exam-plans`),
        ]);
        if (!cancelled) {
          setSubjects(subjectList);
          setPlans(planList);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Không thể tải danh sách môn học."
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  /* Kế hoạch có nhiều nội dung nhất của mỗi môn */
  const planBySubject = useMemo(() => {
    const map = new Map<string, ExamPlan>();
    for (const plan of plans) {
      if (!plan.subject_id) continue;
      const current = map.get(plan.subject_id);
      if (
        !current ||
        Number(plan.total_topics || 0) > Number(current.total_topics || 0)
      ) {
        map.set(plan.subject_id, plan);
      }
    }
    return map;
  }, [plans]);

  const openSubject = (id: string | null) => {
    router.push(id ? `${pathname}?subject=${encodeURIComponent(id)}` : pathname);
  };

  if (isLoading) {
    return (
      <div className="sp-card mx-auto max-w-5xl p-10 text-center text-[var(--sp-muted)]">
        <Sparkle size={22} className="sp-twinkle mx-auto mb-3 text-[var(--sp-pink)]" />
        Đang tải tài liệu học tập...
      </div>
    );
  }

  if (error) {
    return (
      <div className="sp-card mx-auto max-w-3xl p-8 text-sm font-medium text-[var(--sp-pink-dark)]">
        {error}
      </div>
    );
  }

  const subject = subjectId
    ? subjects.find((item) => item.id === subjectId)
    : undefined;

  if (subjectId && subject) {
    const plan = planBySubject.get(subject.id);
    return (
      <MaterialReader
        key={subject.id}
        subject={subject}
        plan={plan}
        focusSessionId={searchParams.get("session")}
        focusMode={parseSessionMode(searchParams.get("mode"))}
        onBack={() => openSubject(null)}
      />
    );
  }

  return (
    <SubjectPicker
      subjects={subjects}
      planBySubject={planBySubject}
      onOpen={(id) => openSubject(id)}
    />
  );
}

/* ================= Màn hình chọn môn ================= */

const AVATAR_STYLES = [
  "bg-[var(--sp-peri)] text-white",
  "bg-[var(--sp-pink)] text-white",
  "bg-[var(--sp-purple)] text-[var(--sp-yellow)]",
  "bg-[var(--sp-yellow)] text-[var(--sp-purple)]",
];

function getInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1
    ? words[0][0] + words[words.length - 1][0]
    : (words[0] || "?").slice(0, 2)
  ).toUpperCase();
}

function SubjectPicker({
  subjects,
  planBySubject,
  onOpen,
}: {
  subjects: Subject[];
  planBySubject: Map<string, ExamPlan>;
  onOpen: (id: string) => void;
}) {
  const sorted = [...subjects].sort(
    (a, b) =>
      new Date(b.created_at || 0).getTime() -
      new Date(a.created_at || 0).getTime()
  );

  return (
    <div className="mx-auto max-w-5xl space-y-7">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="sp-accent text-lg text-[var(--sp-pink)]">
            Nội dung ôn tập
          </p>
          <h1 className="flex items-end gap-3 text-[44px] sm:text-[52px]">
            <span>
              Tài liệu <span className="sp-squiggle">học tập</span>
            </span>
            <Sparkle size={24} className="sp-twinkle mb-3 text-[var(--sp-yellow)]" />
          </h1>
          <p className="mt-2 text-[15px] text-[var(--sp-muted)]">
            Chọn một môn để xem nội dung AI đã tóm tắt theo từng chương.
          </p>
        </div>
        <span className="sp-chip w-fit bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]">
          <IconBook size={15} />
          {subjects.length} môn học
        </span>
      </section>

      {sorted.length === 0 ? (
        <div className="sp-card px-6 py-12 text-center">
          <Sparkle size={26} className="mx-auto mb-3 text-[var(--sp-yellow)]" />
          <p className="text-lg font-bold text-[var(--sp-ink)]">
            Bắt đầu với môn học đầu tiên
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-[var(--sp-muted)]">
            Tạo kế hoạch ôn thi và tải giáo trình lên, AI sẽ chia nội dung
            thành từng chương để bạn ôn tập.
          </p>
          <Link
            href="/study-plans"
            className="sp-btn sp-btn-primary mt-5 px-5 py-3 text-sm"
          >
            <IconPlus size={17} />
            Tạo kế hoạch ôn thi
          </Link>
        </div>
      ) : (
        <ul className="space-y-3.5">
          {sorted.map((subject, index) => {
            const plan = planBySubject.get(subject.id);
            const lessons = Number(plan?.total_topics || 0);
            const hasContent = lessons > 0;

            return (
              <li key={subject.id}>
                <button
                  type="button"
                  disabled={!hasContent}
                  onClick={() => onOpen(subject.id)}
                  className="group relative flex w-full items-center gap-4 overflow-hidden rounded-[22px] border-2 border-[var(--sp-line)] bg-white p-4 text-left transition duration-300 enabled:hover:-translate-y-1 enabled:hover:border-[var(--sp-purple)] enabled:hover:shadow-[6px_6px_0_var(--sp-lav-line)] focus-visible:border-[var(--sp-purple)] disabled:cursor-not-allowed sm:p-5"
                >
                  <span
                    className={`relative z-10 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-extrabold transition duration-300 group-enabled:group-hover:-rotate-6 group-enabled:group-hover:scale-105 ${
                      hasContent
                        ? AVATAR_STYLES[index % AVATAR_STYLES.length]
                        : "bg-[var(--sp-surface-2)] text-[var(--sp-soft)]"
                    }`}
                  >
                    {getInitials(subject.name)}
                  </span>

                  <span className="relative z-10 min-w-0 flex-1">
                    <span className="block truncate text-lg font-bold text-[var(--sp-ink)] sm:text-xl">
                      {subject.name}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--sp-muted)]">
                      <span className="flex items-center gap-1.5">
                        <IconCalendar size={15} />
                        Tạo ngày {formatDate(subject.created_at)}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <IconBook size={15} />
                        {hasContent
                          ? `${lessons} bài học${plan?.total_sessions ? ` · ${plan.total_sessions} buổi` : ""}`
                          : "Chưa có tài liệu"}
                      </span>
                      {plan?.exam_date && (
                        <span className="hidden items-center gap-1.5 sm:flex">
                          <IconClock size={15} />
                          Thi {formatDate(plan.exam_date)}
                        </span>
                      )}
                    </span>
                  </span>

                  {hasContent && (
                    <span className="sp-btn sp-btn-primary relative z-10 shrink-0 translate-x-6 px-4 py-2.5 text-sm opacity-0 transition duration-300 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100 [@media(hover:none)]:translate-x-0 [@media(hover:none)]:opacity-100">
                      Vào học
                      <IconArrowRight size={16} />
                    </span>
                  )}

                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-[var(--sp-pink-bg)] opacity-0 transition duration-500 group-enabled:group-hover:opacity-100"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ================= Màn hình đọc tài liệu (theo ngày học) ================= */

function MaterialReader({
  subject,
  plan,
  focusSessionId,
  focusMode = null,
  onBack,
}: {
  subject: Subject;
  plan: ExamPlan | undefined;
  focusSessionId?: string | null;
  /* Chế độ mở từ lịch: học mới, ôn lại hoặc xem lại */
  focusMode?: SessionMode | null;
  onBack: () => void;
}) {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [materials, setMaterials] = useState<StudyMaterial[]>([]);
  const [chunksByMaterial, setChunksByMaterial] = useState<
    Record<string, Chunk[]>
  >({});
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [mode, setMode] = useState<"summary" | "source">("summary");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  /* Câu hỏi ôn nhanh theo chủ đề (không liên quan bài kiểm tra kiến thức) */
  const [practiceByTopic, setPracticeByTopic] = useState<Record<string, PracticeQuestion[]>>({});
  const [practiceLoading, setPracticeLoading] = useState<Record<string, boolean>>({});
  const [practiceError, setPracticeError] = useState("");
  const [practiceRetry, setPracticeRetry] = useState(0);
  const [highlight, setHighlight] = useState<PracticeHighlight>(null);
  const [reviewingKey, setReviewingKey] = useState("");
  /* Hạt giống mới mỗi lần mở/tải lại trang → câu hỏi khác nhau */
  const [practiceSeed, setPracticeSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const [unlockByDay, setUnlockByDay] = useState<Record<string, UnlockState>>({});
  const tabsRef = useRef<HTMLDivElement>(null);
  const quizReview = useSessionQuizResult(
    plan?.id,
    focusSessionId,
    focusMode === "review" || focusMode === "revisit"
  );

  useEffect(() => {
    if (!plan) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    async function load(planId: string) {
      try {
        setIsLoading(true);
        const [topicList, sessionList, materialList] = await Promise.all([
          getJson<Topic>(`${API_URL}/api/topics?exam_plan_id=${planId}`),
          getJson<StudySession>(
            `${API_URL}/api/study-sessions?exam_plan_id=${planId}`
          ),
          getJson<StudyMaterial>(
            `${API_URL}/api/study-materials?exam_plan_id=${planId}`
          ).catch(() => []),
        ]);
        if (!cancelled) {
          setTopics(topicList);
          setSessions(sessionList);
          setMaterials(materialList);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Không thể tải nội dung."
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load(plan.id);
    return () => {
      cancelled = true;
    };
  }, [plan]);

  const todayKey = toDateKey(new Date());
  const days = useMemo(() => buildStudyDays(sessions, topics), [sessions, topics]);

  /* Mở ngày chứa bài được chỉ định (?session=), nếu không thì hôm nay / ngày học kế tiếp */
  const focusKey = focusSessionId
    ? days.find((item) =>
        item.parts.some((part) => part.session.id === focusSessionId)
      )?.dateKey
    : undefined;
  const defaultKey =
    focusKey ||
    days.find((day) => day.dateKey === todayKey)?.dateKey ||
    days.find((day) => day.dateKey > todayKey)?.dateKey ||
    days[days.length - 1]?.dateKey ||
    null;
  const activeIndex = Math.max(
    0,
    days.findIndex((day) => day.dateKey === (activeKey || defaultKey))
  );
  const day = days[activeIndex];
  /* Buổi Tổng ôn (mindmap cả chương): không có trong lịch, mở khi học xong mọi ngày */
  const showReview = activeKey === REVIEW_KEY;
  const doneDays = days.filter((item) => item.status === "done").length;
  const allDone = days.length > 0 && doneDays === days.length;
  const reviewOpen = allDone || DEMO_PREVIEW_REVIEW;
  const focusPart = focusSessionId
    ? day?.parts.find((part) => part.session.id === focusSessionId)
    : undefined;

  /* Cuộn thanh ngày để ngày đang chọn luôn nằm trong tầm nhìn */
  useEffect(() => {
    if (!day) return;
    tabsRef.current
      ?.querySelector<HTMLElement>(`[data-day="${day.dateKey}"]`)
      ?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [day]);

  /* Cuộn tới đúng bài được chỉ định khi vừa mở trang */
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusKey || focusedRef.current || activeKey) return;
    focusedRef.current = true;
    const timer = window.setTimeout(() => {
      document
        .getElementById(`part-${focusSessionId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [focusKey, focusSessionId, activeKey]);

  /* Đổi ngày thì bỏ tô sáng cũ */
  useEffect(() => {
    setHighlight(null);
    setReviewingKey("");
    setPracticeError("");
  }, [day?.dateKey]);

  /* Tải (hoặc tạo lần đầu) câu hỏi ôn nhanh cho các chủ đề của ngày đang xem */
  useEffect(() => {
    if (!day || practiceError) return;
    const topicIds = Array.from(
      new Set(
        day.parts
          .filter((part) => part.topic && part.sections.length > 0)
          .map((part) => part.topic!.id)
      )
    ).filter((topicId) => !(topicId in practiceByTopic) && !practiceLoading[topicId]);
    if (topicIds.length === 0) return;

    setPracticeLoading((state) => ({
      ...state,
      ...Object.fromEntries(topicIds.map((topicId) => [topicId, true])),
    }));

    for (const topicId of topicIds) {
      fetch(`${API_URL}/api/topics/${topicId}/practice-questions`, { method: "POST" })
        .then(async (response) => {
          const result = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(result?.detail || "Không thể tạo câu hỏi ôn nhanh.");
          }
          setPracticeByTopic((state) => ({
            ...state,
            [topicId]: Array.isArray(result?.data) ? result.data : [],
          }));
        })
        .catch((loadError) => {
          setPracticeError(
            loadError instanceof Error ? loadError.message : "Không thể tạo câu hỏi ôn nhanh."
          );
        })
        .finally(() =>
          setPracticeLoading((state) => ({ ...state, [topicId]: false }))
        );
    }
    // practiceLoading cố ý không nằm trong deps để tránh gọi lại khi trạng thái tải đổi
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, practiceByTopic, practiceRetry, practiceError]);

  /* Tải đoạn gốc khi chuyển sang "Bản gốc" */
  useEffect(() => {
    if (mode !== "source" || !day) return;

    const materialIds = Array.from(
      new Set(
        day.parts
          .map((part) => part.topic?.source_material_id)
          .filter((id): id is string => Boolean(id))
      )
    ).filter((id) => !chunksByMaterial[id]);

    if (materialIds.length === 0) return;

    Promise.all(
      materialIds.map((id) =>
        getJson<Chunk>(`${API_URL}/api/study-materials/${id}/chunks`)
          .then((chunks) => [id, chunks] as const)
          .catch(() => [id, [] as Chunk[]] as const)
      )
    ).then((entries) =>
      setChunksByMaterial((current) => ({
        ...current,
        ...Object.fromEntries(entries),
      }))
    );
  }, [mode, day, chunksByMaterial]);

  /* Các chương của môn, theo thứ tự học → mỗi chương một mindmap ở buổi Tổng ôn */
  const chapters = useMemo(() => {
    const list: string[] = [];
    for (const item of days) {
      for (const part of item.parts) {
        const chapter = getChapterRoot(part.topic);
        if (chapter && !list.includes(chapter)) list.push(chapter);
      }
    }
    return list;
  }, [days]);

  const openTopicDay = (topicId: string) => {
    const index = days.findIndex((item) => item.parts.some((part) => part.topic?.id === topicId));
    if (index >= 0) selectDay(index);
  };

  const selectDay = (index: number) => {
    const next = days[index];
    if (!next) return;
    setActiveKey(next.dateKey);
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const header = (
    <nav
      aria-label="Breadcrumb"
      className="mb-3 flex items-center gap-1.5 text-sm font-medium text-[var(--sp-muted)]"
    >
      <button type="button" onClick={onBack} className="hover:text-[var(--sp-peri-dark)]">
        Tài liệu học tập
      </button>
      <IconChevronRight size={14} />
      <span className="truncate text-[var(--sp-text-2)]">{subject.name}</span>
    </nav>
  );

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1240px]">
        {header}
        <div className="sp-card p-10 text-center text-[var(--sp-muted)]">
          <Sparkle size={22} className="sp-twinkle mx-auto mb-3 text-[var(--sp-pink)]" />
          Đang mở tài liệu {subject.name}...
        </div>
      </div>
    );
  }

  if (error || !day) {
    return (
      <div className="mx-auto max-w-[1240px]">
        {header}
        <div className="sp-card px-6 py-12 text-center">
          <p className="font-bold text-[var(--sp-ink)]">
            {error ||
              (topics.length > 0
                ? "Môn học này chưa có lịch học theo ngày"
                : "Môn học này chưa có nội dung được phân tích")}
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="sp-btn sp-btn-secondary px-5 py-2.5 text-sm"
            >
              <IconChevronLeft size={16} />
              Chọn môn khác
            </button>
            {plan && (
              <Link
                href={`/study-plans/${plan.id}`}
                className="sp-btn sp-btn-primary px-5 py-2.5 text-sm"
              >
                Xem kế hoạch
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  const fileName = materials[0]?.file_name;
  const examKey = plan?.exam_date ? toDateKey(plan.exam_date) : null;
  const isToday = day.dateKey === todayKey;
  const dayTitle = getDayTitle(day);
  const titleWords = dayTitle.split(/\s+/);
  const titleHead = titleWords.length > 3 ? titleWords.slice(0, -3).join(" ") : "";
  const titleTail = titleWords.length > 3 ? titleWords.slice(-3).join(" ") : dayTitle;

  /* Đánh số mục liên tục trong cả ngày */
  let sectionNumber = 0;
  const outline: { id: string; number: number; heading: string }[] = [];
  const numbered = day.parts.map((part) =>
    part.sections.map((section, sectionIndex) => {
      sectionNumber += 1;
      const id = `section-${part.session.id}-${sectionNumber}`;
      outline.push({
        id,
        number: sectionNumber,
        heading: stripOutlineNumbers(section.heading || ""),
      });
      return { section, number: sectionNumber, id, sourceIndex: part.offset + sectionIndex };
    })
  );

  /* Ghép câu hỏi ôn nhanh với các mục của hôm nay */
  const allDayQuestions: DayPracticeQuestion[] = [];
  day.parts.forEach((part, partIndex) => {
    const topicQuestions = part.topic ? practiceByTopic[part.topic.id] || [] : [];
    for (const entry of numbered[partIndex]) {
      topicQuestions
        .filter((item) => item.section_index === entry.sourceIndex)
        .forEach((question, questionIndex) => {
          allDayQuestions.push({
            ...question,
            key: `${entry.id}-q${questionIndex}`,
            sectionId: entry.id,
            sectionNumber: entry.number,
            sectionHeading: stripOutlineNumbers(entry.section.heading || "").replace(/\*\*/g, ""),
          });
        });
    }
  });

  /*
   * Chọn ngẫu nhiên 3 câu (ưu tiên 3 mục khác nhau) và xáo thứ tự đáp án.
   * Mỗi lần tải lại trang hoặc bấm "Làm lại" sẽ ra bộ câu khác.
   */
  const random = seededRandom(practiceSeed + day.number * 7919);
  const bySection = new Map<string, DayPracticeQuestion[]>();
  for (const question of allDayQuestions) {
    bySection.set(question.sectionId, [...(bySection.get(question.sectionId) || []), question]);
  }
  const pickedSections = shuffle(Array.from(bySection.keys()), random);
  const picked: DayPracticeQuestion[] = [];
  for (let round = 0; picked.length < 3 && round < 3; round += 1) {
    for (const sectionId of pickedSections) {
      if (picked.length >= 3) break;
      const pool = shuffle(bySection.get(sectionId) || [], random).filter(
        (item) => !picked.includes(item)
      );
      if (pool[0] && (round > 0 || !picked.some((item) => item.sectionId === sectionId))) {
        picked.push(pool[0]);
      }
    }
  }
  const dayQuestions = picked
    .sort((a, b) => a.sectionNumber - b.sectionNumber)
    .map((question) => {
      const order = shuffle([0, 1, 2, 3], random);
      return {
        ...question,
        options: order.map((position) => question.options[position]),
        correct_index: order.indexOf(question.correct_index),
      };
    });

  const dayTopicIds = Array.from(
    new Set(
      day.parts
        .filter((part) => part.topic && part.sections.length > 0)
        .map((part) => part.topic!.id)
    )
  );
  const isPracticeLoading = dayTopicIds.some(
    (topicId) => practiceLoading[topicId] || !(topicId in practiceByTopic)
  ) && !practiceError;

  const clearHighlight = () => {
    setHighlight(null);
    setReviewingKey("");
  };

  /* Trả lời xong phần tự kiểm tra → bắt đầu các buổi của ngày, mở bài kiểm tra.
     Buổi chỉ "completed" khi đã nộp bài kiểm tra. */
  const unlock = unlockByDay[day.dateKey] ||
    // Mở từ lịch: nút tính theo chế độ khi trả lời xong, không dùng nút mặc định
    (!focusMode && day.parts.length > 0 &&
    day.parts.every((part) => part.session.status === "completed" || part.session.status === "in_progress")
      ? { state: "done" as const }
      : { state: "idle" as const });

  const completeDay = async (answered: number, correct: number) => {
    const dateKey = day.dateKey;
    const sessionIds = day.parts.map((part) => part.session.id);
    /* Xem lại: chỉ dẫn tới kết quả + câu sai của bài kiểm tra gốc, không đổi trạng thái gì */
    if (focusMode === "revisit") {
      const attemptId = quizReview.result?.attempt_id;
      setUnlockByDay((state) => ({
        ...state,
        [dateKey]: {
          state: "done",
          title: attemptId ? "Xem lại bài kiểm tra của buổi này" : "Buổi này chưa có kết quả bài kiểm tra",
          quizHref: attemptId ? `/quiz-results/${attemptId}` : undefined,
          quizLabel: attemptId ? "Xem kết quả và câu sai" : undefined,
        },
      }));
      return;
    }
    setUnlockByDay((state) => ({ ...state, [dateKey]: { state: "saving" } }));
    try {
      const retakeIds: string[] = [];
      for (const sessionId of sessionIds) {
        const response = await fetch(
          `${API_URL}/api/study-sessions/${sessionId}/practice-complete`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ answered, correct, open_retake: focusMode !== "learn" }),
          }
        );
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result?.detail || "Không thể mở bài kiểm tra.");
        }
        retakeIds.push(...(result?.unlocked_retake_quiz_ids || []));
      }
      setSessions((current) =>
        current.map((session) =>
          sessionIds.includes(session.id) && session.status === "scheduled"
            ? { ...session, status: "in_progress" }
            : session
        )
      );

      let quizHref = plan ? `/quizzes?plan=${encodeURIComponent(plan.id)}` : "/quizzes";
      let quizLabel: string | undefined;
      if (plan) {
        const quizzes = await getJson<{ id: string; study_session_id?: string | null; is_retake?: boolean }>(
          `${API_URL}/api/quizzes?exam_plan_id=${plan.id}`
        ).catch(() => []);
        const quiz = quizzes.find(
          (item) => !item.is_retake && item.study_session_id && sessionIds.includes(item.study_session_id)
        );
        if (quiz) {
          quizHref = `/quizzes/${quiz.id}`;
          // Bài kiểm tra chính chỉ làm 1 lần: nếu đã làm thì dẫn tới kết quả
          const attempts = await getJson<{ attempt_id: string; quiz_id: string; submitted_at?: string | null }>(
            `${API_URL}/api/quiz-attempts`
          ).catch(() => []);
          const done = attempts
            .filter((item) => item.quiz_id === quiz.id)
            .sort((a, b) => String(b.submitted_at || "").localeCompare(String(a.submitted_at || "")))[0];
          if (done) {
            quizHref = `/quiz-results/${done.attempt_id}`;
            quizLabel = "Xem kết quả bài kiểm tra";
          }
        }
      }
      setUnlockByDay((state) => ({
        ...state,
        [dateKey]: {
          state: "done",
          quizHref,
          quizLabel,
          // Vào học → bài kiểm tra gốc; Vào ôn (hoặc mở thường) → bài kiểm tra lại nếu có
          retakeHref: focusMode !== "learn" && retakeIds[0] ? `/quizzes/${retakeIds[0]}` : undefined,
        },
      }));
    } catch (unlockError) {
      setUnlockByDay((state) => ({
        ...state,
        [dateKey]: {
          state: "error",
          message: unlockError instanceof Error ? unlockError.message : "Không thể mở bài kiểm tra.",
        },
      }));
    }
  };

  const reviewInLesson = (question: DayPracticeQuestion) => {
    setMode("summary");
    setReviewingKey(question.key);
    setHighlight({ sectionId: question.sectionId, evidence: question.evidence });
    window.setTimeout(() => {
      const section = document.getElementById(question.sectionId);
      const target = section?.querySelector<HTMLElement>(".sp-evidence") || section;
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
  };

  return (
    <div className="mx-auto max-w-[1240px] space-y-6">
      {/* Tiêu đề */}
      <section>
        {header}
        <p className="sp-accent text-lg text-[var(--sp-pink)]">
          {showReview
            ? `Tổng ôn · sau ${days.length} ngày học`
            : `Ngày ${day.number}/${days.length} · ${weekdayLong(day.dateKey)}, ${dayMonth(day.dateKey)}`}
        </p>
        <h1 className="text-[36px] sm:text-[50px]">
          {titleHead && <>{titleHead} </>}
          <span className="sp-squiggle">{titleTail}</span>
        </h1>
        {!showReview && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-[15px] text-[var(--sp-muted)]">
          <span>
            {day.parts.length} phần học · {day.minutes} phút
            {examKey && ` · còn ${Math.max(0, Math.round((new Date(`${examKey}T00:00:00`).getTime() - new Date(`${day.dateKey}T00:00:00`).getTime()) / 86400000))} ngày đến kỳ thi`}
          </span>
          {isToday && (
            <span className="sp-chip bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]">
              Hôm nay
            </span>
          )}
          {day.status === "done" && (
            <span className="sp-chip bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]">
              Đã học xong
            </span>
          )}
          {day.status === "progress" && (
            <span className="sp-chip bg-[var(--sp-amber-bg)] text-[var(--sp-amber-dark)]">
              Đang học
            </span>
          )}
        </p>
        )}
      </section>

      {focusPart && focusMode && (
        <SessionModeBanner
          mode={focusMode}
          topicTitle={focusPart.topic ? getMainTopicTitle(focusPart.topic.name) : "Buổi học"}
          result={quizReview.result}
        />
      )}

      {/* Thanh ngày học */}
      <div ref={tabsRef} className="-mx-1 flex items-center gap-2.5 overflow-x-auto px-1 pb-2 pt-3">
        <span className="mr-1 hidden shrink-0 items-center gap-1.5 text-sm text-[var(--sp-muted)] sm:flex">
          <IconFile size={16} />
          <span className="max-w-[160px] truncate" title={fileName}>
            {fileName || "Bài giảng"}
          </span>
          · {days.length} ngày học
        </span>

        {days.map((item, index) => {
          const active = !showReview && item.dateKey === day.dateKey;
          const itemIsToday = item.dateKey === todayKey;
          return (
            <button
              key={item.dateKey}
              type="button"
              data-day={item.dateKey}
              onClick={() => selectDay(index)}
              aria-current={active ? "true" : undefined}
              title={`${weekdayLong(item.dateKey)} ${dayMonth(item.dateKey)} · ${getDayTitle(item)}`}
              className={`relative flex shrink-0 items-center gap-2 rounded-full border-2 px-4 py-2 text-sm font-semibold transition ${
                active
                  ? "border-[var(--sp-purple)] bg-[var(--sp-purple)] text-white shadow-[3px_3px_0_var(--sp-lav-line)]"
                  : itemIsToday
                    ? "border-[var(--sp-pink)] bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)] hover:-translate-y-0.5"
                    : "border-[var(--sp-line)] bg-white text-[var(--sp-text-2)] hover:-translate-y-0.5 hover:border-[var(--sp-lav-line)]"
              }`}
            >
              <span className={active ? "text-[var(--sp-yellow)]" : ""}>
                Ngày {item.number}
              </span>
              <span className={active ? "text-white/75" : "text-[var(--sp-muted)]"}>
                {weekdayShort(item.dateKey)} {dayMonth(item.dateKey)}
              </span>
              {item.status !== "none" && (
                <span
                  className={`h-2 w-2 rounded-full ${
                    item.status === "done" ? "bg-emerald-500" : "bg-[var(--sp-yellow)]"
                  }`}
                  aria-label={item.status === "done" ? "Đã học xong" : "Đang học"}
                />
              )}
              {itemIsToday && !active && (
                <span className="absolute -top-2 right-2 rounded-full bg-[var(--sp-pink)] px-1.5 text-[10px] font-bold leading-4 text-white">
                  Hôm nay
                </span>
              )}
            </button>
          );
        })}

        <button
          type="button"
          disabled={!reviewOpen}
          onClick={() => setActiveKey(REVIEW_KEY)}
          aria-current={showReview ? "true" : undefined}
          title={reviewOpen ? "Mindmap tổng hợp cả chương" : `Mở sau khi học xong ${days.length} ngày`}
          className={`flex shrink-0 items-center gap-2 rounded-full border-2 px-4 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${
            showReview
              ? "border-[var(--sp-purple)] bg-[var(--sp-purple)] text-[var(--sp-yellow)] shadow-[3px_3px_0_var(--sp-lav-line)]"
              : "border-[var(--sp-pink)] bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)] enabled:hover:-translate-y-0.5"
          }`}
        >
          {reviewOpen ? <Sparkle size={14} /> : <IconLock size={14} />}
          Tổng ôn
        </button>

        {examKey && (
          <span className="flex shrink-0 items-center gap-2 rounded-full border-2 border-[var(--sp-purple)] bg-white px-4 py-2 text-sm font-bold text-[var(--sp-purple)]">
            <IconFlag size={15} className="text-[var(--sp-pink)]" />
            Thi {dayMonth(examKey)}
          </span>
        )}
      </div>

      {showReview ? (
        <div className="space-y-5">
          {!allDone && (
            <p className="flex items-center gap-2 rounded-2xl border-2 border-dashed border-[var(--sp-lav-line)] bg-[var(--sp-lav)] px-4 py-3 text-[14px] text-[var(--sp-text-2)]">
              <IconLock size={15} className="shrink-0 text-[var(--sp-peri-dark)]" />
              Buổi Tổng ôn mở khi bạn học xong {days.length} ngày (đã xong {doneDays}/{days.length}). Đang mở sẵn để xem thử.
            </p>
          )}
          {plan &&
            chapters.map((chapter) => (
              <ChapterMindmap key={`${plan.id}-${chapter}`} planId={plan.id} chapter={chapter} onOpenTopic={openTopicDay} />
            ))}
        </div>
      ) : (
      /* Khung học: nội dung (trái) + câu hỏi ôn nhanh (phải) */
      <section className="sp-card-pop grid grid-cols-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="grid grid-cols-1 items-center gap-3 border-b border-[var(--sp-line)] px-5 pb-4 pt-5 sm:grid-cols-[1fr_auto_1fr] sm:px-7 sm:pt-6">
            <div>
              <p className="sp-accent text-[17px] text-[var(--sp-pink)]">
                Ngày {day.number} · Nội dung ôn tập
              </p>
              <h2 className="text-2xl text-[var(--sp-ink)]">
                {mode === "summary" ? "Tóm tắt từ tài liệu" : "Đoạn gốc trong giáo trình"}
              </h2>
            </div>

            <div className="justify-self-start sm:justify-self-center">
              <StudyTimer storageKey={`sp-study-time:${plan?.id || subject.id}:${day.dateKey}`} />
            </div>

            <div className="flex w-fit rounded-xl bg-[var(--sp-surface-2)] p-1 sm:justify-self-end" role="tablist">
              {(
                [
                  ["summary", "Tóm tắt"],
                  ["source", "Bản gốc"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={mode === value}
                  onClick={() => setMode(value)}
                  className={`rounded-lg px-4 py-1.5 text-sm font-bold transition ${
                    mode === value
                      ? "bg-white text-[var(--sp-peri-dark)] shadow-sm"
                      : "text-[var(--sp-muted)] hover:text-[var(--sp-ink)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {mode === "summary" && outline.length > 1 && (
            <nav
              aria-label="Mục lục hôm nay"
              className="flex gap-2 overflow-x-auto border-b border-[var(--sp-line)] px-5 py-3 sm:px-7"
            >
              {outline.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() =>
                    document
                      .getElementById(item.id)
                      ?.scrollIntoView({ behavior: "smooth", block: "start" })
                  }
                  className="flex shrink-0 items-center gap-2 rounded-full border border-[var(--sp-line)] bg-white py-1 pl-1 pr-3 text-[13px] font-semibold text-[var(--sp-text-2)] transition hover:border-[var(--sp-lav-line)] hover:text-[var(--sp-peri-dark)]"
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--sp-lav)] text-[11px] font-bold text-[var(--sp-peri-dark)]">
                    {item.number}
                  </span>
                  <span className="max-w-[220px] truncate">{item.heading.replace(/\*\*/g, "")}</span>
                </button>
              ))}
            </nav>
          )}

          <div
            ref={scrollRef}
            className="max-h-[68vh] min-h-[360px] overflow-y-auto px-5 py-6 text-justify sm:px-7"
          >
            {mode === "summary" ? (
              <div className="space-y-2">
                {day.parts.map((part, partIndex) => (
                  <div
                    key={part.session.id}
                    id={`part-${part.session.id}`}
                    className="scroll-mt-24"
                  >
                    <div className={`mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 ${partIndex > 0 ? "mt-8" : ""}`}>
                      <span className="sp-chip bg-[var(--sp-purple)] text-white">
                        Phần {partIndex + 1}
                      </span>
                      <span className="font-bold text-[var(--sp-purple)]">
                        {part.topic ? getMainTopicTitle(part.topic.name) : "Nội dung"}
                        {part.partCount > 1 && (
                          <span className="ml-1.5 font-semibold text-[var(--sp-muted)]">
                            ({part.part}/{part.partCount})
                          </span>
                        )}
                      </span>
                      {getChapterRoot(part.topic) && (
                        <span className="text-xs text-[var(--sp-muted)]">
                          {getChapterRoot(part.topic)}
                        </span>
                      )}
                      <span className="h-px min-w-6 flex-1 bg-[var(--sp-line)]" />
                    </div>

                    {numbered[partIndex].length === 0 ? (
                      <p className="rounded-2xl bg-[var(--sp-surface-2)] p-4 text-sm leading-6 text-[var(--sp-muted)]">
                        {part.part > 1
                          ? "Đây là phần tiếp theo của bài trên. Chuyển sang “Bản gốc” để đọc đúng đoạn giáo trình của hôm nay."
                          : part.topic?.description || "Bài này chưa có nội dung tóm tắt."}
                      </p>
                    ) : (
                      <div className="divide-y divide-[var(--sp-line)]">
                        {numbered[partIndex].map(({ section, number, id }) => (
                          <SectionBlock
                            key={id}
                            id={id}
                            section={section}
                            number={number}
                            evidence={highlight?.sectionId === id ? highlight.evidence : ""}
                            onUnderstood={clearHighlight}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}

              </div>
            ) : (
              <SourceView day={day} chunksByMaterial={chunksByMaterial} />
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--sp-line)] px-5 py-4 sm:px-7">
            <p className="flex items-center gap-2 text-sm text-[var(--sp-muted)]">
              <Sparkle size={13} className="text-[var(--sp-pink)]" />
              AI tóm tắt nội dung của ngày {day.number}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={activeIndex === 0}
                onClick={() => selectDay(activeIndex - 1)}
                className="sp-btn sp-btn-secondary px-4 py-2 text-sm"
              >
                <IconChevronLeft size={16} />
                Ngày trước
              </button>
              <button
                type="button"
                disabled={activeIndex >= days.length - 1}
                onClick={() => selectDay(activeIndex + 1)}
                className="sp-btn sp-btn-primary px-4 py-2 text-sm"
              >
                Ngày sau
                <IconArrowRight size={16} />
              </button>
            </div>
          </div>
        </div>

        <aside className="border-t-2 border-dashed border-[var(--sp-lav-line)] xl:sticky xl:top-0 xl:max-h-[calc(68vh+150px)] xl:overflow-y-auto xl:border-l-2 xl:border-t-0">
          <PracticeQuizPanel
            questions={dayQuestions}
            isLoading={isPracticeLoading}
            error={practiceError}
            onRetry={() => {
              setPracticeError("");
              setPracticeRetry((value) => value + 1);
            }}
            onReview={reviewInLesson}
            reviewingKey={reviewingKey}
            onUnderstood={clearHighlight}
            onRestart={() => setPracticeSeed(Math.floor(Math.random() * 1e9))}
            onFinish={(answered, correct) => {
              // Luôn gọi: mỗi lần trả lời xong cũng mở lại bài kiểm tra lại (nếu có)
              completeDay(answered, correct);
            }}
            unlock={unlock}
            renderText={renderRich}
            emptyHint={
              outline.length === 0
                ? "Hôm nay là phần tiếp theo của bài trước, hãy đọc “Bản gốc”."
                : undefined
            }
          />
        </aside>
      </section>
      )}

    </div>
  );
}

/* ================= Khối nội dung ================= */

function SectionBlock({
  id,
  section,
  number,
  evidence = "",
  onUnderstood,
}: {
  id: string;
  section: ContentSection;
  number: number;
  onUnderstood?: () => void;
  /* Đoạn cần tô sáng khi người học trả lời sai câu ôn nhanh */
  evidence?: string;
}) {
  return (
    <HighlightProvider value={evidence}>
    <article
      id={id}
      className={`scroll-mt-4 py-6 transition-colors duration-500 first:pt-0 last:pb-0 ${
        evidence
          ? "sp-highlight-section -mx-3 rounded-2xl bg-[#fffaf0] px-3 ring-2 ring-[#ffe08a] first:pt-4 last:pb-4"
          : ""
      }`}
    >
      <h3 className="mb-3 flex items-center gap-3 text-lg text-[var(--sp-ink)]">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--sp-peri)] text-sm font-extrabold text-white shadow-[2px_2px_0_var(--sp-purple-deep)]">
          {number}
        </span>
        <span className="flex-1">{renderRich(stripOutlineNumbers(section.heading || ""))}</span>
        {evidence && onUnderstood && (
          <button
            type="button"
            onClick={onUnderstood}
            className="sp-task-expand shrink-0 rounded-full bg-emerald-600 px-3 py-1 text-[13px] font-bold text-white shadow-[2px_2px_0_var(--sp-purple-deep)] transition hover:bg-emerald-700"
          >
            ✓ Đã hiểu
          </button>
        )}
      </h3>
      <SectionBody section={section} />
    </article>
    </HighlightProvider>
  );
}

function SectionBody({ section, nested = false }: { section: ContentSection; nested?: boolean }) {
  const lines = getContentLines(section.content);
  const textLines = lines.filter((line) => !looksLikeFormula(line));
  const inlineFormulas = lines
    .filter(looksLikeFormula)
    .map((expression) => ({ expression, explanation: "" }));
  const formulas = [...(section.formulas || []), ...inlineFormulas].filter(
    (formula) => formula.expression
  );

  return (
    <div className={`space-y-4 ${nested ? "" : "sm:pl-11"}`}>
      {textLines.length === 1 && (
        <p className="text-[15.5px] leading-7 text-[var(--sp-text-2)]">
          <Highlightable text={textLines[0]}>{renderRich(textLines[0])}</Highlightable>
        </p>
      )}
      {textLines.length > 1 && (
        <ul className="space-y-2">
          {textLines.map((line, index) => (
            <li key={index} className="flex gap-3 text-[15.5px] leading-7 text-[var(--sp-text-2)]">
              <span className="mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--sp-peri)]" />
              <span>
                <Highlightable text={line}>{renderRich(line)}</Highlightable>
              </span>
            </li>
          ))}
        </ul>
      )}

      {formulas.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {formulas.map((formula, index) => (
            <FormulaCard key={index} formula={formula} />
          ))}
        </div>
      )}

      {section.table && <TableBlock table={section.table} />}

      {(section.subsections || []).map((subsection, index) => (
        <div
          key={index}
          className="rounded-2xl border border-[var(--sp-line)] bg-[var(--sp-surface-2)]/60 p-4"
        >
          <p className="mb-2 font-bold text-[var(--sp-purple)]">
            {renderRich(stripOutlineNumbers(subsection.heading || ""))}
          </p>
          <SectionBody section={subsection} nested />
        </div>
      ))}

      {(section.key_points || []).length > 0 && (
        <KeyPoints points={section.key_points || []} summary={!nested} />
      )}
    </div>
  );
}

function FormulaCard({ formula }: { formula: Formula }) {
  const expression = String(formula.expression || "");
  const equalIndex = expression.search(/\s?[=≈]\s?/);
  const lhs = equalIndex > 0 ? expression.slice(0, equalIndex).trim() : "";
  const sign = equalIndex > 0 ? expression.slice(equalIndex).trim()[0] : "";
  const rhs = equalIndex > 0 ? expression.slice(equalIndex).trim().slice(1).trim() : expression;
  const fraction = rhs.split(" / ");
  const isFraction = fraction.length === 2;

  return (
    <div className="inline-flex max-w-full flex-col gap-1.5 rounded-2xl border border-[var(--sp-lav-line)] bg-[var(--sp-lav)] px-5 py-3.5">
      <div className="flex flex-wrap items-center gap-2.5 text-[17px] font-bold text-[var(--sp-purple)]">
        {lhs && <span>{renderMath(lhs)}</span>}
        {sign && <span>{sign}</span>}
        {isFraction ? (
          <span className="inline-flex flex-col items-center text-[15.5px] leading-snug">
            <span className="px-1">{renderMath(fraction[0])}</span>
            <span className="h-0.5 w-full rounded bg-[var(--sp-purple)]" />
            <span className="px-1">{renderMath(fraction[1])}</span>
          </span>
        ) : (
          <span>{renderMath(rhs)}</span>
        )}
      </div>
      {formula.explanation && (
        <p className="text-[13.5px] leading-5 text-[var(--sp-text-2)]">
          {renderMath(formula.explanation)}
        </p>
      )}
    </div>
  );
}

/* Tiêu đề thẻ: căn giữa, phần trong ngoặc xuống dòng riêng, vd "Technique (Kỹ thuật)" */
function CardTitle({ text, small }: { text: string; small: boolean }) {
  const match = text.match(/^(.+?)\s*(\([^()]*\))\s*$/);
  return (
    <p className={`text-center font-extrabold text-[var(--sp-purple)] ${small ? "text-[15px] leading-6" : "text-lg leading-7"}`}>
      {renderMath(match ? match[1] : text)}
      {match && <span className="block">{renderMath(match[2])}</span>}
    </p>
  );
}

function TableBlock({ table }: { table: SectionTable }) {
  const headers = table.headers || [];
  const rows = (table.rows || []).filter((row) => row.some(Boolean));
  if (headers.length < 2 || rows.length === 0) return null;

  /* Bảng nhỏ (phân loại, so sánh ngắn) → thẻ so sánh */
  if (rows.length <= 4 && headers.length <= 3) {
    // Đồng bộ cả nhóm thẻ: một tiêu đề dài → mọi tiêu đề cùng cỡ nhỏ; nội dung đều ngắn → cùng căn giữa
    const smallTitles = rows.some((row) => (row[0] || "").length > 18);
    const centerBody = rows.every((row) => row.slice(1).every((cell) => !cell || cell.length <= 100));
    return (
      <div
        className={`grid grid-cols-1 gap-3 ${
          rows.length === 2 ? "sm:grid-cols-2" : rows.length >= 3 ? "sm:grid-cols-3" : ""
        } ${rows.length === 4 ? "lg:grid-cols-4" : ""}`}
      >
        {rows.map((row, index) => (
          <div
            key={index}
            className="rounded-2xl border-2 border-[var(--sp-line)] bg-white p-4 transition hover:border-[var(--sp-lav-line)]"
          >
            <CardTitle text={row[0]} small={smallTitles} />
            {row.slice(1).map((cell, cellIndex) =>
              cell ? (
                <p
                  key={cellIndex}
                  className={`mt-1.5 text-sm leading-6 text-[var(--sp-text-2)] ${centerBody ? "text-center" : ""}`}
                >
                  <Highlightable text={`${row[0]} ${cell}`}>{renderRich(cell)}</Highlightable>
                </p>
              ) : null
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-[var(--sp-line)]">
      <table className="w-full min-w-[480px] border-collapse text-left text-[14.5px]">
        <thead>
          <tr className="bg-[var(--sp-lav)]">
            {headers.map((header, index) => (
              <th key={index} className="px-4 py-2.5 font-bold text-[var(--sp-purple)]">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t border-[var(--sp-line)] even:bg-[var(--sp-surface-2)]/60">
              {headers.map((_, cellIndex) => (
                <td
                  key={cellIndex}
                  className={`px-4 py-2.5 align-top text-[var(--sp-text-2)] ${
                    cellIndex === 0 ? "font-semibold text-[var(--sp-ink)]" : ""
                  }`}
                >
                  <Highlightable text={row.join(" ")}>{renderRich(row[cellIndex] || "")}</Highlightable>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* summary: ý chính của cả mục (cuối mục) — khác hẳn ô hồng của từng phần nhỏ */
function KeyPoints({ points, summary = false }: { points: string[]; summary?: boolean }) {
  if (summary) {
    return (
      <div className="relative overflow-hidden rounded-[20px] border-2 border-[var(--sp-purple-deep)] bg-white shadow-[5px_5px_0_var(--sp-yellow)]">
        <div className="flex items-center gap-3 bg-[var(--sp-purple)] px-5 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-yellow)] text-[var(--sp-purple-deep)]">
            <IconBulb size={18} />
          </span>
          <div className="min-w-0 flex-1 text-left">
            <p className="sp-accent text-[14px] leading-5 text-[var(--sp-yellow)]">Chốt lại cả mục</p>
            <p className="font-display text-[22px] uppercase leading-7 tracking-wide text-white">Tổng kết cần nhớ</p>
          </div>
          <Sparkle size={20} className="sp-twinkle shrink-0 text-[var(--sp-yellow)]" />
        </div>
        <ol className="space-y-3 px-5 py-4">
          {points.map((point, index) => (
            <li key={index} className="flex items-center gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-yellow)] text-[13px] font-extrabold text-[var(--sp-purple-deep)]">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 text-[15.5px] font-semibold leading-7 text-[var(--sp-ink)]">
                <Highlightable text={point}>{renderRich(point)}</Highlightable>
              </span>
            </li>
          ))}
        </ol>
      </div>
    );
  }
  return (
    <div className="relative rounded-2xl border-2 border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)] px-5 py-4">
      <Sparkle size={18} className="sp-twinkle absolute -top-2.5 right-6 text-[var(--sp-yellow)]" />
      <p className="sp-accent mb-2 flex items-center gap-2 text-[17px] text-[var(--sp-pink-dark)]">
        <IconBulb size={18} className="text-[var(--sp-pink)]" />
        Ý chính cần nhớ
      </p>
      <ul className="space-y-1.5 pl-1 sm:pl-7">
        {points.map((point, index) => (
          <li key={index} className="text-[15px] leading-7 text-[var(--sp-ink)]">
            <Highlightable text={point}>{renderRich(point)}</Highlightable>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SourceView({
  day,
  chunksByMaterial,
}: {
  day: StudyDay;
  chunksByMaterial: Record<string, Chunk[]>;
}) {
  const blocks = day.parts.map((part) => {
    const materialId = part.topic?.source_material_id;
    const chunks = materialId ? chunksByMaterial[materialId] : undefined;
    const ids = new Set(
      (part.session.source_chunk_ids || part.topic?.source_chunk_ids || []).map(String)
    );
    return {
      part,
      loaded: Boolean(chunks) || !materialId,
      chunks: (chunks || [])
        .filter((chunk) => ids.has(String(chunk.id)))
        .sort((a, b) => a.chunk_index - b.chunk_index),
    };
  });

  return (
    <div className="space-y-6">
      {blocks.map(({ part, loaded, chunks }) => (
        <div key={part.session.id}>
          <p className="mb-2 font-bold text-[var(--sp-purple)]">
            {part.topic ? getMainTopicTitle(part.topic.name) : "Nội dung"}
            {part.partCount > 1 && (
              <span className="ml-1.5 font-semibold text-[var(--sp-muted)]">
                ({part.part}/{part.partCount})
              </span>
            )}
          </p>
          {!loaded ? (
            <p className="text-sm text-[var(--sp-muted)]">Đang tải đoạn gốc...</p>
          ) : chunks.length === 0 ? (
            <p className="text-sm text-[var(--sp-muted)]">Không tìm thấy đoạn gốc cho bài này.</p>
          ) : (
            <div className="space-y-3">
              {chunks.map((chunk) => (
                <div key={chunk.id} className="rounded-2xl border border-[var(--sp-line)] bg-[var(--sp-surface-2)]/60 p-4">
                  {chunk.page_number != null && (
                    <span className="sp-chip mb-2 bg-white text-[var(--sp-muted)]">
                      Trang {chunk.page_number}
                    </span>
                  )}
                  <p className="whitespace-pre-wrap text-[14.5px] leading-7 text-[var(--sp-text-2)]">
                    {chunk.content}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* useSearchParams cần nằm trong Suspense để "next build" không báo lỗi */
export default function StudyMaterialsPage() {
  return (
    <Suspense fallback={null}>
      <StudyMaterialsPageContent />
    </Suspense>
  );
}

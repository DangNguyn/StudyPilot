"use client";

import Link from "next/link";
import { getMainTopicTitle } from "@/lib/content-titles";
import {
  IconArrowRight,
  IconBook,
  IconCalendar,
  IconCheck,
  IconClock,
  IconFlag,
  IconRepeat,
  Sparkle,
} from "@/components/icons";

export type OverviewPlan = {
  id: string;
  title: string;
  exam_date: string;
  daily_available_minutes: number;
  study_days_per_week?: number;
};

export type OverviewTopic = {
  id: string;
  name: string;
  hierarchy?: string | null;
  exam_plan_id?: string;
};

export type OverviewSession = {
  id: string;
  topic_id: string;
  scheduled_start: string;
  duration_minutes: number;
  status: string;
};

const PALETTE = [
  { bg: "bg-[var(--sp-purple)]", text: "text-white", ring: "var(--sp-lav-line)" },
  { bg: "bg-[var(--sp-pink)]", text: "text-white", ring: "var(--sp-pink-line)" },
  { bg: "bg-[var(--sp-peri)]", text: "text-white", ring: "var(--sp-lav-line)" },
  { bg: "bg-[var(--sp-yellow)]", text: "text-[var(--sp-purple-deep)]", ring: "#f3dc9a" },
];

const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh",
});

function toDateKey(value: string | Date) {
  return dateKeyFormatter.format(new Date(value));
}

function daysBetween(fromKey: string, toKey: string) {
  return Math.round(
    (new Date(`${toKey}T00:00:00Z`).getTime() -
      new Date(`${fromKey}T00:00:00Z`).getTime()) /
      86_400_000
  );
}

function shortDay(value: string) {
  const key = toDateKey(value);
  const [, month, day] = key.split("-");
  const weekday = new Date(`${key}T00:00:00Z`).getUTCDay();
  const label = weekday === 0 ? "CN" : `T${weekday + 1}`;
  return `${label} ${day}/${month}`;
}

function initials(name: string) {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  return (words.length > 1
    ? words.slice(0, 2).map((word) => word[0])
    : [name.slice(0, 2)]
  )
    .join("")
    .toUpperCase();
}

export default function PlanOverviewCards({
  plans,
  topics,
  sessions,
  isLoading,
  error,
  onRefresh,
}: {
  plans: OverviewPlan[];
  topics: OverviewTopic[];
  sessions: OverviewSession[];
  isLoading: boolean;
  error: string;
  onRefresh: () => void;
}) {
  const todayKey = toDateKey(new Date());
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));

  const cards = plans
    .map((plan) => {
      const planTopics = topics.filter((topic) => topic.exam_plan_id === plan.id);
      const planSessions = sessions
        .filter((session) => topicById.get(session.topic_id)?.exam_plan_id === plan.id)
        .sort(
          (a, b) =>
            new Date(a.scheduled_start).getTime() -
            new Date(b.scheduled_start).getTime()
        );
      const completed = planSessions.filter((session) => session.status === "completed").length;
      const total = planSessions.length;
      const percent = total ? Math.round((completed / total) * 100) : 0;
      const examKey = plan.exam_date ? toDateKey(plan.exam_date) : "";
      const daysLeft = examKey ? daysBetween(todayKey, examKey) : null;
      const chapters = new Set(
        planTopics.map(
          (topic) => String(topic.hierarchy || "").split(">")[0].trim() || topic.id
        )
      ).size;
      const todaySessions = planSessions.filter(
        (session) => toDateKey(session.scheduled_start) === todayKey
      );
      const todayLeft = todaySessions.filter((session) => session.status !== "completed");
      const nextSession = planSessions.find(
        (session) =>
          session.status !== "completed" &&
          toDateKey(session.scheduled_start) >= todayKey
      );
      const overdue = planSessions.filter(
        (session) =>
          session.status !== "completed" &&
          toDateKey(session.scheduled_start) < todayKey
      ).length;

      return {
        plan,
        completed,
        total,
        percent,
        examKey,
        daysLeft,
        chapters,
        todaySessions,
        todayLeft,
        nextSession,
        overdue,
      };
    })
    // Môn sắp thi lên trước, môn đã thi xuống cuối
    .sort((a, b) => {
      const aDone = (a.daysLeft ?? 0) < 0;
      const bDone = (b.daysLeft ?? 0) < 0;
      if (aDone !== bDone) return aDone ? 1 : -1;
      return a.examKey.localeCompare(b.examKey);
    });

  return (
    <section className="sp-card p-5 sm:p-7">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="sp-accent text-[17px] text-[var(--sp-pink)]">
            {plans.length > 0 ? `${plans.length} môn đang ôn` : "Chưa có môn nào"}
          </p>
          <h2 className="text-[22px] text-[var(--sp-ink)]">Lịch ôn tập của tôi</h2>
          <p className="mt-1 text-sm text-[var(--sp-muted)]">
            Chọn một môn để xem lộ trình, việc cần làm hôm nay và lịch học chi tiết.
          </p>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          className="sp-btn sp-btn-secondary w-fit px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          <IconRepeat size={16} />
          {isLoading ? "Đang tải..." : "Làm mới"}
        </button>
      </div>

      {error ? (
        <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-600">{error}</p>
      ) : isLoading && plans.length === 0 ? (
        <p className="text-sm text-[var(--sp-muted)]">Đang tải các môn học...</p>
      ) : cards.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border-2 border-dashed border-[var(--sp-line)] bg-[var(--sp-surface-2)] px-5 py-10 text-center">
          <Sparkle size={24} className="text-[var(--sp-yellow)]" />
          <h3 className="mt-3 font-bold text-[var(--sp-ink)]">Chưa có kế hoạch ôn thi</h3>
          <p className="mt-1 text-sm text-[var(--sp-muted)]">
            Tạo kế hoạch ở phía trên, môn học sẽ xuất hiện tại đây.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((card, index) => {
            const color = PALETTE[index % PALETTE.length];
            const finished = card.daysLeft !== null && card.daysLeft < 0;
            const status = finished
              ? { label: "Đã thi", style: "bg-[var(--sp-surface-2)] text-[var(--sp-muted)]" }
              : card.total > 0 && card.completed === card.total
                ? { label: "Đã học xong", style: "bg-emerald-50 text-emerald-700" }
                : card.todayLeft.length > 0
                  ? { label: "Hôm nay có bài", style: "bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]" }
                  : { label: "Đang ôn", style: "bg-[var(--sp-lav)] text-[var(--sp-peri-dark)]" };
            const nextTopic = card.nextSession
              ? topicById.get(card.nextSession.topic_id)
              : undefined;

            return (
              <article
                key={card.plan.id}
                className="group flex flex-col rounded-[22px] border-2 border-[var(--sp-line)] bg-white p-5 transition duration-200 hover:-translate-y-1 hover:border-[var(--sp-purple)]"
                style={{ boxShadow: `0 0 0 transparent` }}
                onMouseEnter={(event) =>
                  (event.currentTarget.style.boxShadow = `6px 6px 0 ${color.ring}`)
                }
                onMouseLeave={(event) =>
                  (event.currentTarget.style.boxShadow = "0 0 0 transparent")
                }
              >
                {/* Đầu thẻ */}
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-base font-extrabold ${color.bg} ${color.text}`}
                  >
                    {initials(card.plan.title)}
                  </span>
                  <span className={`sp-chip shrink-0 ${status.style}`}>{status.label}</span>
                </div>
                <h3
                  className="mt-3 line-clamp-2 text-[19px] leading-snug text-[var(--sp-ink)]"
                  title={card.plan.title}
                >
                  {card.plan.title}
                </h3>
                <p className="mt-1 flex items-center gap-1.5 text-[13px] text-[var(--sp-muted)]">
                  <IconFlag size={13} />
                  Ngày thi {card.examKey ? card.examKey.split("-").reverse().join("/") : "—"}
                </p>

                {/* Đếm ngược + tiến độ */}
                <div className="mt-5 flex items-end justify-between gap-3">
                  <div>
                    <p className="text-[32px] font-extrabold leading-none text-[var(--sp-purple)]">
                      {finished ? "✓" : card.daysLeft === 0 ? "0" : card.daysLeft ?? "–"}
                      {!finished && (
                        <span className="ml-1 text-sm font-semibold text-[var(--sp-muted)]">
                          {card.daysLeft === 0 ? "thi hôm nay" : "ngày nữa"}
                        </span>
                      )}
                    </p>
                  </div>
                  <p className="text-right text-sm font-semibold text-[var(--sp-text-2)]">
                    <span className="text-lg font-extrabold text-[var(--sp-ink)]">
                      {card.percent}%
                    </span>{" "}
                    · {card.completed}/{card.total} buổi
                  </p>
                </div>
                <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-[var(--sp-surface-2)]">
                  <div
                    className="h-full rounded-full bg-[var(--sp-peri)] transition-all duration-700"
                    style={{ width: `${card.percent}%` }}
                  />
                </div>

                {/* Thông số nhanh */}
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <MiniStat icon={<IconBook size={15} />} value={card.chapters} label="chương" />
                  <MiniStat
                    icon={<IconClock size={15} />}
                    value={`${+(card.plan.daily_available_minutes / 60).toFixed(1)}h`}
                    label="mỗi ngày"
                  />
                  <MiniStat
                    icon={<IconCalendar size={15} />}
                    value={card.plan.study_days_per_week ?? "–"}
                    label="ngày/tuần"
                  />
                </div>

                {/* Tiếp theo */}
                <div className="mt-4 flex-1 rounded-2xl bg-[var(--sp-surface-2)] px-4 py-3 text-sm">
                  {card.nextSession && !finished ? (
                    <>
                      <p className="text-xs font-bold uppercase tracking-wide text-[var(--sp-muted)]">
                        {toDateKey(card.nextSession.scheduled_start) === toDateKey(new Date())
                          ? `Hôm nay · còn ${card.todayLeft.length} buổi`
                          : `Tiếp theo · ${shortDay(card.nextSession.scheduled_start)}`}
                      </p>
                      <p className="mt-1 line-clamp-2 font-semibold text-[var(--sp-ink)]">
                        {nextTopic ? getMainTopicTitle(nextTopic.name) : "Buổi học"}
                        <span className="font-normal text-[var(--sp-muted)]">
                          {" "}
                          · {card.nextSession.duration_minutes} phút
                        </span>
                      </p>
                    </>
                  ) : (
                    <p
                      className={`flex items-center gap-2 font-semibold ${
                        card.total === 0 && !finished ? "text-[var(--sp-muted)]" : "text-emerald-700"
                      }`}
                    >
                      <IconCheck size={16} />
                      {finished
                        ? "Kỳ thi đã kết thúc"
                        : card.total === 0
                          ? "Chưa có lịch học"
                          : "Đã học hết các buổi"}
                    </p>
                  )}
                  {card.overdue > 0 && !finished && (
                    <p className="mt-1.5 text-xs font-semibold text-[var(--sp-pink-dark)]">
                      {card.overdue} buổi bị lỡ cần học bù
                    </p>
                  )}
                </div>

                <Link
                  href={`/study-plans/${card.plan.id}`}
                  className="sp-btn sp-btn-primary mt-4 w-full justify-center py-2.5 text-sm"
                >
                  Xem chi tiết
                  <IconArrowRight size={16} className="transition group-hover:translate-x-1" />
                </Link>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function MiniStat({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: React.ReactNode;
  label: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--sp-line)] px-2 py-2">
      <p className="flex items-center justify-center gap-1 font-extrabold text-[var(--sp-ink)]">
        <span className="text-[var(--sp-peri-dark)]">{icon}</span>
        {value}
      </p>
      <p className="text-[11px] text-[var(--sp-muted)]">{label}</p>
    </div>
  );
}

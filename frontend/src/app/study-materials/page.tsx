
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  getLearningContentBullets,
  getMainTopicTitle,
  getPreferredContentTitle,
} from "@/lib/content-titles";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

interface ExamPlan {
  id: string;
  title?: string;
  name?: string;
  plan_name?: string;
  subject_name?: string;
  subject?: string;
  exam_date?: string;
  [key: string]: unknown;
}

interface Topic {
  id: string;
  name?: string;
  description?: string;
  source_material_id?: string;
  content_sections?: Array<{
    heading?: string;
    content?: string;
    key_points?: string[];
    subsections?: Array<{
      heading?: string;
      content?: string;
    }>;
  }>;
  [key: string]: unknown;
}

interface StudySession {
  id: string;
  topic_id: string;
  scheduled_start?: string;
  duration_minutes?: number;
  actual_study_seconds?: number;
  status?: string;
  is_unlocked?: boolean;
  lock_reason?: string | null;
  [key: string]: unknown;
}

interface DailyLesson {
  dateKey: string;
  date: Date;
  sessions: StudySession[];
}

interface WeeklyLesson {
  weekNumber: number;
  days: DailyLesson[];
}

async function readApiResponse(response: Response): Promise<any> {
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      result?.detail ||
      result?.message ||
      `Yêu cầu thất bại (${response.status})`;

    throw new Error(
      typeof message === "string"
        ? message
        : JSON.stringify(message)
    );
  }

  return result;
}

function getDataList<T>(result: any): T[] {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.items)) return result.items;
  return [];
}

function getPlanName(plan: ExamPlan): string {
  return (
    plan.subject_name ||
    plan.subject ||
    plan.title ||
    plan.plan_name ||
    plan.name ||
    "Kế hoạch ôn tập"
  );
}

function getDateKey(value?: string): string {
  if (!value) return "undated";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatDate(value?: string): string {
  if (!value) return "Chưa xác định ngày học";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDuration(minutes?: number): string {
  if (!minutes || minutes <= 0) return "Chưa xác định thời lượng";

  if (minutes < 60) {
    return `${minutes} phút`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return remainingMinutes > 0
    ? `${hours} giờ ${remainingMinutes} phút`
    : `${hours} giờ`;
}

function formatStudyTime(seconds?: number): string {
  const totalMinutes = Math.floor((seconds || 0) / 60);

  if (totalMinutes < 60) {
    return `${totalMinutes} phút`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return minutes > 0
    ? `${hours} giờ ${minutes} phút`
    : `${hours} giờ`;
}

function getSessionStatus(status?: string): {
  label: string;
  color: string;
  background: string;
} {
  switch (status) {
    case "completed":
      return {
        label: "Đã hoàn thành",
        color: "#36734A",
        background: "#E7F2E8",
      };

    case "in_progress":
      return {
        label: "Đang học",
        color: "#9A6A24",
        background: "#FFF2D9",
      };

    case "scheduled":
    default:
      return {
        label: "Chưa bắt đầu",
        color: "#66756A",
        background: "#EDF1EC",
      };
  }
}

export default function StudyMaterialsPage() {
  const [plans, setPlans] = useState<ExamPlan[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState("");

  const [loadingPlans, setLoadingPlans] = useState(true);
  const [loadingLessons, setLoadingLessons] = useState(false);
  const [error, setError] = useState("");
  const [expandedWeeks, setExpandedWeeks] = useState<number[]>([1]);
  const [expandedDays, setExpandedDays] = useState<string[]>([]);

  const loadPlans = useCallback(async () => {
    setLoadingPlans(true);
    setError("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/exam-plans`,
        { cache: "no-store" }
      );

      const result = await readApiResponse(response);
      const planList = getDataList<ExamPlan>(result);

      setPlans(planList);

      setSelectedPlanId((current) => {
        if (current && planList.some((plan) => plan.id === current)) {
          return current;
        }

        const planWithContent = [...planList]
          .sort(
            (left, right) =>
              Number(right.total_sessions || 0) -
                Number(left.total_sessions || 0) ||
              Number(right.total_topics || 0) -
                Number(left.total_topics || 0)
          )
          .find(
            (plan) =>
              Number(plan.total_sessions || 0) > 0 ||
              Number(plan.total_topics || 0) > 0
          );

        return planWithContent?.id || planList[0]?.id || "";
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Không thể tải danh sách kế hoạch ôn tập."
      );
      setPlans([]);
    } finally {
      setLoadingPlans(false);
    }
  }, []);

  const loadLessons = useCallback(async (planId: string) => {
    if (!planId) {
      setTopics([]);
      setSessions([]);
      return;
    }

    setLoadingLessons(true);
    setError("");

    try {
      const encodedPlanId = encodeURIComponent(planId);

      const [topicsResponse, sessionsResponse] = await Promise.all([
        fetch(
          `${API_BASE_URL}/api/topics?exam_plan_id=${encodedPlanId}`,
          { cache: "no-store" }
        ),
        fetch(
          `${API_BASE_URL}/api/study-sessions?exam_plan_id=${encodedPlanId}`,
          { cache: "no-store" }
        ),
      ]);

      const [topicsResult, sessionsResult] = await Promise.all([
        readApiResponse(topicsResponse),
        readApiResponse(sessionsResponse),
      ]);

      const nextTopics = getDataList<Topic>(topicsResult);
      let nextSessions = getDataList<StudySession>(sessionsResult);

      // Tự khôi phục các kế hoạch đã phân tích tài liệu nhưng
      // chưa lưu được buổi học do lỗi ở lần tạo lịch trước.
      if (nextTopics.length > 0 && nextSessions.length === 0) {
        const repairResponse = await fetch(
          `${API_BASE_URL}/api/exam-plans/${encodeURIComponent(
            planId
          )}/generate-schedule`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              selected_study_dates: [],
            }),
            cache: "no-store",
          }
        );

        await readApiResponse(repairResponse);

        const repairedSessionsResponse = await fetch(
          `${API_BASE_URL}/api/study-sessions?exam_plan_id=${encodedPlanId}`,
          { cache: "no-store" }
        );
        const repairedSessionsResult = await readApiResponse(
          repairedSessionsResponse
        );
        nextSessions = getDataList<StudySession>(
          repairedSessionsResult
        );
      }

      setTopics(nextTopics);
      setSessions(nextSessions);
      setExpandedDays(
        Array.from(
          new Set(
            nextSessions.map((session) =>
              getDateKey(session.scheduled_start)
            )
          )
        )
      );
    } catch (err) {
      setTopics([]);
      setSessions([]);
      setError(
        err instanceof Error
          ? err.message
          : "Không thể tải danh sách bài học."
      );
    } finally {
      setLoadingLessons(false);
    }
  }, []);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  useEffect(() => {
    if (selectedPlanId) {
      void loadLessons(selectedPlanId);
    } else {
      setTopics([]);
      setSessions([]);
    }
  }, [selectedPlanId, loadLessons]);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlanId),
    [plans, selectedPlanId]
  );

  const topicMap = useMemo(() => {
    const map = new Map<string, Topic>();

    topics.forEach((topic) => {
      map.set(topic.id, topic);
    });

    return map;
  }, [topics]);

  const dailyLessons = useMemo<DailyLesson[]>(() => {
    const grouped = new Map<string, StudySession[]>();

    sessions.forEach((session) => {
      const dateKey = getDateKey(session.scheduled_start);
      const current = grouped.get(dateKey) || [];

      current.push(session);
      grouped.set(dateKey, current);
    });

    return Array.from(grouped.entries())
      .map(([dateKey, dailySessions]) => {
        const firstDate = dailySessions.find(
          (session) => session.scheduled_start
        )?.scheduled_start;

        return {
          dateKey,
          date: firstDate
            ? new Date(firstDate)
            : new Date(dateKey),
          sessions: dailySessions.sort((a, b) =>
            (a.scheduled_start || "").localeCompare(
              b.scheduled_start || ""
            )
          ),
        };
      })
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [sessions]);

  const weeklyLessons = useMemo<WeeklyLesson[]>(() => {
    if (dailyLessons.length === 0) {
      return [];
    }

    const firstDate = dailyLessons[0].date.getTime();
    const grouped = new Map<number, DailyLesson[]>();

    dailyLessons.forEach((day) => {
      const weekIndex = Math.floor(
        (day.date.getTime() - firstDate) /
          (7 * 24 * 60 * 60 * 1000)
      );
      const currentDays = grouped.get(weekIndex) || [];

      currentDays.push(day);
      grouped.set(weekIndex, currentDays);
    });

    return Array.from(grouped.entries()).map(
      ([, days], index) => ({
        weekNumber: index + 1,
        days,
      })
    );
  }, [dailyLessons]);

  const completedCount = sessions.filter(
    (session) => session.status === "completed"
  ).length;

  const progressPercent =
    sessions.length > 0
      ? Math.round((completedCount / sessions.length) * 100)
      : 0;

  const currentPlanIndex = plans.findIndex(
    (plan) => plan.id === selectedPlanId
  );

  return (
    <main className="min-h-screen bg-[#F7F8F5] px-4 py-8 text-[#26352B] sm:px-6 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[#66806B]">
            <span>StudyPilot</span>
            <span>/</span>
            <span>Tài liệu học tập</span>
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-[#26352B]">
            Tài liệu học tập
          </h1>

          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#718075]">
            Theo dõi tài liệu đã được AI phân tích và học theo
            từng bài học được sắp xếp trong kế hoạch ôn tập.
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-[#E8C7BE] bg-[#FFF1ED] px-4 py-3 text-sm text-[#A34F3D]">
            {error}
          </div>
        )}

        {loadingPlans ? (
          <div className="rounded-2xl border border-[#E1E7DF] bg-white p-10 text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-[#DCE7DC] border-t-[#54765D]" />
            <p className="text-sm text-[#718075]">
              Đang tải kế hoạch học tập...
            </p>
          </div>
        ) : plans.length === 0 ? (
          <div className="rounded-2xl border border-[#E1E7DF] bg-white px-6 py-14 text-center shadow-sm">
            <div className="mb-4 text-4xl">📚</div>

            <h2 className="text-xl font-semibold text-[#26352B]">
              Chưa có kế hoạch học tập
            </h2>

            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#718075]">
              Hãy tạo kế hoạch ôn tập và tải tài liệu lên tại
              mục Lập kế hoạch. Sau khi AI xử lý tài liệu và tạo
              lịch học, các bài học sẽ xuất hiện tại đây.
            </p>

            <Link
              href="/study-plans"
              className="mt-6 inline-flex items-center justify-center rounded-xl bg-[#54765D] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#3F6048]"
            >
              Đến Lập kế hoạch
            </Link>
          </div>
        ) : (
          <>
            <section className="mb-7">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-[#26352B]">
                  Kế hoạch học tập của bạn
                </h2>

                <Link
                  href="/study-plans"
                  className="text-sm font-medium text-[#54765D] hover:underline"
                >
                  + Tạo kế hoạch mới
                </Link>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {plans.map((plan, index) => {
                  const isSelected = plan.id === selectedPlanId;

                  return (
                    <button
                      key={plan.id}
                      type="button"
                      onClick={() => setSelectedPlanId(plan.id)}
                      className={`rounded-2xl border p-5 text-left transition ${
                        isSelected
                          ? "border-[#78977C] bg-[#EDF3EB] shadow-sm"
                          : "border-[#E1E7DF] bg-white hover:border-[#B8CBB9]"
                      }`}
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <span className="rounded-lg bg-[#E2EBDD] px-2.5 py-1 text-xs font-semibold text-[#54765D]">
                          Kế hoạch {index + 1}
                        </span>

                        {isSelected && (
                          <span className="text-sm font-semibold text-[#54765D]">
                            ✓ Đang chọn
                          </span>
                        )}
                      </div>

                      <h3 className="line-clamp-2 text-base font-semibold text-[#26352B]">
                        {getPlanName(plan)}
                      </h3>

                      {plan.exam_date && (
                        <p className="mt-2 text-xs text-[#718075]">
                          Ngày thi: {formatDate(plan.exam_date)}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>

            {selectedPlan && (
              <>
                <section className="mb-7 rounded-2xl border border-[#E1E7DF] bg-white p-5 shadow-sm sm:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-[#829184]">
                        Kế hoạch đang học
                      </p>

                      <h2 className="mt-1 text-xl font-bold text-[#26352B]">
                        {getPlanName(selectedPlan)}
                      </h2>

                      {selectedPlan.exam_date && (
                        <p className="mt-1 text-sm text-[#718075]">
                          Ngày thi: {formatDate(selectedPlan.exam_date)}
                        </p>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => void loadLessons(selectedPlan.id)}
                      disabled={loadingLessons}
                      className="rounded-xl border border-[#DCE5D8] px-4 py-2 text-sm font-medium text-[#54765D] transition hover:bg-[#F2F6F0] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {loadingLessons ? "Đang tải..." : "↻ Làm mới"}
                    </button>
                  </div>

                  <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <div className="rounded-xl bg-[#F5F7F3] p-4">
                      <p className="text-xs text-[#718075]">
                        Tổng bài học
                      </p>
                      <p className="mt-1 text-2xl font-bold text-[#26352B]">
                        {sessions.length}
                      </p>
                    </div>

                    <div className="rounded-xl bg-[#F5F7F3] p-4">
                      <p className="text-xs text-[#718075]">
                        Đã hoàn thành
                      </p>
                      <p className="mt-1 text-2xl font-bold text-[#36734A]">
                        {completedCount}
                      </p>
                    </div>

                    <div className="col-span-2 rounded-xl bg-[#F5F7F3] p-4 sm:col-span-1">
                      <p className="text-xs text-[#718075]">
                        Tiến độ học tập
                      </p>
                      <p className="mt-1 text-2xl font-bold text-[#54765D]">
                        {progressPercent}%
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#E9EEE7]">
                    <div
                      className="h-full rounded-full bg-[#6F9274] transition-all"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </section>

                <section>
                  <div className="mb-4">
                    <h2 className="text-xl font-bold text-[#26352B]">
                      Lộ trình bài học
                    </h2>
                    <p className="mt-1 text-sm text-[#718075]">
                      Nội dung được chia theo từng tuần, ngày học và chương
                      trong kế hoạch của bạn.
                    </p>
                  </div>

                  {loadingLessons ? (
                    <div className="rounded-2xl border border-[#E1E7DF] bg-white p-10 text-center">
                      <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-[#DCE7DC] border-t-[#54765D]" />
                      <p className="text-sm text-[#718075]">
                        Đang tải danh sách bài học...
                      </p>
                    </div>
                  ) : sessions.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-[#CCD8CA] bg-white px-6 py-12 text-center">
                      <div className="mb-3 text-4xl">🗂️</div>
                      <h3 className="font-semibold text-[#26352B]">
                        Chưa có bài học nào
                      </h3>
                      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[#718075]">
                        Kế hoạch này chưa có buổi học được lưu
                        trong hệ thống. Hãy kiểm tra lại bước xử lý
                        tài liệu và tạo lịch học tại mục Lập kế hoạch.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-8">
                      {weeklyLessons.map((week, weekIndex) => {
                        const firstDayNumber = weeklyLessons
                          .slice(0, weekIndex)
                          .reduce(
                            (total, previousWeek) =>
                              total + previousWeek.days.length,
                            0
                          );

                        return (
                        <section key={week.weekNumber}>
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedWeeks((current) =>
                                current.includes(week.weekNumber)
                                  ? current.filter(
                                      (weekNumber) =>
                                        weekNumber !== week.weekNumber
                                    )
                                  : [...current, week.weekNumber]
                              )
                            }
                            className="mb-3 flex w-full items-center gap-3 text-left"
                            aria-expanded={expandedWeeks.includes(
                              week.weekNumber
                            )}
                          >
                            <h3 className="text-lg font-bold text-[#26352B]">
                              Tuần {week.weekNumber}
                            </h3>
                            <div className="h-px flex-1 bg-[#E1E7DF]" />
                            <span
                              className="flex h-8 w-8 items-center justify-center rounded-full border border-[#DCE5D8] bg-white text-lg font-semibold text-[#54765D]"
                              aria-hidden="true"
                            >
                              {expandedWeeks.includes(week.weekNumber)
                                ? "⌃"
                                : "⌄"}
                            </span>
                          </button>

                          {expandedWeeks.includes(week.weekNumber) && (
                            <div className="space-y-5">
                            {week.days.map((day, dayIndex) => {
                              const dayCompleted = day.sessions.filter(
                                (session) => session.status === "completed"
                              ).length;
                              const studyDayNumber =
                                firstDayNumber + dayIndex + 1;

                              return (
                                <article
                                  key={day.dateKey}
                                  className="overflow-hidden rounded-2xl border border-[#E1E7DF] bg-white shadow-sm"
                                >
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedDays((current) =>
                                  current.includes(day.dateKey)
                                    ? current.filter(
                                        (dateKey) =>
                                          dateKey !== day.dateKey
                                      )
                                    : [...current, day.dateKey]
                                )
                              }
                              className="flex w-full flex-wrap items-center justify-between gap-3 border-b border-[#E9EEE7] bg-[#F5F7F3] px-5 py-4 text-left"
                              aria-expanded={expandedDays.includes(
                                day.dateKey
                              )}
                            >
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="rounded-lg bg-[#54765D] px-3 py-1.5 text-sm font-semibold text-white">
                                    Bài học ngày {studyDayNumber}
                                  </span>

                                  <span className="text-xs font-medium text-[#718075]">
                                    {formatDate(day.dateKey)}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center gap-3">
                                <span className="text-xs font-medium text-[#718075]">
                                  {dayCompleted}/{day.sessions.length} bài
                                  hoàn thành
                                </span>
                                <span
                                  className="text-lg font-semibold text-[#54765D]"
                                  aria-hidden="true"
                                >
                                  {expandedDays.includes(day.dateKey)
                                    ? "⌃"
                                    : "⌄"}
                                </span>
                              </div>
                            </button>

                            {expandedDays.includes(day.dateKey) && (
                              <div className="divide-y divide-[#EDF0EB]">
                              {day.sessions.map((session, sessionIndex) => {
                                const topic = topicMap.get(session.topic_id);
                                const status = getSessionStatus(
                                  session.status
                                );

                                return (
                                  <div
                                    key={session.id}
                                    className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
                                  >
                                    <div className="flex min-w-0 gap-3">
                                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#EAF0E7] text-lg">
                                        📖
                                      </div>

                                      <div className="min-w-0">
                                        <h3 className="font-semibold text-[#26352B]">
                                          {getPreferredContentTitle(
                                            topic?.name ||
                                              `Chủ đề ${sessionIndex + 1}`,
                                            topic?.content_sections?.[0]
                                              ?.heading
                                          )}
                                        </h3>

                                        {topic?.description && (
                                          <p className="mt-1 line-clamp-2 text-sm leading-5 text-[#718075]">
                                            {topic.description}
                                          </p>
                                        )}

                                        {topic?.content_sections &&
                                          topic.content_sections.length > 0 && (
                                            <div className="mt-3 rounded-xl bg-[#f4f8f3] p-3">
                                              <p className="text-[11px] font-bold uppercase tracking-wide text-[#6b8772]">
                                                Nội dung bài học
                                              </p>
                                              <p className="mt-1 text-xs font-semibold text-[#355642]">
                                                {getPreferredContentTitle(
                                                  topic.content_sections[0]
                                                    .heading ||
                                                    "Bài học",
                                                  topic.content_sections[0]
                                                    .subsections?.[0]?.heading
                                                )}
                                              </p>
                                              {getLearningContentBullets(
                                                topic.content_sections[0].heading,
                                                topic.content_sections[0].content
                                              ).length > 0 ? (
                                                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs leading-5 text-[#718075]">
                                                  {getLearningContentBullets(
                                                    topic.content_sections[0].heading,
                                                    topic.content_sections[0].content
                                                  )
                                                    .slice(0, 2)
                                                    .map((point) => (
                                                      <li key={point}>{point}</li>
                                                    ))}
                                                </ul>
                                              ) : (
                                                <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#718075]">
                                                  {getLearningContentBullets(
                                                    topic.content_sections[0].heading,
                                                    topic.content_sections[0].content
                                                  ).join(" ") ||
                                                    "Mở bài học để xem nội dung chi tiết."}
                                                </p>
                                              )}
                                            </div>
                                          )}

                                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#829184]">
                                          <span>
                                            ◷{" "}
                                            {formatDuration(
                                              session.duration_minutes
                                            )}
                                          </span>

                                          <span>
                                            Đã học:{" "}
                                            {formatStudyTime(
                                              session.actual_study_seconds
                                            )}
                                          </span>
                                        </div>
                                      </div>
                                    </div>

                                    <div className="flex shrink-0 flex-wrap items-center gap-3 sm:justify-end">
  <span
    className="rounded-full px-3 py-1.5 text-xs font-semibold"
    style={{
      color: status.color,
      backgroundColor: status.background,
    }}
  >
    {status.label}
  </span>

  {session.is_unlocked === true ? (
    <Link
      href={`/study-sessions/${session.id}`}
      className="inline-flex items-center justify-center rounded-xl bg-[#54765D] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#3F6048]"
    >
      {session.status === "completed"
        ? "Xem bài học"
        : session.status === "in_progress"
          ? "Tiếp tục học"
          : "Vào học"}
      <span className="ml-2">→</span>
    </Link>
  ) : (
    <div className="flex max-w-xs flex-col items-start gap-1 sm:items-end">
      <button
        type="button"
        disabled
        className="inline-flex cursor-not-allowed items-center justify-center rounded-xl bg-[#E8EBE6] px-4 py-2.5 text-sm font-semibold text-[#879187]"
      >
        <span className="mr-2">🔒</span>
        Chưa mở khóa
      </button>

      <p className="max-w-xs text-left text-xs leading-5 text-[#A34F3D] sm:text-right">
        {session.lock_reason ||
          "Bạn cần hoàn thành các bài học và đạt yêu cầu Quiz của những ngày trước."}
      </p>
    </div>
  )}
</div>
                                  </div>
                                );
                              })}
                              </div>
                            )}
                                </article>
                              );
                            })}
                            </div>
                          )}
                        </section>
                        );
                      })}
                    </div>
                  )}
                </section>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}

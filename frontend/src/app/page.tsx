
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getMainTopicTitle } from "@/lib/content-titles";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

interface ApiResponse {
  message: string;
  source?: string;
  status?: string;
}

interface ApiListResponse<T> {
  message?: string;
  data?: T[];
  total_sessions?: number;
  completed_sessions?: number;
  remaining_sessions?: number;
  progress_percent?: number;
  total_attempts?: number;
  total_plans?: number;
}

interface Subject {
  id: string;
  name?: string;
  title?: string;
}

interface ExamPlan {
  id: string;
  title?: string;
  total_sessions?: number;
  completed_sessions?: number;
  remaining_sessions?: number;
  session_progress_percent?: number;
}

interface StudyMaterial {
  id: string;
  status?: string;
}

interface QuizAttempt {
  id: string;
  status?: string;
  submitted_at?: string;
}

interface Topic {
  id: string;
  name?: string;
  title?: string;
  exam_plan_id?: string;
}

interface StudySession {
  id: string;
  topic_id?: string;
  scheduled_start?: string;
  status?: string;
  is_unlocked?: boolean;
  lock_reason?: string | null;
  actual_study_seconds?: number;
  session_number?: number;
  day_number?: number;
  title?: string;
  name?: string;
}

interface DashboardData {
  subjectCount: number;
  completedSessions: number;
  totalSessions: number;
  materialCount: number;
  quizAttemptCount: number;
  progressPercent: number;
  planCount: number;
  todaySessions: StudySession[];
  topics: Topic[];
  plans: ExamPlan[];
}

const quickActions = [
  {
    title: "Lập kế hoạch ôn thi",
    description: "Tạo kế hoạch học tập cùng AI",
    icon: "📅",
    href: "/study-plans",
  },
  {
    title: "Tải tài liệu",
    description: "Quản lý tài liệu học tập",
    icon: "📚",
    href: "/materials",
  },
  {
    title: "Ôn tập Flashcards",
    description: "Ghi nhớ kiến thức hiệu quả",
    icon: "🗂️",
    href: "/flashcards",
  },
  {
    title: "Kiểm tra kiến thức",
    description: "Đánh giá mức độ hiểu bài",
    icon: "✍️",
    href: "/quizzes",
  },
];

const EMPTY_DASHBOARD: DashboardData = {
  subjectCount: 0,
  completedSessions: 0,
  totalSessions: 0,
  materialCount: 0,
  quizAttemptCount: 0,
  progressPercent: 0,
  planCount: 0,
  todaySessions: [],
  topics: [],
  plans: [],
};

async function fetchApi<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`API ${path} trả về lỗi ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function getLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getSessionDateKey(value?: string): string | null {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  return getLocalDateKey(date);
}

export default function Home() {
  const [dashboard, setDashboard] =
    useState<DashboardData>(EMPTY_DASHBOARD);

  const [backendData, setBackendData] =
    useState<ApiResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dataWarning, setDataWarning] = useState("");
  const [today, setToday] = useState("");

  const refreshDashboard = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const results = await Promise.allSettled([
        fetchApi<ApiResponse>("/api/message"),
        fetchApi<ApiListResponse<Subject>>("/api/subjects"),
        fetchApi<ApiListResponse<ExamPlan>>("/api/exam-plans"),
        fetchApi<ApiListResponse<StudyMaterial>>("/api/study-materials"),
        fetchApi<ApiListResponse<QuizAttempt>>("/api/quiz-attempts"),
        fetchApi<ApiListResponse<StudySession>>("/api/study-sessions"),
        fetchApi<ApiListResponse<Topic>>("/api/topics"),
      ]);

      const [
        backendResult,
        subjectsResult,
        plansResult,
        materialsResult,
        attemptsResult,
        sessionsResult,
        topicsResult,
      ] = results;

      if (backendResult.status === "fulfilled") {
        setBackendData(backendResult.value);
      } else {
        setBackendData(null);
        setError("Không thể kết nối Backend");
      }

      const subjects =
        subjectsResult.status === "fulfilled"
          ? subjectsResult.value.data || []
          : [];

      const plans =
        plansResult.status === "fulfilled"
          ? plansResult.value.data || []
          : [];

      const materials =
        materialsResult.status === "fulfilled"
          ? materialsResult.value.data || []
          : [];

      const attempts =
        attemptsResult.status === "fulfilled"
          ? attemptsResult.value.data || []
          : [];

      const sessions =
        sessionsResult.status === "fulfilled"
          ? sessionsResult.value.data || []
          : [];

      const topics =
        topicsResult.status === "fulfilled"
          ? topicsResult.value.data || []
          : [];

      const failedRequests = [
        subjectsResult,
        plansResult,
        materialsResult,
        attemptsResult,
        sessionsResult,
        topicsResult,
      ].filter((result) => result.status === "rejected").length;

      setDataWarning(
        failedRequests > 0
          ? `${failedRequests} nguồn dữ liệu chưa tải được. Một số thống kê có thể chưa đầy đủ.`
          : ""
      );

      // Tổng hợp tiến độ từ các kế hoạch ôn thi
      const totalSessions = plans.reduce(
        (total, plan) => total + Number(plan.total_sessions || 0),
        0
      );

      const completedSessions = plans.reduce(
        (total, plan) =>
          total + Number(plan.completed_sessions || 0),
        0
      );

      const progressPercent =
        totalSessions > 0
          ? Math.round((completedSessions / totalSessions) * 100)
          : 0;

      // Lọc các buổi học được lên lịch trong ngày hiện tại
      const todayKey = getLocalDateKey(new Date());

      const todaySessions = sessions
        .filter(
          (session) =>
            getSessionDateKey(session.scheduled_start) === todayKey
        )
        .sort((a, b) => {
          const timeA = new Date(
            a.scheduled_start || ""
          ).getTime();

          const timeB = new Date(
            b.scheduled_start || ""
          ).getTime();

          return timeA - timeB;
        });

      setDashboard({
        subjectCount: subjects.length,
        completedSessions,
        totalSessions,
        materialCount: materials.length,
        quizAttemptCount:
          attemptsResult.status === "fulfilled"
            ? Number(
                attemptsResult.value.total_attempts ??
                  attempts.length
              )
            : 0,
        progressPercent,
        planCount:
          plansResult.status === "fulfilled"
            ? Number(
                plansResult.value.total_plans ?? plans.length
              )
            : 0,
        todaySessions,
        topics,
        plans,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Không thể tải dữ liệu Dashboard."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setToday(
      new Date().toLocaleDateString("vi-VN", {
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    );

    refreshDashboard();

    // Tự tải lại khi người dùng quay lại Dashboard
    const handleFocus = () => {
      refreshDashboard();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshDashboard();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange
    );

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange
      );
    };
  }, [refreshDashboard]);

  const statistics = [
    {
      title: "Môn học",
      value: dashboard.subjectCount,
      icon: "📚",
      note: "Môn học đã đăng ký",
    },
    {
      title: "Buổi học hoàn thành",
      value: dashboard.completedSessions,
      icon: "✓",
      note: `Trên tổng ${dashboard.totalSessions} buổi học`,
    },
    {
      title: "Tài liệu",
      value: dashboard.materialCount,
      icon: "📄",
      note: "Tài liệu đã tải lên",
    },
    {
      title: "Quiz đã làm",
      value: dashboard.quizAttemptCount,
      icon: "✎",
      note: "Bài kiểm tra đã nộp",
    },
  ];

  const getTopicName = (session: StudySession) => {
    const topic = dashboard.topics.find(
      (item) => item.id === session.topic_id
    );

    return (
      getMainTopicTitle(topic?.name) ||
      topic?.title ||
      session.title ||
      session.name ||
      "Buổi học"
    );
  };

  const getPlanName = (session: StudySession) => {
    const topic = dashboard.topics.find(
      (item) => item.id === session.topic_id
    );

    const plan = dashboard.plans.find(
      (item) => item.id === topic?.exam_plan_id
    );

    return plan?.title || "Kế hoạch ôn thi";
  };

  const getSessionStatus = (status?: string) => {
    switch (status) {
      case "completed":
        return {
          label: "Đã hoàn thành",
          className: "bg-[#EEF1FD] text-[#4566D1]",
        };

      case "in_progress":
        return {
          label: "Đang học",
          className: "bg-[#FFF5D6] text-[#9A6400]",
        };

      default:
        return {
          label: "Chưa bắt đầu",
          className: "bg-[#EEF1FD] text-[#4D4366]",
        };
    }
  };

  return (
    <div className="space-y-8">
      {/* Welcome */}
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <p className="text-sm font-medium capitalize text-[#716A82]">
            {today}
          </p>

          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#24123A]">
            Chào mừng trở lại! 👋
          </h1>

          <p className="mt-2 text-sm text-[#716A82]">
            Sẵn sàng cho một ngày học tập hiệu quả cùng StudyPilot?
          </p>
        </div>

        <Link
          href="/study-plans"
          className="inline-flex w-fit items-center gap-2 rounded-xl bg-[#5B7FE3] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#4566D1]"
        >
          + Tạo kế hoạch mới
        </Link>
      </section>

      {/* Statistics */}
      <section>
        <div className="mb-4">
          <h2 className="text-lg font-bold text-[#24123A]">
            Tổng quan học tập
          </h2>

          <p className="mt-1 text-sm text-[#716A82]">
            Theo dõi tình hình học tập của bạn.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {statistics.map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-[#ECE6EF] bg-[#FFFFFF] p-5 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-[#716A82]">
                  {item.title}
                </p>

                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EEF1FD] text-lg">
                  {item.icon}
                </span>
              </div>

              <p className="mt-4 text-3xl font-bold text-[#24123A]">
                {loading ? "..." : item.value.toLocaleString("vi-VN")}
              </p>

              <p className="mt-1 text-xs text-[#716A82]">
                {item.note}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Main content */}
      <section className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {/* Today's plan */}
        <div className="rounded-2xl border border-[#ECE6EF] bg-[#FFFFFF] p-6 xl:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-[#24123A]">
                Kế hoạch hôm nay
              </h2>

              <p className="mt-1 text-sm text-[#716A82]">
                Những nội dung bạn cần hoàn thành.
              </p>
            </div>

            <Link
              href="/study-plans"
              className="text-sm font-semibold text-[#4566D1] hover:underline"
            >
              Xem kế hoạch →
            </Link>
          </div>

          {loading ? (
            <div className="mt-6 rounded-xl border border-dashed border-[#ECE6EF] bg-[#F7F5FA] px-5 py-10 text-center text-sm text-[#716A82]">
              Đang tải kế hoạch học tập...
            </div>
          ) : dashboard.todaySessions.length === 0 ? (
            <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-[#ECE6EF] bg-[#F7F5FA] px-5 py-10 text-center">
              <span className="text-4xl">📖</span>

              <h3 className="mt-4 font-semibold text-[#4D4366]">
                {dashboard.planCount === 0
                  ? "Bạn chưa có kế hoạch ôn thi"
                  : "Hôm nay chưa có buổi học nào"}
              </h3>

              <p className="mt-2 max-w-sm text-sm leading-6 text-[#716A82]">
                {dashboard.planCount === 0
                  ? "Hãy tạo kế hoạch ôn thi để StudyPilot giúp bạn sắp xếp lịch học phù hợp."
                  : "Bạn có thể xem các buổi học trong kế hoạch hoặc tiếp tục những bài học đã được mở khóa."}
              </p>

              <Link
                href="/study-plans"
                className="mt-5 rounded-xl bg-[#EEF1FD] px-5 py-2.5 text-sm font-semibold text-[#24123A] transition hover:bg-[#EEF1FD]"
              >
                Xem kế hoạch học tập
              </Link>
            </div>
          ) : (
            <div className="mt-6 space-y-3">
              {dashboard.todaySessions.map((session) => {
                const unlocked =
                  session.is_unlocked === true ||
                  session.status === "completed" ||
                  session.status === "in_progress";

                const status = getSessionStatus(session.status);

                return (
                  <div
                    key={session.id}
                    className="rounded-xl border border-[#ECE6EF] bg-white p-4"
                  >
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                      <div className="min-w-0">
                        <h3 className="font-semibold text-[#24123A]">
                          {getTopicName(session)}
                        </h3>

                        <p className="mt-1 text-xs text-[#716A82]">
                          {getPlanName(session)}
                        </p>

                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-medium ${status.className}`}
                          >
                            {status.label}
                          </span>

                          {!unlocked && (
                            <span className="rounded-full bg-[#FDEDF3] px-3 py-1 text-xs font-medium text-[#C42A63]">
                              🔒 Chưa mở khóa
                            </span>
                          )}
                        </div>

                        {!unlocked && session.lock_reason && (
                          <p className="mt-2 text-xs leading-5 text-[#C42A63]">
                            {session.lock_reason}
                          </p>
                        )}
                      </div>

                      {unlocked ? (
                        <Link
                          href={`/study-sessions/${session.id}`}
                          className="inline-flex shrink-0 items-center justify-center rounded-lg bg-[#5B7FE3] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#4566D1]"
                        >
                          {session.status === "completed"
                            ? "Xem lại"
                            : session.status === "in_progress"
                              ? "Tiếp tục học"
                              : "Bắt đầu học"}
                        </Link>
                      ) : (
                        <span className="inline-flex shrink-0 items-center justify-center rounded-lg bg-[#EEF1FD] px-4 py-2.5 text-sm font-semibold text-[#716A82]">
                          Đang khóa
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Progress */}
        <div className="rounded-2xl border border-[#ECE6EF] bg-[#FFFFFF] p-6">
          <h2 className="text-lg font-bold text-[#24123A]">
            Tiến độ ôn thi
          </h2>

          <p className="mt-1 text-sm text-[#716A82]">
            Theo dõi mục tiêu học tập.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center py-5 text-center">
            <div
              className="flex h-32 w-32 items-center justify-center rounded-full p-[10px]"
              style={{
                background: `conic-gradient(#5B7FE3 ${dashboard.progressPercent}%, #ECE6EF ${dashboard.progressPercent}% 100%)`,
              }}
            >
              <div className="flex h-full w-full items-center justify-center rounded-full bg-[#FFFFFF]">
                <span className="text-3xl font-bold text-[#4566D1]">
                  {loading ? "..." : `${dashboard.progressPercent}%`}
                </span>
              </div>
            </div>

            <p className="mt-5 font-semibold text-[#4D4366]">
              {dashboard.totalSessions === 0
                ? "Chưa có dữ liệu tiến độ"
                : dashboard.progressPercent === 100
                  ? "Đã hoàn thành tất cả buổi học"
                  : "Tiếp tục duy trì tiến độ"}
            </p>

            <p className="mt-2 text-xs leading-5 text-[#716A82]">
              {dashboard.totalSessions > 0
                ? `${dashboard.completedSessions}/${dashboard.totalSessions} buổi học đã hoàn thành`
                : "Tiến độ sẽ được cập nhật khi bạn bắt đầu thực hiện kế hoạch."}
            </p>

            <Link
              href="/study-plans"
              className="mt-5 text-sm font-semibold text-[#4566D1] hover:underline"
            >
              Xem chi tiết kế hoạch →
            </Link>
          </div>
        </div>
      </section>

      {/* Quick actions */}
      <section>
        <div className="mb-4">
          <h2 className="text-lg font-bold text-[#24123A]">
            Truy cập nhanh
          </h2>

          <p className="mt-1 text-sm text-[#716A82]">
            Tiếp tục hành trình học tập của bạn.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {quickActions.map((action) => (
            <Link
              key={action.title}
              href={action.href}
              className="group rounded-2xl border border-[#ECE6EF] bg-[#FFFFFF] p-5 transition hover:-translate-y-1 hover:border-[#ECE6EF] hover:shadow-md"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#EEF1FD] text-2xl">
                {action.icon}
              </span>

              <h3 className="mt-4 font-bold text-[#24123A]">
                {action.title}
              </h3>

              <p className="mt-2 text-sm text-[#716A82]">
                {action.description}
              </p>

              <p className="mt-4 text-sm font-semibold text-[#4566D1] group-hover:underline">
                Truy cập →
              </p>
            </Link>
          ))}
        </div>
      </section>

      {/* Chỉ báo khi không tải được dữ liệu (không hiện thông tin kỹ thuật cho người dùng) */}
      {!loading && (error || dataWarning) && (
        <section className="flex flex-col gap-3 rounded-2xl border-2 border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium text-[var(--sp-pink-dark)]">
            {error
              ? "Chưa tải được dữ liệu học tập. Vui lòng thử lại sau ít phút."
              : "Một phần dữ liệu chưa tải được, số liệu có thể chưa đầy đủ."}
          </p>
          <button
            type="button"
            onClick={refreshDashboard}
            className="sp-btn sp-btn-secondary w-fit px-4 py-2 text-sm"
          >
            ↻ Thử lại
          </button>
        </section>
      )}
    </div>
  );
}

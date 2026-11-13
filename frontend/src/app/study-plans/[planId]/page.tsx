
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getMainTopicTitle } from "@/lib/content-titles";

type ExamPlan = {
  id: string;
  title: string;
  exam_date: string;
  daily_available_minutes: number;
  study_days_per_week?: number;
};

type Topic = {
  id: string;
  name: string;
  description: string | null;
  difficulty_level: number;
  estimated_minutes: number;
  status: string;
};

type StudySession = {
  id: string;
  topic_id: string;
  scheduled_start: string;
  duration_minutes: number;
  status: string;
  source: string;
  notes: string | null;
  is_unlocked?: boolean;
  lock_reason?: string | null;
};

const API_URL = "http://127.0.0.1:8000";

type StudyDayGroup = {
  dateKey: string;
  label: string;
  sessions: StudySession[];
};

type StudyWeekGroup = {
  weekNumber: number;
  days: StudyDayGroup[];
};

export default function StudyPlanDetailPage() {
  const params = useParams<{ planId: string }>();
  const router = useRouter();
  const planId = params.planId;

  const [plan, setPlan] = useState<ExamPlan | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadPlanDetails() {
      try {
        setIsLoading(true);
        setError("");

        const planResponse = await fetch(
          `${API_URL}/api/exam-plans`
        );
        const planResult = await planResponse.json();

        if (!planResponse.ok) {
          throw new Error(
            planResult.detail || "Không thể tải kế hoạch ôn thi."
          );
        }

        const currentPlan = (planResult.data || []).find(
          (item: ExamPlan) => item.id === planId
        );

        if (!currentPlan) {
          throw new Error("Không tìm thấy kế hoạch ôn thi.");
        }

        setPlan(currentPlan);

        const [topicResponse, sessionResponse] = await Promise.all([
          fetch(
            `${API_URL}/api/topics?exam_plan_id=${planId}`
          ),
          fetch(
            `${API_URL}/api/study-sessions?exam_plan_id=${planId}`
          ),
        ]);

        const topicResult = await topicResponse.json();
        const sessionResult = await sessionResponse.json();

        if (!topicResponse.ok) {
          throw new Error(
            topicResult.detail || "Không thể tải danh sách chủ đề."
          );
        }

        if (!sessionResponse.ok) {
          throw new Error(
            sessionResult.detail || "Không thể tải lịch học."
          );
        }

        setTopics(topicResult.data || []);
        setSessions(sessionResult.data || []);
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : "Đã xảy ra lỗi khi tải dữ liệu."
        );
      } finally {
        setIsLoading(false);
      }
    }

    if (planId) {
      loadPlanDetails();
    }
  }, [planId]);

  function getTopicName(topicId: string) {
    return (
      topics.find((topic) => topic.id === topicId)?.name ||
      "Chủ đề chưa xác định"
    );
  }

  function getSessionStatus(status: string) {
    switch (status) {
      case "scheduled":
        return "Đã lên lịch";
      case "in_progress":
        return "Đang học";
      case "completed":
        return "Đã hoàn thành";
      case "missed":
        return "Đã bỏ lỡ";
      default:
        return status;
    }
  }

  function isSessionLocked(session: StudySession) {
  // Không khóa lại những buổi đã bắt đầu hoặc hoàn thành.
  if (
    session.status === "in_progress" ||
    session.status === "completed"
  ) {
    return false;
  }

  // Sử dụng trạng thái mở khóa do Backend kiểm tra.
  // Không khóa bài học chỉ vì ngày học nằm trong tương lai.
  return session.is_unlocked === false;
}

  function getStatusStyle(status: string) {
    switch (status) {
      case "scheduled":
        return "bg-blue-50 text-blue-700";
      case "in_progress":
        return "bg-amber-50 text-amber-700";
      case "completed":
        return "bg-green-50 text-green-700";
      case "missed":
        return "bg-red-50 text-red-700";
      default:
        return "bg-gray-100 text-gray-700";
    }
  }

  // Sắp xếp lịch học theo thời gian
  const sortedSessions = [...sessions].sort(
    (a, b) =>
      new Date(a.scheduled_start).getTime() -
      new Date(b.scheduled_start).getTime()
  );

  function getVietnamDateKey(value: string) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
    }).format(new Date(value));
  }

  function getDateLabel(dateKey: string) {
    return new Date(`${dateKey}T00:00:00`).toLocaleDateString(
      "vi-VN",
      {
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }
    );
  }

  const firstDateKey = sortedSessions.length
    ? getVietnamDateKey(sortedSessions[0].scheduled_start)
    : "";

  const groupedSessionsByWeek = sortedSessions.reduce<
    Record<number, StudyWeekGroup>
  >((weeks, session) => {
    const dateKey = getVietnamDateKey(session.scheduled_start);
    const daysFromStart = Math.max(
      0,
      Math.floor(
        (new Date(`${dateKey}T00:00:00`).getTime() -
          new Date(`${firstDateKey}T00:00:00`).getTime()) /
          (24 * 60 * 60 * 1000)
      )
    );
    const weekNumber = Math.floor(daysFromStart / 7) + 1;
    const week = weeks[weekNumber] || {
      weekNumber,
      days: [],
    };
    const existingDay = week.days.find(
      (day) => day.dateKey === dateKey
    );

    if (existingDay) {
      existingDay.sessions.push(session);
    } else {
      week.days.push({
        dateKey,
        label: getDateLabel(dateKey),
        sessions: [session],
      });
    }

    weeks[weekNumber] = week;
    return weeks;
  }, {});

  const studyWeeks = Object.values(groupedSessionsByWeek).sort(
    (a, b) => a.weekNumber - b.weekNumber
  );

  // Tính tiến độ tổng hợp của toàn bộ chủ đề trong kế hoạch
  const completedTopicIds = new Set(
    topics
      .filter((topic) => {
        const topicSessions = sessions.filter(
          (session) => session.topic_id === topic.id
        );

        return (
          topicSessions.length > 0 &&
          topicSessions.every(
            (session) => session.status === "completed"
          )
        );
      })
      .map((topic) => topic.id)
  );

  const totalTopicCount = topics.length;
  const completedTopicCount = completedTopicIds.size;

  const progressPercentage =
    totalTopicCount > 0
      ? Math.round(
          (completedTopicCount / totalTopicCount) * 100
        )
      : 0;

        // Thống kê tiến độ các buổi học
  const totalSessionCount = sessions.length;

  const completedSessionCount = sessions.filter(
    (session) => session.status === "completed"
  ).length;

  const remainingSessionCount =
    totalSessionCount - completedSessionCount;

  if (isLoading) {
    return (
      <div className="rounded-2xl bg-[#FCFBF7] p-10 text-center text-[#89958A]">
        Đang tải lộ trình ôn tập...
      </div>
    );
  }

  if (error || !plan) {
    return (
      <div className="rounded-2xl border border-red-100 bg-white p-8">
        <p className="text-sm text-red-600">
          {error || "Không tìm thấy kế hoạch."}
        </p>

        <button
          onClick={() => router.push("/study-plans")}
          className="mt-5 rounded-xl bg-[#54765D] px-5 py-2.5 text-sm font-semibold text-white"
        >
          Quay lại kế hoạch
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">

      {/* Page heading */}
      <section>
        <button
          onClick={() => router.push("/study-plans")}
          className="mb-5 text-sm font-medium text-[#829080] hover:text-[#355642]"
        >
          ← Quay lại danh sách kế hoạch
        </button>

        <p className="text-sm font-medium text-[#829080]">
          KHÔNG GIAN HỌC TẬP / LỘ TRÌNH
        </p>

        <h1 className="mt-2 text-3xl font-bold text-[#355642]">
          {plan.title}
        </h1>

        <p className="mt-2 text-sm text-[#89958A]">
          Theo dõi nội dung và tiến độ ôn tập của bạn cùng StudyPilot.
        </p>
      </section>

      {/* Plan information */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-4">

        <div className="rounded-2xl border border-[#E8E8DF] bg-[#FCFBF7] p-5">
          <p className="text-sm text-[#89958A]">
            Ngày thi
          </p>

          <p className="mt-2 text-xl font-bold text-[#355642]">
            {new Date(plan.exam_date).toLocaleDateString("vi-VN")}
          </p>
        </div>

        <div className="rounded-2xl border border-[#E8E8DF] bg-[#FCFBF7] p-5">
          <p className="text-sm text-[#89958A]">
            Thời gian học mỗi ngày
          </p>

          <p className="mt-2 text-xl font-bold text-[#355642]">
            {plan.daily_available_minutes} phút
          </p>
        </div>

        <div className="rounded-2xl border border-[#E8E8DF] bg-[#FCFBF7] p-5">
          <p className="text-sm text-[#89958A]">
            Số ngày học mỗi tuần
          </p>

          <p className="mt-2 text-xl font-bold text-[#355642]">
            {plan.study_days_per_week || "—"} ngày
          </p>
        </div>

        <div className="rounded-2xl border border-[#E8E8DF] bg-[#FCFBF7] p-5">
          <p className="text-sm text-[#89958A]">
            Tổng số chủ đề
          </p>

          <p className="mt-2 text-xl font-bold text-[#355642]">
            {totalTopicCount} chủ đề
          </p>
        </div>

      </section>

      {/* Overall learning progress */}
      <section className="rounded-2xl border border-[#E8E8DF] bg-[#FCFBF7] p-6 shadow-sm sm:p-8">

        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-lg font-bold text-[#355642]">
              Tiến độ học tập tổng thể
            </h2>

            <p className="mt-1 text-sm text-[#89958A]">
              Tổng hợp tiến độ từ tất cả tài liệu trong kế hoạch này.
            </p>
          </div>

          <p className="text-3xl font-bold text-[#54765D]">
            {progressPercentage}%
          </p>
        </div>

        <div className="mt-5 h-3 w-full overflow-hidden rounded-full bg-[#E8EEE4]">
          <div
            className="h-full rounded-full bg-[#54765D] transition-all duration-500"
            style={{
              width: `${progressPercentage}%`,
            }}
          />
        </div>

                <div className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <p className="font-bold text-[#54765D]">
              {completedTopicCount}/{totalTopicCount}
            </p>
            <p className="mt-1 text-[#89958A]">
              Chủ đề hoàn thành
            </p>
          </div>

          <div>
            <p className="font-bold text-[#C58D6D]">
              {totalTopicCount - completedTopicCount}
            </p>
            <p className="mt-1 text-[#89958A]">
              Chủ đề còn lại
            </p>
          </div>

          <div>
            <p className="font-bold text-[#54765D]">
              {completedSessionCount}/{totalSessionCount}
            </p>
            <p className="mt-1 text-[#89958A]">
              Buổi học hoàn thành
            </p>
          </div>

          <div>
            <p className="font-bold text-[#C58D6D]">
              {remainingSessionCount}
            </p>
            <p className="mt-1 text-[#89958A]">
              Buổi học chưa hoàn thành
            </p>
          </div>
        </div>

        {totalTopicCount === 0 && (
          <p className="mt-4 text-sm text-[#89958A]">
            Chưa có chủ đề từ tài liệu để tính tiến độ học tập.
          </p>
        )}

      </section>

      {/* AI topics */}
      <section className="rounded-2xl border border-[#E8E8DF] bg-[#FCFBF7] p-6 shadow-sm sm:p-8">

        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E8EEE4] text-xl">
            ✨
          </span>

          <div>
            <h2 className="text-lg font-bold text-[#355642]">
              Nội dung AI nhận diện
            </h2>

            <p className="mt-1 text-sm text-[#89958A]">
              Các chương và chủ đề được trích xuất từ tất cả tài liệu của bạn.
            </p>
          </div>
        </div>

        {topics.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-[#DCE3D8] bg-[#F7F8F3] p-8 text-center">
            <p className="text-sm text-[#89958A]">
              Chưa có chủ đề nào được nhận diện từ tài liệu.
            </p>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            {topics.map((topic, index) => {
              const isCompleted = completedTopicIds.has(topic.id);

              return (
                <div
                  key={topic.id}
                  className="rounded-xl border border-[#E2E5DC] bg-white p-5"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#E8EEE4] text-sm font-bold text-[#54765D]">
                      {index + 1}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <h3 className="font-semibold text-[#355642]">
                          {getMainTopicTitle(topic.name)}
                        </h3>

                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                            isCompleted
                              ? "bg-green-50 text-green-700"
                              : "bg-amber-50 text-amber-700"
                          }`}
                        >
                          {isCompleted
                            ? "Đã hoàn thành"
                            : "Chưa hoàn thành"}
                        </span>
                      </div>

                      {topic.description && (
                        <p className="mt-2 text-sm leading-6 text-[#89958A]">
                          {topic.description}
                        </p>
                      )}

                      <p className="mt-3 text-xs text-[#829080]">
                        Độ khó: {topic.difficulty_level}/5
                        {" · "}
                        Dự kiến: {topic.estimated_minutes} phút
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Daily roadmap */}
      <section className="rounded-2xl border border-[#E8E8DF] bg-[#FCFBF7] p-6 shadow-sm sm:p-8">

        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E8EEE4] text-xl">
            📅
          </span>

          <div>
            <h2 className="text-lg font-bold text-[#355642]">
              Lộ trình học tập theo tuần và ngày
            </h2>

            <p className="mt-1 text-sm text-[#89958A]">
              Theo dõi từng buổi học được phân bổ trong kế hoạch.
            </p>
          </div>
        </div>

        {sortedSessions.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-[#DCE3D8] bg-[#F7F8F3] px-5 py-12 text-center">
            <span className="text-4xl">🌱</span>

            <h3 className="mt-3 font-semibold text-[#536657]">
              Lộ trình học tập chưa được tạo
            </h3>

            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[#89958A]">
              AI đã có thể nhận diện nội dung tài liệu. Bước tiếp theo,
              StudyPilot sẽ phân bổ các chủ đề thành từng ngày học dựa trên
              thời gian còn lại trước kỳ thi và quỹ thời gian của bạn.
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-8">
            {studyWeeks.map((week) => (
              <div
                key={week.weekNumber}
                className="rounded-2xl border border-[#DCE7D8] bg-[#F8FBF7] p-5 sm:p-6"
              >
                <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                  <h3 className="text-lg font-bold text-[#355642]">
                    Tuần {week.weekNumber}
                  </h3>

                  <span className="w-fit rounded-full bg-[#E8EEE4] px-3 py-1 text-sm font-semibold text-[#54765D]">
                    {week.days.length} ngày học
                  </span>
                </div>

                <div className="mt-5 space-y-6">
                  {week.days.map((day, dayIndex) => (
                    <div key={day.dateKey} className="relative">
                      <div className="mb-3 flex items-center gap-3">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-xs font-bold text-[#54765D]">
                          {dayIndex + 1}
                        </span>

                        <h4 className="font-bold capitalize text-[#355642]">
                          Ngày {dayIndex + 1} · {day.label}
                        </h4>
                      </div>

                      <div className="ml-4 space-y-3 border-l-2 border-[#DCE7D8] pl-8">
                        {day.sessions.map((session) => (
                      <div
                        key={session.id}
                        className="rounded-xl border border-[#E2E5DC] bg-white p-5"
                      >
                        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                          <div>
                            <h4 className="font-semibold text-[#355642]">
                              {getTopicName(session.topic_id)}
                            </h4>

                            <p className="mt-2 text-sm text-[#89958A]">
                              ⏱ {session.duration_minutes} phút
                            </p>
                          </div>

                          <span
                            className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${
                              isSessionLocked(session)
                                ? "bg-gray-100 text-gray-500"
                                : getStatusStyle(session.status)
                            }`}
                          >
                            {isSessionLocked(session)
  ? `🔒 ${session.lock_reason || "Chưa đủ điều kiện học"}`
  : getSessionStatus(session.status)}
                          </span>
                        </div>

                        {session.notes && (
                          <p className="mt-3 border-t border-[#EAEAE2] pt-3 text-sm leading-6 text-[#89958A]">
                            {session.notes}
                          </p>
                        )}

                        <div className="mt-4 flex justify-end">
                          <button
                            type="button"
                            disabled={isSessionLocked(session)}
                            onClick={() =>
                              router.push(
                                `/study-sessions/${session.id}`
                              )
                            }
                            className="rounded-xl bg-[#54765D] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#3F6249] disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500"
                          >
                            {isSessionLocked(session)
  ? "🔒 Chưa mở khóa"
  : session.status === "completed"
    ? "Xem lại bài học →"
    : "Vào học ngay →"}
                          </button>
                        </div>
                      </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

    </div>
  );
}
